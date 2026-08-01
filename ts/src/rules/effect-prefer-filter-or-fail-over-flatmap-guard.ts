/* -------------------------------------------------------------------------- */
/*    Prefer Effect.filterOrFail for binary success-or-failure validation.    */
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
    'const activeUser = loadUser.pipe(\n' +
    '  Effect.filterOrFail(\n' +
    '    (user) => user.isActive === true,\n' +
    '    () => new InactiveUserError()\n' +
    '  )\n' +
    ')',
  fix:
    'Replace Effect.flatMap with Effect.filterOrFail, keep the condition in a predicate callback, and ' +
    'return the failure value from the lazy error callback.',
  summary:
    "Effect.filterOrFail expresses validating an Effect's success value with a predicate more directly than " +
    'Effect.flatMap with Effect.succeed and Effect.fail branches.',
});

interface MatcherState {
  effectFail: ImportedEffectCallMatcher;
  effectFlatMap: ImportedEffectCallMatcher;
  effectSucceed: ImportedEffectCallMatcher;
}

type ASTProperty = ASTNode | readonly ASTProperty[] | boolean | null | number | string | undefined;

const LITERAL_VALUE_TYPES = new Set(['bigint', 'boolean', 'number', 'string']);
const TYPEOF_RESULTS = new Set([
  'bigint',
  'boolean',
  'function',
  'number',
  'object',
  'string',
  'symbol',
  'undefined',
]);

const isASTPropertyArray = (value: ASTProperty): value is readonly ASTProperty[] =>
  Array.isArray(value);

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

const hasUnsupportedMemberAccess = (node: ASTNode | undefined): boolean => {
  if (node?.type !== 'MemberExpression') {
    return false;
  }
  return (
    Reflect.get(node, 'computed') === true ||
    Reflect.get(node, 'optional') === true ||
    hasUnsupportedMemberAccess(childNode(node, 'object'))
  );
};

const isPlainCall = (call: ASTNode): boolean =>
  Reflect.get(call, 'optional') !== true &&
  !hasTypeArguments(call) &&
  !hasUnsupportedMemberAccess(childNode(call, 'callee'));

const boundedArguments = (
  call: ASTNode,
  minimumCount: number,
  maximumCount: number,
): ASTNode[] | undefined => {
  if (!isPlainCall(call)) {
    return undefined;
  }
  const callArguments = childNodes(call, 'arguments');
  if (callArguments.length < minimumCount || callArguments.length > maximumCount) {
    return undefined;
  }
  for (const argument of callArguments) {
    if (argument.type === 'SpreadElement') {
      return undefined;
    }
  }
  return callArguments;
};

const returnedConditionalFromBlock = (block: ASTNode): ASTNode | undefined => {
  const statements = childNodes(block, 'body');
  const [statement] = statements;
  if (statements.length !== 1 || statement?.type !== 'ReturnStatement') {
    return undefined;
  }
  const returned = childNode(statement, 'argument');
  if (returned?.type === 'ConditionalExpression') {
    return returned;
  }
  return undefined;
};

const returnedConditional = (transform: ASTNode): ASTNode | undefined => {
  const body = childNode(transform, 'body');
  if (body?.type === 'ConditionalExpression') {
    return body;
  }
  if (body?.type !== 'BlockStatement') {
    return undefined;
  }
  return returnedConditionalFromBlock(body);
};

const supportedCallbackParameterName = (node: ASTNode | undefined): string | undefined => {
  if (
    node?.type !== 'ArrowFunctionExpression' ||
    Reflect.get(node, 'async') === true ||
    Reflect.get(node, 'generator') === true ||
    hasTypeArguments(node) ||
    childNode(node, 'returnType')
  ) {
    return undefined;
  }
  const parameters = childNodes(node, 'params');
  if (parameters.length !== 1) {
    return undefined;
  }
  return identifierName(parameters[0]);
};

const isLiteral = (node: ASTNode | undefined): boolean => {
  if (node?.type !== 'Literal') {
    return false;
  }
  const value: unknown = Reflect.get(node, 'value');
  return value === null || LITERAL_VALUE_TYPES.has(typeof value);
};

const isStringLiteral = (node: ASTNode | undefined): boolean =>
  node?.type === 'Literal' && typeof Reflect.get(node, 'value') === 'string';

const isParameterReference = (node: ASTNode | undefined, parameterName: string): boolean => {
  if (identifierName(node) === parameterName) {
    return true;
  }
  if (
    node?.type !== 'MemberExpression' ||
    Reflect.get(node, 'computed') === true ||
    Reflect.get(node, 'optional') === true ||
    childNode(node, 'property')?.type !== 'Identifier'
  ) {
    return false;
  }
  return isParameterReference(childNode(node, 'object'), parameterName);
};

const isTypeofParameterReference = (node: ASTNode | undefined, parameterName: string): boolean =>
  node?.type === 'UnaryExpression' &&
  Reflect.get(node, 'operator') === 'typeof' &&
  isParameterReference(childNode(node, 'argument'), parameterName);

const isValidTypeofResult = (node: ASTNode | undefined): boolean => {
  if (node?.type !== 'Literal') {
    return false;
  }
  const value: unknown = Reflect.get(node, 'value');
  return typeof value === 'string' && TYPEOF_RESULTS.has(value);
};

const isStrictEqualityOperator = (operator: string): boolean =>
  operator === '===' || operator === '!==';

const isRelationalOperator = (operator: string): boolean =>
  operator === '<' || operator === '<=' || operator === '>' || operator === '>=';

const comparesParameterWithLiteral = (
  left: ASTNode | undefined,
  right: ASTNode | undefined,
  parameterName: string,
): boolean =>
  (isParameterReference(left, parameterName) && isLiteral(right)) ||
  (isLiteral(left) && isParameterReference(right, parameterName));

const isTypeofComparison = (
  left: ASTNode | undefined,
  right: ASTNode | undefined,
  operator: string,
  parameterName: string,
): boolean =>
  isStrictEqualityOperator(operator) &&
  isTypeofParameterReference(left, parameterName) &&
  isValidTypeofResult(right);

const isSupportedBinaryPredicate = (conditional: ASTNode, parameterName: string): boolean => {
  const predicate = childNode(conditional, 'test');
  if (predicate?.type !== 'BinaryExpression') {
    return false;
  }
  const operator: unknown = Reflect.get(predicate, 'operator');
  if (typeof operator !== 'string') {
    return false;
  }
  const left = childNode(predicate, 'left');
  const right = childNode(predicate, 'right');
  return (
    isTypeofComparison(left, right, operator, parameterName) ||
    ((isStrictEqualityOperator(operator) || isRelationalOperator(operator)) &&
      comparesParameterWithLiteral(left, right, parameterName)) ||
    (operator === 'in' && isStringLiteral(left) && isParameterReference(right, parameterName))
  );
};

const containsIdentifierValue = (value: ASTProperty, name: string): boolean => {
  if (isASTPropertyArray(value)) {
    return value.some((item): boolean => containsIdentifierValue(item, name));
  }
  const node = asNode(value);
  return Boolean(node && containsIdentifier(node, name));
};

const containsIdentifier = (node: ASTNode, name: string): boolean => {
  if (identifierName(node) === name) {
    return true;
  }
  for (const [key, value] of Object.entries(node)) {
    if (key !== 'parent' && containsIdentifierValue(value as ASTProperty, name)) {
      return true;
    }
  }
  return false;
};

const isSuccessBranch = (
  node: ASTNode | undefined,
  parameterName: string,
  effectSucceed: ImportedEffectCallMatcher,
): boolean => {
  if (node?.type !== 'CallExpression' || !effectSucceed.matches(childNode(node, 'callee'))) {
    return false;
  }
  const callArguments = boundedArguments(node, 1, 1);
  return Boolean(callArguments && identifierName(callArguments[0]) === parameterName);
};

const isIndependentFailureBranch = (
  node: ASTNode | undefined,
  parameterName: string,
  effectFail: ImportedEffectCallMatcher,
): boolean => {
  if (node?.type !== 'CallExpression' || !effectFail.matches(childNode(node, 'callee'))) {
    return false;
  }
  const callArguments = boundedArguments(node, 1, 1);
  const [errorExpression] = callArguments ?? [];
  if (!errorExpression) {
    return false;
  }
  return !containsIdentifier(errorExpression, parameterName);
};

const isFilterOrFailGuard = (call: ASTNode, state: MatcherState): boolean => {
  const callArguments = boundedArguments(call, 1, 2);
  if (!callArguments) {
    return false;
  }
  const callback = callArguments[callArguments.length - 1];
  const conditional = callback && returnedConditional(callback);
  if (!conditional) {
    return false;
  }
  const parameterName = supportedCallbackParameterName(callback);
  return Boolean(
    parameterName &&
    isSupportedBinaryPredicate(conditional, parameterName) &&
    isSuccessBranch(childNode(conditional, 'consequent'), parameterName, state.effectSucceed) &&
    isIndependentFailureBranch(
      childNode(conditional, 'alternate'),
      parameterName,
      state.effectFail,
    ),
  );
};

const hasCandidateTokens = (source: string): boolean =>
  source.includes('flatMap') &&
  source.includes('succeed') &&
  source.includes('fail') &&
  source.includes('?') &&
  source.includes('=>');

const rule: SourceRule = {
  create(context: Context) {
    if (!hasCandidateTokens(readCachedSource(context))) {
      return { Program(): void {} };
    }

    let state: MatcherState | undefined = undefined;

    return {
      CallExpression(value): void {
        const matcherState = state;
        if (!matcherState) {
          return;
        }
        const call = asNode(value);
        if (
          call &&
          matcherState.effectFlatMap.matches(childNode(call, 'callee')) &&
          isFilterOrFailGuard(call, matcherState)
        ) {
          context.report({ message: MESSAGE, node: childNode(call, 'callee') ?? call });
        }
      },
      Program(value): void {
        const program = asNode(value);
        if (!program || !hasRuntimeEffectImport(program)) {
          return;
        }
        const matcherState: MatcherState = {
          effectFail: importedEffectCallMatcher(context, 'Effect', ['fail']),
          effectFlatMap: importedEffectCallMatcher(context, 'Effect', ['flatMap']),
          effectSucceed: importedEffectCallMatcher(context, 'Effect', ['succeed']),
        };
        matcherState.effectFail.initialize(program);
        matcherState.effectFlatMap.initialize(program);
        matcherState.effectSucceed.initialize(program);
        state = matcherState;
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
