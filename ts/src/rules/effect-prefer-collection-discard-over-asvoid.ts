/* -------------------------------------------------------------------------- */
/*       Prefer collection discard mode over a trailing Effect.asVoid.        */
/* -------------------------------------------------------------------------- */

import type { Context, SourceRule } from './effect-rule-core';
import { asNode, childNode, childNodes, identifierName } from './effect-ast';
import type { ASTNode } from './effect-ast';
import type { ImportedEffectCallMatcher } from './effect-imported-call-matcher';
import type { ScopeStack } from './effect-ast-scope';
import { diagnosticMessage } from './diagnostic-guidance';
import { importedEffectCallMatcher } from './effect-imported-call-matcher';
import { readCachedSource } from './source-cache';
import { scopeHasBinding } from './effect-ast-scope';
import { strictPathOptionsSchema } from './effect-path-options';
import { visitASTWithStack } from './effect-ast-stack-safe-walker';

const MESSAGE = diagnosticMessage({
  example:
    'import { Effect } from "effect"\n\n' +
    'const done = Effect.forEach(items, work, { discard: true })',
  fix: 'Set discard: true in the collection options and remove the trailing Effect.asVoid.',
  summary:
    'Use collection discard mode instead of Effect.asVoid so Effect.all or Effect.forEach does not collect values that are immediately discarded.',
});

const ALL_OPTION_KEYS = new Set(['batching', 'concurrency', 'concurrentFinalizers', 'mode']);
const FOREACH_OPTION_KEYS = new Set(['batching', 'concurrency', 'concurrentFinalizers']);
const FOREACH_ARGUMENT_COUNT = 2;
const FOREACH_WITH_OPTIONS_ARGUMENT_COUNT = 3;

interface MatcherState {
  effectAll: ImportedEffectCallMatcher;
  effectAsVoid: WeakSet<object>;
  effectForEach: ImportedEffectCallMatcher;
  rootPackageNamespaces: ReadonlySet<string>;
}

type AsVoidBindingKind = 'direct' | 'namespace' | 'root';

interface AsVoidBinding {
  kind: AsVoidBindingKind;
  name: string;
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

const importedName = (specifier: ASTNode): string | undefined =>
  identifierName(childNode(specifier, 'imported')) ??
  literalString(childNode(specifier, 'imported'));

const rootAsVoidBindingKind = (specifier: ASTNode): AsVoidBindingKind | undefined => {
  if (specifier.type === 'ImportNamespaceSpecifier') {
    return 'root';
  }
  if (specifier.type === 'ImportSpecifier' && importedName(specifier) === 'Effect') {
    return 'namespace';
  }
  return undefined;
};

const subpathAsVoidBindingKind = (specifier: ASTNode): AsVoidBindingKind | undefined => {
  if (specifier.type === 'ImportNamespaceSpecifier') {
    return 'namespace';
  }
  if (specifier.type === 'ImportSpecifier' && importedName(specifier) === 'asVoid') {
    return 'direct';
  }
  return undefined;
};

const asVoidBindingKind = (
  source: string | undefined,
  specifier: ASTNode,
): AsVoidBindingKind | undefined => {
  if (source === 'effect') {
    return rootAsVoidBindingKind(specifier);
  }
  if (source === 'effect/Effect') {
    return subpathAsVoidBindingKind(specifier);
  }
  return undefined;
};

const asVoidBinding = (
  source: string | undefined,
  specifier: ASTNode,
): AsVoidBinding | undefined => {
  if (isTypeImport(specifier)) {
    return undefined;
  }
  const name = identifierName(childNode(specifier, 'local'));
  const kind = asVoidBindingKind(source, specifier);
  if (!name || !kind) {
    return undefined;
  }
  return { kind, name };
};

const addAsVoidBindings = (statement: ASTNode, bindings: Map<string, AsVoidBindingKind>): void => {
  if (statement.type !== 'ImportDeclaration' || isTypeImport(statement)) {
    return;
  }
  const source = literalString(childNode(statement, 'source'));
  for (const specifier of childNodes(statement, 'specifiers')) {
    const binding = asVoidBinding(source, specifier);
    if (binding) {
      bindings.set(binding.name, binding.kind);
    }
  }
};

const collectAsVoidBindings = (program: ASTNode): ReadonlyMap<string, AsVoidBindingKind> => {
  const bindings = new Map<string, AsVoidBindingKind>();
  for (const statement of childNodes(program, 'body')) {
    addAsVoidBindings(statement, bindings);
  }
  return bindings;
};

const memberObject = (node: ASTNode, propertyName: string): ASTNode | undefined => {
  if (
    node.type !== 'MemberExpression' ||
    identifierName(childNode(node, 'property')) !== propertyName
  ) {
    return undefined;
  }
  return childNode(node, 'object');
};

const matchingBindingName = (
  node: ASTNode | undefined,
  kind: AsVoidBindingKind,
  bindings: ReadonlyMap<string, AsVoidBindingKind>,
): string | undefined => {
  const name = identifierName(node);
  if (!name) {
    return undefined;
  }
  if (bindings.get(name) === kind) {
    return name;
  }
  return undefined;
};

const asVoidReferenceName = (
  node: ASTNode,
  bindings: ReadonlyMap<string, AsVoidBindingKind>,
): string | undefined => {
  const directName = matchingBindingName(node, 'direct', bindings);
  if (directName) {
    return directName;
  }
  const object = memberObject(node, 'asVoid');
  const namespaceName = matchingBindingName(object, 'namespace', bindings);
  if (namespaceName) {
    return namespaceName;
  }
  const root = object && memberObject(object, 'Effect');
  return matchingBindingName(root, 'root', bindings);
};

const isShadowed = (name: string, scopes: ScopeStack): boolean => scopeHasBinding(name, scopes);

const indexAsVoidReferences = (
  program: ASTNode,
  bindings: ReadonlyMap<string, AsVoidBindingKind>,
): WeakSet<object> => {
  const references = new WeakSet();
  visitASTWithStack({
    context: references,
    onNode(node, nodeScopes): { context: WeakSet<object>; visitChildren: boolean } {
      const name = asVoidReferenceName(node, bindings);
      if (name && !isShadowed(name, nodeScopes)) {
        references.add(node);
      }
      return { context: references, visitChildren: true };
    },
    root: program,
    scopes: [],
  });
  return references;
};

const rootPackageNamespaces = (
  bindings: ReadonlyMap<string, AsVoidBindingKind>,
): ReadonlySet<string> => {
  const namespaces = new Set<string>();
  for (const [name, kind] of bindings) {
    if (kind === 'root') {
      namespaces.add(name);
    }
  }
  return namespaces;
};

const hasTypeArguments = (node: ASTNode): boolean =>
  Boolean(childNode(node, 'typeArguments') || childNode(node, 'typeParameters'));

const hasUnsupportedMemberAccess = (node: ASTNode | undefined): boolean => {
  const seen = new WeakSet();
  let current = node;
  while (current?.type === 'MemberExpression' && !seen.has(current)) {
    seen.add(current);
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

const exactArguments = (
  call: ASTNode,
  minimum: number,
  maximum = minimum,
): ASTNode[] | undefined => {
  if (!isPlainCall(call)) {
    return undefined;
  }
  const callArguments = childNodes(call, 'arguments');
  if (
    callArguments.length < minimum ||
    callArguments.length > maximum ||
    callArguments.some((argument): boolean => argument.type === 'SpreadElement')
  ) {
    return undefined;
  }
  return callArguments;
};

const isDirectRootPackageAPI = (
  callee: ASTNode | undefined,
  namespaces: ReadonlySet<string>,
): boolean =>
  callee?.type === 'MemberExpression' &&
  namespaces.has(identifierName(childNode(callee, 'object')) ?? '');

const staticPropertyName = (property: ASTNode): string | undefined => {
  const key = childNode(property, 'key');
  return identifierName(key) ?? literalString(key);
};

const isStaticOptionsProperty = (property: ASTNode): boolean =>
  property.type === 'Property' &&
  Reflect.get(property, 'kind') === 'init' &&
  Reflect.get(property, 'computed') !== true &&
  Reflect.get(property, 'method') !== true &&
  Reflect.get(property, 'optional') !== true;

const safeOptionName = (
  property: ASTNode,
  allowedKeys: ReadonlySet<string>,
  keys: ReadonlySet<string>,
): string | undefined => {
  if (!isStaticOptionsProperty(property)) {
    return undefined;
  }
  const name = staticPropertyName(property);
  if (!name || !allowedKeys.has(name) || keys.has(name)) {
    return undefined;
  }
  return name;
};

const optionKeys = (
  node: ASTNode,
  allowedKeys: ReadonlySet<string>,
): ReadonlySet<string> | undefined => {
  if (node.type !== 'ObjectExpression') {
    return undefined;
  }
  const keys = new Set<string>();
  for (const property of childNodes(node, 'properties')) {
    const name = safeOptionName(property, allowedKeys, keys);
    if (!name) {
      return undefined;
    }
    keys.add(name);
  }
  return keys;
};

const isDirectArray = (node: ASTNode): boolean =>
  node.type === 'ArrayExpression' &&
  !childNodes(node, 'elements').some((element): boolean => element.type === 'SpreadElement');

const matchesImportedAPI = (
  callee: ASTNode | undefined,
  matcher: ImportedEffectCallMatcher,
  state: MatcherState,
): boolean =>
  matcher.matches(callee) && !isDirectRootPackageAPI(callee, state.rootPackageNamespaces);

const matchesImportedAsVoid = (operator: ASTNode, state: MatcherState): boolean =>
  state.effectAsVoid.has(operator) &&
  !isDirectRootPackageAPI(operator, state.rootPackageNamespaces);

const isAllCall = (call: ASTNode, state: MatcherState): boolean => {
  const callee = childNode(call, 'callee');
  if (!matchesImportedAPI(callee, state.effectAll, state)) {
    return false;
  }
  const callArguments = exactArguments(call, 1, 2);
  if (!callArguments) {
    return false;
  }
  const [input, options] = callArguments;
  if (!isDirectArray(input)) {
    return false;
  }
  return options === undefined || optionKeys(options, ALL_OPTION_KEYS) !== undefined;
};

const isSafeForEachOptions = (options: ASTNode | undefined, input: ASTNode): boolean => {
  if (!options) {
    return true;
  }
  const keys = optionKeys(options, FOREACH_OPTION_KEYS);
  if (!keys) {
    return false;
  }
  if (!keys.has('concurrency') && !keys.has('batching')) {
    return true;
  }
  return isDirectArray(input);
};

const isForEachCall = (call: ASTNode, state: MatcherState): boolean => {
  const callee = childNode(call, 'callee');
  if (!matchesImportedAPI(callee, state.effectForEach, state)) {
    return false;
  }
  const callArguments = exactArguments(
    call,
    FOREACH_ARGUMENT_COUNT,
    FOREACH_WITH_OPTIONS_ARGUMENT_COUNT,
  );
  if (!callArguments) {
    return false;
  }
  const [input, , options] = callArguments;
  return isSafeForEachOptions(options, input);
};

const collectionCall = (outerCall: ASTNode): ASTNode | undefined => {
  const callee = childNode(outerCall, 'callee');
  if (
    callee?.type !== 'MemberExpression' ||
    identifierName(childNode(callee, 'property')) !== 'pipe'
  ) {
    return undefined;
  }
  const collection = childNode(callee, 'object');
  if (collection?.type === 'CallExpression') {
    return collection;
  }
  return undefined;
};

const discardedCollectionOperator = (call: ASTNode, state: MatcherState): ASTNode | undefined => {
  const callArguments = exactArguments(call, 1);
  if (!callArguments) {
    return undefined;
  }
  const [operator] = callArguments;
  if (hasUnsupportedMemberAccess(operator) || !matchesImportedAsVoid(operator, state)) {
    return undefined;
  }
  const collection = collectionCall(call);
  if (!collection || (!isAllCall(collection, state) && !isForEachCall(collection, state))) {
    return undefined;
  }
  return operator;
};

const hasCandidateTokens = (source: string): boolean =>
  source.includes('effect') &&
  source.includes('asVoid') &&
  (source.includes('all') || source.includes('forEach'));

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
        const operator = discardedCollectionOperator(call, state);
        if (operator) {
          context.report({ message: MESSAGE, node: operator });
        }
      },
      Program(value): void {
        const program = asNode(value);
        if (!program) {
          return;
        }
        const asVoidBindings = collectAsVoidBindings(program);
        const matcherState: MatcherState = {
          effectAll: importedEffectCallMatcher(context, 'Effect', ['all']),
          effectAsVoid: indexAsVoidReferences(program, asVoidBindings),
          effectForEach: importedEffectCallMatcher(context, 'Effect', ['forEach']),
          rootPackageNamespaces: rootPackageNamespaces(asVoidBindings),
        };
        matcherState.effectAll.initialize(program);
        matcherState.effectForEach.initialize(program);
        state = matcherState;
      },
    };
  },
  meta: {
    docs: { description: MESSAGE },
    schema: strictPathOptionsSchema,
    type: 'problem',
  },
};

export default rule;
export {
  default as preferAllDiscardRule,
  preferForEachDiscardRule,
} from './effect-prefer-all-discard';
