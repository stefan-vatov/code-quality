/* -------------------------------------------------------------------------- */
/*      Prefer Ref.getAndUpdate over Ref.modify identity result tuples.       */
/* -------------------------------------------------------------------------- */

import type { Context, SourceRule } from './effect-rule-core';
import { asNode, childNode, childNodes, identifierName } from './effect-ast';
import type { ASTNode } from './effect-ast';
import type { ImportedEffectCallMatcher } from './effect-imported-call-matcher';
import { diagnosticMessage } from './diagnostic-guidance';
import { importedEffectCallMatcher } from './effect-imported-call-matcher';
import { readCachedSource } from './source-cache';
import { strictPathOptionsSchema } from './effect-path-options';

export {
  default as preferOptionOrElseSomeRule,
  preferAllDiscardRule,
  preferCollectionDiscardOverAsVoidRule,
  preferForEachDiscardRule,
  preferLayerSyncRule,
  preferOptionGetOrElseRule,
  preferOptionNullishGettersRule,
} from './effect-prefer-option-or-else-some';

interface MatcherState {
  refModify: ImportedEffectCallMatcher;
  rootModify: ImportedEffectCallMatcher;
}

const MESSAGE = diagnosticMessage({
  example:
    'import { Ref } from "effect"\n\n' +
    'const previous = Ref.getAndUpdate(ref, (current) => current + 1)',
  fix: 'Replace Ref.modify with Ref.getAndUpdate and return only the new Ref value from the callback.',
  summary:
    'Ref.getAndUpdate expresses a Ref.modify callback that returns the current value while updating the Ref more directly.',
});

const literalString = (node: ASTNode | undefined): string | undefined => {
  if (node?.type !== 'Literal') {
    return undefined;
  }
  const value: unknown = Reflect.get(node, 'value');
  if (typeof value === 'string') {
    return value;
  }
  return undefined;
};

const isRefImport = (statement: ASTNode): boolean => {
  if (statement.type !== 'ImportDeclaration') {
    return false;
  }
  const source = literalString(childNode(statement, 'source'));
  return source === 'effect' || source === 'effect/Ref';
};

const hasRefImport = (program: ASTNode): boolean => childNodes(program, 'body').some(isRefImport);

const hasTypeArguments = (node: ASTNode): boolean =>
  Boolean(childNode(node, 'typeArguments') || childNode(node, 'typeParameters'));

const hasUnsupportedMemberAccess = (node: ASTNode | undefined): boolean =>
  node?.type === 'MemberExpression' &&
  (Reflect.get(node, 'computed') === true ||
    Reflect.get(node, 'optional') === true ||
    hasUnsupportedMemberAccess(childNode(node, 'object')));

const isPlainCall = (call: ASTNode): boolean =>
  Reflect.get(call, 'optional') !== true &&
  !hasTypeArguments(call) &&
  !hasUnsupportedMemberAccess(childNode(call, 'callee'));

const exactArguments = (call: ASTNode): ASTNode[] | undefined => {
  if (!isPlainCall(call)) {
    return undefined;
  }
  const callArguments = childNodes(call, 'arguments');
  if (
    (callArguments.length !== 1 && callArguments.length !== 2) ||
    callArguments.some((argument): boolean => argument.type === 'SpreadElement')
  ) {
    return undefined;
  }
  return callArguments;
};

const isExactConstAssertion = (node: ASTNode): boolean => {
  const annotation = childNode(node, 'typeAnnotation');
  return (
    annotation?.type === 'TSTypeReference' &&
    identifierName(childNode(annotation, 'typeName')) === 'const' &&
    !hasTypeArguments(annotation)
  );
};

const tupleBody = (
  expression: ASTNode | undefined,
  hasConstAssertion = false,
): ASTNode | undefined => {
  if (expression?.type === 'ParenthesizedExpression') {
    return tupleBody(childNode(expression, 'expression'), hasConstAssertion);
  }
  if (expression?.type === 'TSAsExpression') {
    if (hasConstAssertion || !isExactConstAssertion(expression)) {
      return undefined;
    }
    return tupleBody(childNode(expression, 'expression'), true);
  }
  if (expression?.type !== 'ArrayExpression') {
    return undefined;
  }
  return expression;
};

const isUnknownArray = (value: unknown): value is readonly unknown[] => Array.isArray(value);

const rawTupleElements = (array: ASTNode): [ASTNode, ASTNode] | undefined => {
  const elements: unknown = Reflect.get(array, 'elements');
  if (!isUnknownArray(elements) || elements.length !== 2) {
    return undefined;
  }
  const first = asNode(elements[0]);
  const second = asNode(elements[1]);
  if (!first || !second || first.type === 'SpreadElement' || second.type === 'SpreadElement') {
    return undefined;
  }
  return [first, second];
};

const isConciseUntypedArrow = (node: ASTNode | undefined): node is ASTNode =>
  node?.type === 'ArrowFunctionExpression' &&
  Reflect.get(node, 'async') !== true &&
  Reflect.get(node, 'generator') !== true &&
  Reflect.get(node, 'expression') === true &&
  !childNode(node, 'returnType') &&
  !childNode(node, 'typeParameters');

const callbackParameterName = (arrow: ASTNode): string | undefined => {
  const parameters = childNodes(arrow, 'params');
  if (parameters.length !== 1) {
    return undefined;
  }
  const [parameter] = parameters;
  const parameterName = identifierName(parameter);
  if (
    !parameter ||
    !parameterName ||
    Reflect.get(parameter, 'optional') === true ||
    childNode(parameter, 'typeAnnotation')
  ) {
    return undefined;
  }
  return parameterName;
};

const isCurrentValueTuple = (body: ASTNode | undefined, parameterName: string): boolean => {
  const array = tupleBody(body);
  if (!array) {
    return false;
  }
  const elements = rawTupleElements(array);
  if (!elements) {
    return false;
  }
  const [first, second] = elements;
  return identifierName(first) === parameterName && identifierName(second) !== parameterName;
};

const isExactModifyCallback = (node: ASTNode | undefined): boolean => {
  if (!isConciseUntypedArrow(node)) {
    return false;
  }
  const parameterName = callbackParameterName(node);
  if (!parameterName) {
    return false;
  }
  return isCurrentValueTuple(childNode(node, 'body'), parameterName);
};

const matchingCallee = (call: ASTNode, state: MatcherState): ASTNode | undefined => {
  const callArguments = exactArguments(call);
  if (!callArguments || !isExactModifyCallback(callArguments.at(-1))) {
    return undefined;
  }
  const callee = childNode(call, 'callee');
  if (state.refModify.matches(callee) && !state.rootModify.matches(callee)) {
    return callee;
  }
  return undefined;
};

const hasCandidateTokens = (source: string): boolean =>
  source.includes('effect') &&
  source.includes('Ref') &&
  source.includes('modify') &&
  source.includes('=>') &&
  source.includes('[');

const rule: SourceRule = {
  create(context: Context) {
    if (!hasCandidateTokens(readCachedSource(context))) {
      return { Program(): void {} };
    }

    let state: MatcherState | undefined = undefined;
    return {
      CallExpression(value): void {
        const call = asNode(value);
        if (!call || !state) {
          return;
        }
        const callee = matchingCallee(call, state);
        if (callee) {
          context.report({ message: MESSAGE, node: callee });
        }
      },
      Program(value): void {
        const program = asNode(value);
        if (!program || !hasRefImport(program)) {
          return;
        }
        const refModify = importedEffectCallMatcher(context, 'Ref', ['modify']);
        const rootModify = importedEffectCallMatcher(context, 'Effect', ['modify']);
        refModify.initialize(program);
        rootModify.initialize(program);
        state = { refModify, rootModify };
      },
    };
  },
  meta: {
    docs: {
      description: MESSAGE,
    },
    schema: strictPathOptionsSchema,
    type: 'problem',
  },
};

export default rule;
