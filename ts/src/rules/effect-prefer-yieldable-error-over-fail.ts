/* -------------------------------------------------------------------------- */
/*    Prefer yielding eligible Data.TaggedError values directly over fail.    */
/* -------------------------------------------------------------------------- */

import type { Context, SourceRule } from './effect-rule-core';
import type {
  PendingYield,
  ScopeStack,
  VisitorKeys,
  YieldableErrorScanState,
} from './effect-prefer-yieldable-error-over-fail-ast';
import { asNode, childNode, childNodes, identifierName } from './effect-ast';
import {
  indexPendingYields,
  scanYieldableErrorAST,
} from './effect-prefer-yieldable-error-over-fail-ast';
import type { ASTNode } from './effect-ast';
import type { ImportedEffectCallMatcher } from './effect-imported-call-matcher';
import { diagnosticMessage } from './diagnostic-guidance';
import { importedEffectCallMatcher } from './effect-imported-call-matcher';
import { isSchemaTaggedErrorSuperclass } from './effect-yieldable-schema-superclass';
import { readCachedSource } from './source-cache';
import { scopeHasBinding } from './effect-ast-scope';
import { strictPathOptionsSchema } from './effect-path-options';

export {
  default as preferRefGetAndUpdateRule,
  preferAllDiscardRule,
  preferCollectionDiscardOverAsVoidRule,
  preferForEachDiscardRule,
  preferLayerSyncRule,
  preferOptionGetOrElseRule,
  preferOptionNullishGettersRule,
  preferOptionOrElseSomeRule,
} from './effect-prefer-ref-get-and-update';

interface MatcherState extends YieldableErrorScanState {
  dataError: ImportedEffectCallMatcher;
  dataTaggedError: ImportedEffectCallMatcher;
  directRootEffectAPIs: ImportedEffectCallMatcher;
  directRootTaggedError: ImportedEffectCallMatcher;
  effectFail: ImportedEffectCallMatcher;
  effectFn: ImportedEffectCallMatcher;
  effectGen: ImportedEffectCallMatcher;
  schemaTaggedError: ImportedEffectCallMatcher;
}

const MESSAGE = diagnosticMessage({
  example:
    'import { Data, Effect } from "effect"\n\n' +
    'class NotFound extends Data.TaggedError("NotFound")<{ id: string }> {}\n\n' +
    'const program = Effect.gen(function* () {\n' +
    '  return yield* new NotFound({ id })\n' +
    '})',
  fix: 'Remove Effect.fail and yield the recognized Cause.YieldableError instance directly.',
  summary:
    'Yield recognized Cause.YieldableError instances directly instead of wrapping them in Effect.fail.',
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
const hasEffectImport = (statement: ASTNode): boolean =>
  statement.type === 'ImportDeclaration' &&
  ['effect', 'effect/Data', 'effect/Effect', 'effect/Schema'].includes(
    literalString(childNode(statement, 'source')) ?? '',
  );
const hasRuntimeImports = (program: ASTNode): boolean =>
  childNodes(program, 'body').some(hasEffectImport);
const hasTypeArguments = (node: ASTNode): boolean =>
  Boolean(childNode(node, 'typeArguments') || childNode(node, 'typeParameters'));
const isUnknownArray = (value: unknown): value is readonly unknown[] => Array.isArray(value);
const hasUnsupportedMemberAccess = (node: ASTNode | undefined): boolean => {
  let current = node;
  while (current?.type === 'MemberExpression') {
    if (Reflect.get(current, 'computed') === true || Reflect.get(current, 'optional') === true) {
      return true;
    }
    current = childNode(current, 'object');
  }
  return false;
};

const isPlainCall = (call: ASTNode): boolean =>
  Reflect.get(call, 'optional') !== true &&
  !hasTypeArguments(call) &&
  !hasUnsupportedMemberAccess(childNode(call, 'callee'));

const exactArgument = (call: ASTNode, count: number, index: number): ASTNode | undefined => {
  if (!isPlainCall(call)) {
    return undefined;
  }
  const argumentsList: unknown = Reflect.get(call, 'arguments');
  if (!isUnknownArray(argumentsList) || argumentsList.length !== count) {
    return undefined;
  }
  for (const argument of argumentsList) {
    const argumentNode = asNode(argument);
    if (!argumentNode || argumentNode.type === 'SpreadElement') {
      return undefined;
    }
  }
  return asNode(argumentsList[index]);
};

const isImportedCall = (
  callee: ASTNode | undefined,
  matcher: ImportedEffectCallMatcher,
  directRootMatcher: ImportedEffectCallMatcher,
): boolean => matcher.matches(callee) && !directRootMatcher.matches(callee);

const isEmptyUndecoratedClass = (node: ASTNode): boolean => {
  const body = childNode(node, 'body');
  return (
    node.type === 'ClassDeclaration' &&
    childNodes(node, 'decorators').length === 0 &&
    body?.type === 'ClassBody' &&
    childNodes(body, 'body').length === 0
  );
};

const isDataTaggedErrorSuperclass = (node: ASTNode | undefined, state: MatcherState): boolean => {
  if (node?.type !== 'CallExpression') {
    return false;
  }
  const callee = childNode(node, 'callee');
  const tag = exactArgument(node, 1, 0);
  return (
    tag !== undefined &&
    literalString(tag) !== undefined &&
    isImportedCall(callee, state.dataTaggedError, state.directRootTaggedError)
  );
};

const isDataErrorSuperclass = (node: ASTNode | undefined, state: MatcherState): boolean =>
  Boolean(node && !hasUnsupportedMemberAccess(node) && state.dataError.matches(node));

const isKnownYieldableErrorSuperclass = (node: ASTNode | undefined, state: MatcherState): boolean =>
  isDataErrorSuperclass(node, state) ||
  isDataTaggedErrorSuperclass(node, state) ||
  isSchemaTaggedErrorSuperclass(node, state.schemaTaggedError);

const topLevelDeclaration = (statement: ASTNode): ASTNode | undefined => {
  if (
    statement.type === 'ExportNamedDeclaration' ||
    statement.type === 'ExportDefaultDeclaration'
  ) {
    return childNode(statement, 'declaration');
  }
  return statement;
};

const eligibleClassName = (statement: ASTNode, state: MatcherState): string | undefined => {
  const declaration = topLevelDeclaration(statement);
  if (!declaration || !isEmptyUndecoratedClass(declaration)) {
    return undefined;
  }
  const name = identifierName(childNode(declaration, 'id'));
  if (!name || !isKnownYieldableErrorSuperclass(childNode(declaration, 'superClass'), state)) {
    return undefined;
  }
  return name;
};

const eligibleClassNames = (program: ASTNode, state: MatcherState): ReadonlySet<string> => {
  const names = new Set<string>();
  for (const statement of childNodes(program, 'body')) {
    const name = eligibleClassName(statement, state);
    if (name) {
      names.add(name);
    }
  }
  return names;
};

const prototypeOwnerName = (node: ASTNode | undefined): string | undefined => {
  let current = node;
  while (current?.type === 'MemberExpression') {
    if (identifierName(childNode(current, 'property')) === 'prototype') {
      return identifierName(childNode(current, 'object'));
    }
    current = childNode(current, 'object');
  }
  return undefined;
};

const mutatedClassName = (node: ASTNode | undefined): string | undefined =>
  identifierName(node) ?? prototypeOwnerName(node);

const mutationName = (node: ASTNode): string | undefined => {
  if (node.type === 'AssignmentExpression') {
    return mutatedClassName(childNode(node, 'left'));
  }
  if (node.type === 'UpdateExpression') {
    return mutatedClassName(childNode(node, 'argument'));
  }
  return undefined;
};

const isInlineGenerator = (node: ASTNode | undefined): node is ASTNode =>
  node?.type === 'FunctionExpression' &&
  Reflect.get(node, 'generator') === true &&
  Reflect.get(node, 'async') !== true;

const isExactSelfProperty = (node: ASTNode | undefined): boolean => {
  if (node?.type !== 'Property' || Reflect.get(node, 'kind') !== 'init') {
    return false;
  }
  if (
    Reflect.get(node, 'computed') === true ||
    Reflect.get(node, 'method') === true ||
    Reflect.get(node, 'shorthand') === true
  ) {
    return false;
  }
  return (
    identifierName(childNode(node, 'key')) === 'self' && childNode(node, 'value') !== undefined
  );
};

const isExactSelfOptions = (node: ASTNode | undefined): boolean => {
  if (node?.type !== 'ObjectExpression') {
    return false;
  }
  const properties: unknown = Reflect.get(node, 'properties');
  if (!isUnknownArray(properties) || properties.length !== 1) {
    return false;
  }
  return isExactSelfProperty(asNode(properties[0]));
};

const isDirectHost = (callee: ASTNode | undefined, state: MatcherState): boolean =>
  isImportedCall(callee, state.effectGen, state.directRootEffectAPIs) ||
  isImportedCall(callee, state.effectFn, state.directRootEffectAPIs);

const isSelfGenHost = (
  callee: ASTNode | undefined,
  options: ASTNode | undefined,
  generator: ASTNode | undefined,
  state: MatcherState,
): boolean =>
  isExactSelfOptions(options) &&
  isInlineGenerator(generator) &&
  isImportedCall(callee, state.effectGen, state.directRootEffectAPIs);

const hostGenerator = (call: ASTNode, state: MatcherState): ASTNode | undefined => {
  const callee = childNode(call, 'callee');
  const directGenerator = exactArgument(call, 1, 0);
  if (isInlineGenerator(directGenerator) && isDirectHost(callee, state)) {
    return directGenerator;
  }
  const options = exactArgument(call, 2, 0);
  const generator = exactArgument(call, 2, 1);
  if (isSelfGenHost(callee, options, generator, state)) {
    return generator;
  }
  return undefined;
};

const hasShadow = (name: string, scopes: ScopeStack): boolean => scopeHasBinding(name, scopes);

const eligibleNewClassName = (
  newExpression: ASTNode,
  scopes: ScopeStack,
  state: MatcherState,
): string | undefined => {
  if (hasTypeArguments(newExpression)) {
    return undefined;
  }
  const name = identifierName(childNode(newExpression, 'callee'));
  if (!name || hasShadow(name, scopes) || !state.eligibleClasses.has(name)) {
    return undefined;
  }
  return name;
};

type MatchingFailure = readonly [callee: ASTNode, errorValue: ASTNode];

const matchingFailure = (
  yieldExpression: ASTNode,
  state: MatcherState,
): MatchingFailure | undefined => {
  const failCall = childNode(yieldExpression, 'argument');
  if (Reflect.get(yieldExpression, 'delegate') !== true || failCall?.type !== 'CallExpression') {
    return undefined;
  }
  const errorValue = exactArgument(failCall, 1, 0);
  const callee = childNode(failCall, 'callee');
  if (!errorValue || errorValue.type !== 'NewExpression') {
    return undefined;
  }
  if (callee && isImportedCall(callee, state.effectFail, state.directRootEffectAPIs)) {
    return [callee, errorValue];
  }
  return undefined;
};

const pendingYield = (
  node: ASTNode,
  scopes: ScopeStack,
  state: MatcherState,
): PendingYield | undefined => {
  const failure = matchingFailure(node, state);
  if (!failure) {
    return undefined;
  }
  const className = eligibleNewClassName(failure[1], scopes, state);
  if (!className) {
    return undefined;
  }
  return [node, failure[0], className];
};

const candidateTokens = ['effect', 'yield', 'fail', 'Error', 'new'] as const;

const hasCandidateTokens = (source: string): boolean =>
  candidateTokens.every((token): boolean => source.includes(token));

const initializedMatcher = (
  context: Context,
  program: ASTNode,
  APIName: string,
  names: readonly string[],
): ImportedEffectCallMatcher => {
  const matcher = importedEffectCallMatcher(context, APIName, names);
  matcher.initialize(program);
  return matcher;
};

const NO_IMPORTED_CALL_MATCHER: ImportedEffectCallMatcher = {
  initialize(): void {},
  matches(): boolean {
    return false;
  },
};

const isVisitorKeys = (value: unknown): value is VisitorKeys =>
  value !== null && typeof value === 'object';

const visitorKeysFor = (context: Context): VisitorKeys | undefined => {
  const { sourceCode } = context;
  const value: unknown = sourceCode && Reflect.get(sourceCode, 'visitorKeys');
  if (isVisitorKeys(value)) {
    return value;
  }
  return undefined;
};

const initializeRuntimeMatchers = (
  context: Context,
  program: ASTNode,
  state: MatcherState,
): void => {
  const mutableState = state;
  mutableState.directRootEffectAPIs = initializedMatcher(context, program, 'Data', [
    'fail',
    'fn',
    'fnUntraced',
    'gen',
  ]);
  mutableState.effectFail = initializedMatcher(context, program, 'Effect', ['fail']);
  mutableState.effectFn = initializedMatcher(context, program, 'Effect', ['fn', 'fnUntraced']);
  mutableState.effectGen = initializedMatcher(context, program, 'Effect', ['gen']);
};

const indexedMatcherState = (context: Context, program: ASTNode): MatcherState => {
  const state: MatcherState = {
    dataError: initializedMatcher(context, program, 'Data', ['Error']),
    dataTaggedError: initializedMatcher(context, program, 'Data', ['TaggedError']),
    directRootEffectAPIs: NO_IMPORTED_CALL_MATCHER,
    directRootTaggedError: initializedMatcher(context, program, 'Effect', ['TaggedError']),
    effectFail: NO_IMPORTED_CALL_MATCHER,
    effectFn: NO_IMPORTED_CALL_MATCHER,
    effectGen: NO_IMPORTED_CALL_MATCHER,
    eligibleClasses: new Set<string>(),
    indexedYields: new WeakMap(),
    pendingYields: [],
    scannedHostCallbacks: new WeakSet(),
    schemaTaggedError: initializedMatcher(context, program, 'Schema', ['TaggedError']),
    unsafeClasses: new Set<string>(),
    visitorKeys: visitorKeysFor(context),
  };
  const classes = eligibleClassNames(program, state);
  if (classes.size === 0) {
    state.eligibleClasses = classes;
    return state;
  }
  state.eligibleClasses = classes;
  initializeRuntimeMatchers(context, program, state);
  scanYieldableErrorAST(program, state, { hostGenerator, mutationName, pendingYield });
  indexPendingYields(state);
  return state;
};

const rule: SourceRule = {
  create(context: Context) {
    if (!hasCandidateTokens(readCachedSource(context))) {
      return { Program(): void {} };
    }

    let state: MatcherState | undefined = undefined;
    return {
      Program(value): void {
        const program = asNode(value);
        if (!program || !hasRuntimeImports(program)) {
          return;
        }
        state = indexedMatcherState(context, program);
      },
      YieldExpression(value): void {
        const yieldExpression = asNode(value);
        const callee = yieldExpression && state?.indexedYields.get(yieldExpression);
        if (!callee) {
          return;
        }
        context.report({ message: MESSAGE, node: callee });
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
