/* -------------------------------------------------------------------------- */
/*    Prefer yielding eligible Data.TaggedError values directly over fail.    */
/* -------------------------------------------------------------------------- */

import type { Context, SourceRule } from './effect-rule-core';
import { asNode, childNode, childNodes, identifierName } from './effect-ast';
import { scopesForChild, withNodeScope } from './effect-ast-scope';
import type { ASTNode } from './effect-ast';
import type { ImportedEffectCallMatcher } from './effect-imported-call-matcher';
import { diagnosticMessage } from './diagnostic-guidance';
import { importedEffectCallMatcher } from './effect-imported-call-matcher';
import { isSchemaTaggedErrorSuperclass } from './effect-yieldable-schema-superclass';
import { readCachedSource } from './source-cache';
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

interface MatcherState {
  dataError: ImportedEffectCallMatcher;
  dataTaggedError: ImportedEffectCallMatcher;
  directRootEffectAPIs: ImportedEffectCallMatcher;
  directRootTaggedError: ImportedEffectCallMatcher;
  effectFail: ImportedEffectCallMatcher;
  effectFn: ImportedEffectCallMatcher;
  effectGen: ImportedEffectCallMatcher;
  eligibleClasses: ReadonlySet<string>;
  indexedYields: WeakMap<object, ASTNode>;
  scannedHostCallbacks: WeakSet<object>;
  schemaTaggedError: ImportedEffectCallMatcher;
  unsafeClasses: ReadonlySet<string>;
}
type ScopeStack = readonly ReadonlySet<string>[];

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
const hasUnsupportedMemberAccess = (node: ASTNode | undefined): boolean =>
  node?.type === 'MemberExpression' &&
  (Reflect.get(node, 'computed') === true ||
    Reflect.get(node, 'optional') === true ||
    hasUnsupportedMemberAccess(childNode(node, 'object')));

const isPlainCall = (call: ASTNode): boolean =>
  Reflect.get(call, 'optional') !== true &&
  !hasTypeArguments(call) &&
  !hasUnsupportedMemberAccess(childNode(call, 'callee'));

const exactArguments = (call: ASTNode, count: number): ASTNode[] | undefined => {
  const argumentsList = childNodes(call, 'arguments');
  if (
    !isPlainCall(call) ||
    argumentsList.length !== count ||
    argumentsList.some((argument): boolean => argument.type === 'SpreadElement')
  ) {
    return undefined;
  }
  return argumentsList;
};

const isImportedCall = (
  callee: ASTNode | undefined,
  matcher: ImportedEffectCallMatcher,
  directRootMatcher: ImportedEffectCallMatcher,
): boolean => matcher.matches(callee) && !directRootMatcher.matches(callee);

const isUnknownArray = (value: unknown): value is readonly unknown[] => Array.isArray(value);

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
  const argumentsList = exactArguments(node, 1);
  const callee = childNode(node, 'callee');
  const [tag] = argumentsList ?? [];
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
  if (node?.type !== 'MemberExpression') {
    return undefined;
  }
  if (identifierName(childNode(node, 'property')) === 'prototype') {
    return identifierName(childNode(node, 'object'));
  }
  return prototypeOwnerName(childNode(node, 'object'));
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

const collectUnsafeClassNames = (
  value: unknown,
  eligibleClasses: ReadonlySet<string>,
  unsafeClasses: Set<string>,
): void => {
  if (isUnknownArray(value)) {
    value.forEach((item): void => collectUnsafeClassNames(item, eligibleClasses, unsafeClasses));
    return;
  }
  const node = asNode(value);
  if (!node) {
    return;
  }
  const name = mutationName(node);
  if (name && eligibleClasses.has(name)) {
    unsafeClasses.add(name);
  }
  Object.entries(node).forEach(([key, child]): void => {
    if (key !== 'parent') {
      collectUnsafeClassNames(child, eligibleClasses, unsafeClasses);
    }
  });
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
  const properties = childNodes(node, 'properties');
  return properties.length === 1 && isExactSelfProperty(properties[0]);
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
  const [directGenerator] = exactArguments(call, 1) ?? [];
  if (isInlineGenerator(directGenerator) && isDirectHost(callee, state)) {
    return directGenerator;
  }
  const [options, generator] = exactArguments(call, 2) ?? [];
  if (isSelfGenHost(callee, options, generator, state)) {
    return generator;
  }
  return undefined;
};

const isFunction = (node: ASTNode): boolean =>
  node.type === 'ArrowFunctionExpression' ||
  node.type === 'FunctionDeclaration' ||
  node.type === 'FunctionExpression';

const hasShadow = (name: string, scopes: ScopeStack): boolean =>
  scopes.some((scope): boolean => scope.has(name));

const isEligibleNewClass = (
  newExpression: ASTNode,
  scopes: ScopeStack,
  state: MatcherState,
): boolean => {
  if (hasTypeArguments(newExpression)) {
    return false;
  }
  const name = identifierName(childNode(newExpression, 'callee'));
  return Boolean(
    name &&
    !hasShadow(name, scopes) &&
    !state.unsafeClasses.has(name) &&
    state.eligibleClasses.has(name),
  );
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
  const [errorValue] = exactArguments(failCall, 1) ?? [];
  const callee = childNode(failCall, 'callee');
  if (!errorValue || errorValue.type !== 'NewExpression') {
    return undefined;
  }
  if (callee && isImportedCall(callee, state.effectFail, state.directRootEffectAPIs)) {
    return [callee, errorValue];
  }
  return undefined;
};

const indexedFailCallee = (
  node: ASTNode,
  scopes: ScopeStack,
  state: MatcherState,
): ASTNode | undefined => {
  const failure = matchingFailure(node, state);
  if (!failure) {
    return undefined;
  }
  if (!isEligibleNewClass(failure[1], scopes, state)) {
    return undefined;
  }
  return failure[0];
};

const scanValue = (
  value: unknown,
  scopes: ScopeStack,
  state: MatcherState,
  canIndexYields: boolean,
): void => {
  if (isUnknownArray(value)) {
    for (const item of value) {
      const child = asNode(item);
      if (child) {
        scanNode(child, scopes, state, canIndexYields);
      }
    }
    return;
  }
  const child = asNode(value);
  if (child) {
    scanNode(child, scopes, state, canIndexYields);
  }
};

const scanHostCallback = (generator: ASTNode, scopes: ScopeStack, state: MatcherState): void => {
  if (state.scannedHostCallbacks.has(generator)) {
    return;
  }
  state.scannedHostCallbacks.add(generator);
  const body = childNode(generator, 'body');
  if (!body) {
    return;
  }
  const generatorScopes = withNodeScope(scopes, generator);
  scanNode(body, scopesForChild(generatorScopes, generator, 'body'), state, true);
};

const scanHostCall = (node: ASTNode, scopes: ScopeStack, state: MatcherState): void => {
  if (node.type !== 'CallExpression') {
    return;
  }
  const generator = hostGenerator(node, state);
  if (generator) {
    scanHostCallback(generator, scopes, state);
  }
};

const scanChildren = (
  node: ASTNode,
  scopes: ScopeStack,
  state: MatcherState,
  canIndexYields: boolean,
): void => {
  for (const [key, value] of Object.entries(node)) {
    if (key !== 'parent') {
      scanValue(value, scopesForChild(scopes, node, key), state, canIndexYields);
    }
  }
};

const indexYield = (
  node: ASTNode,
  scopes: ScopeStack,
  state: MatcherState,
  canIndexYields: boolean,
): void => {
  if (!canIndexYields || node.type !== 'YieldExpression') {
    return;
  }
  const callee = indexedFailCallee(node, scopes, state);
  if (callee) {
    state.indexedYields.set(node, callee);
  }
};

const scanNode = (
  node: ASTNode,
  scopes: ScopeStack,
  state: MatcherState,
  canIndexYields: boolean,
): void => {
  indexYield(node, scopes, state, canIndexYields);
  scanHostCall(node, scopes, state);
  let nodeScopes = scopes;
  if (node.type !== 'Program') {
    nodeScopes = withNodeScope(scopes, node);
  }
  const childCanIndexYields = canIndexYields && !isFunction(node);
  scanChildren(node, nodeScopes, state, childCanIndexYields);
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

const indexedMatcherState = (context: Context, program: ASTNode): MatcherState => {
  const state: MatcherState = {
    dataError: initializedMatcher(context, program, 'Data', ['Error']),
    dataTaggedError: initializedMatcher(context, program, 'Data', ['TaggedError']),
    directRootEffectAPIs: initializedMatcher(context, program, 'Data', [
      'fail',
      'fn',
      'fnUntraced',
      'gen',
    ]),
    directRootTaggedError: initializedMatcher(context, program, 'Effect', ['TaggedError']),
    effectFail: initializedMatcher(context, program, 'Effect', ['fail']),
    effectFn: initializedMatcher(context, program, 'Effect', ['fn', 'fnUntraced']),
    effectGen: initializedMatcher(context, program, 'Effect', ['gen']),
    eligibleClasses: new Set<string>(),
    indexedYields: new WeakMap(),
    scannedHostCallbacks: new WeakSet(),
    schemaTaggedError: initializedMatcher(context, program, 'Schema', ['TaggedError']),
    unsafeClasses: new Set<string>(),
  };
  const classes = eligibleClassNames(program, state);
  const unsafeClasses = new Set<string>();
  collectUnsafeClassNames(program, classes, unsafeClasses);
  state.eligibleClasses = classes;
  state.unsafeClasses = unsafeClasses;
  scanNode(program, [], state, false);
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
