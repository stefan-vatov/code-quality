/* -------------------------------------------------------------------------- */
/*   Prefer Effect.tap when flatMap runs an Effect and preserves its value.   */
/* -------------------------------------------------------------------------- */

import type { Context, SourceRule } from './effect-rule-core';
import { asNode, childNode, childNodes, identifierName } from './effect-ast';
import type { ASTNode } from './effect-ast';
import type { ImportedEffectCallMatcher } from './effect-imported-call-matcher';
import { diagnosticMessage } from './diagnostic-guidance';
import { importedEffectCallMatcher } from './effect-imported-call-matcher';
import { readCachedSource } from './source-cache';
import { strictPathOptionsSchema } from './effect-path-options';

const MESSAGE = diagnosticMessage({
  example:
    'import { Effect } from "effect"\n\n' +
    'const result = program.pipe(Effect.tap((value) => audit(value)))',
  fix: 'Replace Effect.flatMap with Effect.tap and return the side Effect without replacing its success value.',
  summary:
    'Effect.tap expresses running an Effect while preserving the original success value more directly than Effect.flatMap followed by Effect.as.',
});

const AS_TOKEN = /\bas\b/;

interface MatcherState {
  effectAs: ImportedEffectCallMatcher;
  effectFlatMap: ImportedEffectCallMatcher;
}

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

const isTypeImport = (node: ASTNode): boolean => Reflect.get(node, 'importKind') === 'type';

const isRuntimeEffectImport = (statement: ASTNode): boolean => {
  if (statement.type !== 'ImportDeclaration' || isTypeImport(statement)) {
    return false;
  }
  const source = literalString(childNode(statement, 'source'));
  if (source !== 'effect' && source !== 'effect/Effect') {
    return false;
  }
  const specifiers = childNodes(statement, 'specifiers');
  return (
    specifiers.length === 0 || specifiers.some((specifier): boolean => !isTypeImport(specifier))
  );
};

const hasRuntimeEffectImport = (program: ASTNode): boolean =>
  childNodes(program, 'body').some(isRuntimeEffectImport);

const hasTypeArguments = (node: ASTNode): boolean =>
  Boolean(childNode(node, 'typeArguments') || childNode(node, 'typeParameters'));

const hasOptionalMemberAccess = (node: ASTNode | undefined): boolean => {
  const visited = new WeakSet();
  let current = node;
  while (current?.type === 'MemberExpression' && !visited.has(current)) {
    visited.add(current);
    if (Reflect.get(current, 'optional') === true) {
      return true;
    }
    current = childNode(current, 'object');
  }
  return false;
};

const isPlainCall = (call: ASTNode): boolean =>
  Reflect.get(call, 'optional') !== true &&
  !hasTypeArguments(call) &&
  !hasOptionalMemberAccess(childNode(call, 'callee'));

const exactArguments = (call: ASTNode, expectedCount: number): ASTNode[] | undefined => {
  if (!isPlainCall(call)) {
    return undefined;
  }
  const callArguments = childNodes(call, 'arguments');
  if (callArguments.length !== expectedCount) {
    return undefined;
  }
  for (const argument of callArguments) {
    if (argument.type === 'SpreadElement') {
      return undefined;
    }
  }
  return callArguments;
};

const returnedExpression = (transform: ASTNode): ASTNode | undefined => {
  const body = childNode(transform, 'body');
  if (body?.type !== 'BlockStatement') {
    return body;
  }
  const statements = childNodes(body, 'body');
  const [statement] = statements;
  if (statements.length === 1 && statement?.type === 'ReturnStatement') {
    return childNode(statement, 'argument');
  }
  return undefined;
};

const isSupportedCallback = (transform: ASTNode | undefined): transform is ASTNode => {
  if (
    (transform?.type !== 'ArrowFunctionExpression' && transform?.type !== 'FunctionExpression') ||
    Reflect.get(transform, 'async') === true ||
    Reflect.get(transform, 'generator') === true ||
    hasTypeArguments(transform)
  ) {
    return false;
  }
  const parameters = childNodes(transform, 'params');
  return parameters.length === 1 && parameters[0]?.type === 'Identifier';
};

const isPreservedIdentifier = (node: ASTNode | undefined, parameterName: string): boolean =>
  identifierName(node) === parameterName;

const isDataFirstAs = (
  expression: ASTNode,
  parameterName: string,
  effectAs: ImportedEffectCallMatcher,
): boolean => {
  if (expression.type !== 'CallExpression') {
    return false;
  }
  const callArguments = exactArguments(expression, 2);
  return Boolean(
    callArguments &&
    isPreservedIdentifier(callArguments[1], parameterName) &&
    effectAs.matches(childNode(expression, 'callee')),
  );
};

const isPlainPipeCall = (call: ASTNode): boolean => {
  if (!isPlainCall(call)) {
    return false;
  }
  const callee = childNode(call, 'callee');
  return (
    callee?.type === 'MemberExpression' &&
    Reflect.get(callee, 'computed') !== true &&
    Reflect.get(callee, 'optional') !== true &&
    identifierName(childNode(callee, 'property')) === 'pipe'
  );
};

const isPipeableAs = (
  expression: ASTNode,
  parameterName: string,
  effectAs: ImportedEffectCallMatcher,
): boolean => {
  if (expression.type !== 'CallExpression' || !isPlainPipeCall(expression)) {
    return false;
  }
  const operators = childNodes(expression, 'arguments');
  if (
    operators.length === 0 ||
    operators.some((operator): boolean => operator.type === 'SpreadElement')
  ) {
    return false;
  }
  const finalOperator = operators[operators.length - 1];
  if (finalOperator?.type !== 'CallExpression') {
    return false;
  }
  const asArguments = exactArguments(finalOperator, 1);
  return Boolean(
    asArguments &&
    isPreservedIdentifier(asArguments[0], parameterName) &&
    effectAs.matches(childNode(finalOperator, 'callee')),
  );
};

const preservesCallbackValue = (
  transform: ASTNode | undefined,
  effectAs: ImportedEffectCallMatcher,
): boolean => {
  if (!isSupportedCallback(transform)) {
    return false;
  }
  const parameterName = identifierName(childNodes(transform, 'params')[0]);
  const expression = returnedExpression(transform);
  return Boolean(
    parameterName &&
    expression &&
    (isDataFirstAs(expression, parameterName, effectAs) ||
      isPipeableAs(expression, parameterName, effectAs)),
  );
};

const flatMapCallback = (call: ASTNode): ASTNode | undefined => {
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
  return callArguments[callArguments.length - 1];
};

const hasCandidateTokens = (source: string): boolean =>
  source.includes('flatMap') && AS_TOKEN.test(source);

const inspectCall = (state: MatcherState, call: ASTNode): boolean => {
  if (!state.effectFlatMap.matches(childNode(call, 'callee'))) {
    return false;
  }
  const callback = flatMapCallback(call);
  return Boolean(callback && preservesCallbackValue(callback, state.effectAs));
};

const rule: SourceRule = {
  create(context: Context) {
    if (!hasCandidateTokens(readCachedSource(context))) {
      return { Program(): void {} };
    }

    const state: MatcherState = {
      effectAs: importedEffectCallMatcher(context, 'Effect', ['as']),
      effectFlatMap: importedEffectCallMatcher(context, 'Effect', ['flatMap']),
    };
    let isInitialized = false;

    return {
      CallExpression(value): void {
        if (!isInitialized) {
          return;
        }
        const call = asNode(value);
        if (call && inspectCall(state, call)) {
          context.report({ message: MESSAGE, node: childNode(call, 'callee') ?? call });
        }
      },
      Program(value): void {
        const program = asNode(value);
        if (!program || !hasRuntimeEffectImport(program)) {
          return;
        }
        isInitialized = true;
        state.effectAs.initialize(program);
        state.effectFlatMap.initialize(program);
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
