/* -------------------------------------------------------------------------- */
/*        Prefer Effect.mapBoth over adjacent map and mapError stages.        */
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
    'import { Effect } from "effect"\n\nconst normalized = program.pipe(\n' +
    '  Effect.mapBoth({ onFailure: normalizeError, onSuccess: normalizeValue })\n)',
  fix:
    'Replace the adjacent operators with Effect.mapBoth({ onFailure, onSuccess }), ' +
    'keeping callback expressions in their original evaluation order.',
  summary:
    'Effect.mapBoth expresses adjacent success and failure transformations more directly ' +
    'and in one Effect stage than separate Effect.map and Effect.mapError calls.',
});

const MAP = 1;
const MAP_ERROR = 2;
const MAP_TOKEN = /\bmap\b/;

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

const hasEffectImport = (program: ASTNode): boolean => {
  for (const statement of childNodes(program, 'body')) {
    if (statement.type === 'ImportDeclaration') {
      const source = literalString(childNode(statement, 'source'));
      if (source === 'effect' || source === 'effect/Effect') {
        return true;
      }
    }
  }
  return false;
};

const hasTypeArguments = (node: ASTNode): boolean =>
  Boolean(childNode(node, 'typeArguments') || childNode(node, 'typeParameters'));

const hasOptionalMemberAccess = (node: ASTNode | undefined): boolean => {
  if (node?.type !== 'MemberExpression') {
    return false;
  }
  return (
    Reflect.get(node, 'optional') === true || hasOptionalMemberAccess(childNode(node, 'object'))
  );
};

const isPlainCall = (call: ASTNode): boolean =>
  Reflect.get(call, 'optional') !== true &&
  !hasTypeArguments(call) &&
  !hasOptionalMemberAccess(childNode(call, 'callee'));

const exactArguments = (call: ASTNode, expectedCount: number): ASTNode[] | undefined => {
  const callArguments = childNodes(call, 'arguments');
  if (callArguments.length !== expectedCount || !isPlainCall(call)) {
    return undefined;
  }
  for (const argument of callArguments) {
    if (argument.type === 'SpreadElement') {
      return undefined;
    }
  }
  return callArguments;
};

const isPipeCall = (call: ASTNode): boolean => {
  const callee = childNode(call, 'callee');
  return (
    callee?.type === 'MemberExpression' &&
    Reflect.get(callee, 'computed') !== true &&
    identifierName(childNode(callee, 'property')) === 'pipe' &&
    isPlainCall(call)
  );
};

const hasCandidateTokens = (source: string): boolean =>
  source.includes('mapError') && MAP_TOKEN.test(source);

interface MatcherState {
  consumedNestedCalls: WeakSet<object>;
  context: Context;
  effectMap: ImportedEffectCallMatcher;
  effectMapError: ImportedEffectCallMatcher;
}

const transformationKind = (state: MatcherState, call: ASTNode, expectedCount: number): number => {
  if (!exactArguments(call, expectedCount)) {
    return 0;
  }
  const callee = childNode(call, 'callee');
  if (state.effectMap.matches(callee)) {
    return MAP;
  }
  if (state.effectMapError.matches(callee)) {
    return MAP_ERROR;
  }
  return 0;
};

const isTransformationPair = (
  state: MatcherState,
  first: ASTNode | undefined,
  second: ASTNode | undefined,
  expectedCount: number,
): second is ASTNode => {
  if (first?.type !== 'CallExpression' || second?.type !== 'CallExpression') {
    return false;
  }
  const firstKind = transformationKind(state, first, expectedCount);
  return (
    firstKind !== 0 &&
    firstKind + transformationKind(state, second, expectedCount) === MAP + MAP_ERROR
  );
};

const report = (state: MatcherState, call: ASTNode): void => {
  state.context.report({ message: MESSAGE, node: childNode(call, 'callee') ?? call });
};

const inspectPipe = (state: MatcherState, call: ASTNode): void => {
  const operators = childNodes(call, 'arguments');
  const operatorCount = operators.length;
  for (let index = 0; index + 1 < operatorCount; index += 1) {
    const second = operators[index + 1];
    if (isTransformationPair(state, operators[index], second, 1)) {
      report(state, second);
      index += 1;
    }
  }
};

const nestedPairInner = (state: MatcherState, outer: ASTNode): ASTNode | undefined => {
  if (state.consumedNestedCalls.has(outer)) {
    return undefined;
  }
  const [inner] = childNodes(outer, 'arguments');
  if (
    state.consumedNestedCalls.has(inner ?? outer) ||
    !isTransformationPair(state, inner, outer, 2)
  ) {
    return undefined;
  }
  return inner;
};

const inspectNested = (state: MatcherState, outer: ASTNode): void => {
  const inner = nestedPairInner(state, outer);
  if (!inner) {
    return;
  }
  state.consumedNestedCalls.add(outer);
  state.consumedNestedCalls.add(inner);
  report(state, outer);
};

const rule: SourceRule = {
  create(context: Context) {
    if (!hasCandidateTokens(readCachedSource(context))) {
      return { Program(): void {} };
    }

    const effectMap = importedEffectCallMatcher(context, 'Effect', ['map']);
    const effectMapError = importedEffectCallMatcher(context, 'Effect', ['mapError']);
    const state = {
      consumedNestedCalls: new WeakSet(),
      context,
      effectMap,
      effectMapError,
    } satisfies MatcherState;
    let isInitialized = false;

    return {
      CallExpression(value): void {
        if (!isInitialized) {
          return;
        }
        const call = asNode(value);
        if (!call) {
          return;
        }
        if (isPipeCall(call)) {
          inspectPipe(state, call);
          return;
        }
        inspectNested(state, call);
      },
      Program(value): void {
        const program = asNode(value);
        if (!program || !hasEffectImport(program)) {
          return;
        }
        isInitialized = true;
        effectMap.initialize(program);
        effectMapError.initialize(program);
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
