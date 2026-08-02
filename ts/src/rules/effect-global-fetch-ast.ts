/* -------------------------------------------------------------------------- */
/*        Scope-aware global fetch detection inside Effect async APIs.        */
/* -------------------------------------------------------------------------- */

import type { NativeReference, NativeSourceCode } from './effect-native-references';
import { asNode, childNode, childNodes, identifierName } from './effect-ast';
import {
  globalFetchAsyncWrapperNames,
  indexGlobalFetchImports,
} from './effect-global-fetch-imports';
import {
  isImportReference,
  nativeReferenceIndexFor,
  nativeSourceCodeFor,
} from './effect-native-references';
import type { ASTNode } from './effect-ast';
import type { Context } from './effect-rule-core';
import type { GlobalFetchImportIndex } from './effect-global-fetch-imports';
import type { ScopeStack } from './effect-ast-scope';
import { scopeHasBinding } from './effect-ast-scope';
import { visitFallbackTree } from './effect-global-fetch-ast-traversal';

type VisitorMap = Record<string, (node: object) => void>;

interface FetchRuleState extends GlobalFetchImportIndex {
  context: Context;
  directWrappers: Set<string>;
  fallbackImportBindings: Set<string>;
  fallbackScopes: WeakMap<object, ScopeStack>;
  initializedPrograms: WeakSet<object>;
  namespaces: Set<string>;
  rootNamespaces: Set<string>;
  seenFetchCalls: WeakSet<object>;
  sourceCode: NativeSourceCode | undefined;
  source: string;
}

const nativeReferenceCaches = new WeakMap<FetchRuleState, WeakMap<object, NativeReference>>();

const isShadowed = (name: string, scopes: ScopeStack): boolean => scopeHasBinding(name, scopes);

const stringValue = (node: ASTNode | undefined): string | undefined => {
  if (node?.type !== 'Literal') {
    return undefined;
  }
  const value: unknown = Reflect.get(node, 'value');
  if (typeof value === 'string') {
    return value;
  }
  return undefined;
};

const indexFallbackScopes = (state: FetchRuleState, program: ASTNode): void => {
  visitFallbackTree(program, [state.fallbackImportBindings], (node, scopes): boolean => {
    state.fallbackScopes.set(node, scopes);
    return true;
  });
};

const memberParts = (
  node: ASTNode | undefined,
): { object?: ASTNode; objectName?: string; propertyName?: string } => {
  if (node?.type !== 'MemberExpression' || Reflect.get(node, 'computed') === true) {
    return {};
  }
  const object = childNode(node, 'object');
  return {
    object,
    objectName: identifierName(object),
    propertyName: identifierName(childNode(node, 'property')),
  };
};

const isImportedReference = (state: FetchRuleState, node: ASTNode | undefined): boolean =>
  isImportReference(node, nativeReferencesFor(state));

const nativeReferencesFor = (
  state: FetchRuleState,
): WeakMap<object, NativeReference> | undefined => {
  const cached = nativeReferenceCaches.get(state);
  if (cached) {
    return cached;
  }
  if (!state.sourceCode) {
    return undefined;
  }
  const references = nativeReferenceIndexFor(state.sourceCode);
  nativeReferenceCaches.set(state, references);
  return references;
};

const isUnresolvedReference = (state: FetchRuleState, node: ASTNode): boolean => {
  const reference = nativeReferencesFor(state)?.get(node);
  return reference !== undefined && reference.resolved === null;
};

const isTypeOnlyDefinition = (definition: object): boolean => {
  const declaration: unknown = Reflect.get(definition, 'parent');
  const specifier: unknown = Reflect.get(definition, 'node');
  return (
    (declaration !== null &&
      typeof declaration === 'object' &&
      Reflect.get(declaration, 'importKind') === 'type') ||
    (specifier !== null &&
      typeof specifier === 'object' &&
      Reflect.get(specifier, 'importKind') === 'type')
  );
};

const isTypeOnlyReference = (state: FetchRuleState, node: ASTNode): boolean => {
  const definitions = nativeReferencesFor(state)?.get(node)?.resolved?.defs;
  return definitions?.some(isTypeOnlyDefinition) ?? false;
};

const isEffectMemberWrapper = (
  state: FetchRuleState,
  callee: ASTNode | undefined,
  scopes: ScopeStack,
): boolean => {
  const { object, objectName, propertyName } = memberParts(callee);
  if (
    !object ||
    !objectName ||
    !propertyName ||
    !state.namespaces.has(objectName) ||
    !globalFetchAsyncWrapperNames.has(propertyName)
  ) {
    return false;
  }
  if (state.sourceCode) {
    return isImportedReference(state, object);
  }
  return !isShadowed(objectName, scopes);
};

const isEffectRootWrapper = (
  state: FetchRuleState,
  callee: ASTNode | undefined,
  scopes: ScopeStack,
): boolean => {
  const { object: effectMember, propertyName } = memberParts(callee);
  if (!effectMember || !propertyName || !globalFetchAsyncWrapperNames.has(propertyName)) {
    return false;
  }
  const { object: root, objectName: rootName, propertyName: APIName } = memberParts(effectMember);
  if (!root || !rootName || APIName !== 'Effect' || !state.rootNamespaces.has(rootName)) {
    return false;
  }
  if (state.sourceCode) {
    return isImportedReference(state, root);
  }
  return !isShadowed(rootName, scopes);
};

const isDirectEffectWrapper = (
  state: FetchRuleState,
  callee: ASTNode | undefined,
  scopes: ScopeStack,
): boolean => {
  const directName = identifierName(callee);
  if (!directName || !state.directWrappers.has(directName)) {
    return false;
  }
  if (state.sourceCode) {
    return isImportedReference(state, callee);
  }
  return !isShadowed(directName, scopes);
};

const isEffectWrapper = (state: FetchRuleState, node: ASTNode, scopes: ScopeStack): boolean => {
  if (node.type !== 'CallExpression') {
    return false;
  }
  const callee = childNode(node, 'callee');
  return (
    isEffectMemberWrapper(state, callee, scopes) ||
    isEffectRootWrapper(state, callee, scopes) ||
    isDirectEffectWrapper(state, callee, scopes)
  );
};

interface GlobalFetchReference {
  name: string;
  node: ASTNode;
}

const memberPropertyName = (member: ASTNode, property: ASTNode | undefined): string | undefined => {
  if (Reflect.get(member, 'computed') === true) {
    return stringValue(property);
  }
  return identifierName(property);
};

const globalFetchReference = (callee: ASTNode | undefined): GlobalFetchReference | undefined => {
  if (identifierName(callee) === 'fetch' && callee) {
    return { name: 'fetch', node: callee };
  }
  if (callee?.type !== 'MemberExpression') {
    return undefined;
  }
  const object = childNode(callee, 'object');
  const property = childNode(callee, 'property');
  const propertyName = memberPropertyName(callee, property);
  if (object && identifierName(object) === 'globalThis' && propertyName === 'fetch') {
    return { name: 'globalThis', node: object };
  }
  return undefined;
};

const isNativeGlobalReference = (state: FetchRuleState, reference: ASTNode): boolean =>
  state.sourceCode?.isGlobalReference?.(reference) === true ||
  isUnresolvedReference(state, reference) ||
  isTypeOnlyReference(state, reference);

const isGlobalFetch = (state: FetchRuleState, node: ASTNode, scopes: ScopeStack): boolean => {
  if (node.type !== 'CallExpression') {
    return false;
  }
  const reference = globalFetchReference(childNode(node, 'callee'));
  if (!reference) {
    return false;
  }
  if (state.sourceCode) {
    return isNativeGlobalReference(state, reference.node);
  }
  return !isShadowed(reference.name, scopes);
};

const reportFetch = (state: FetchRuleState, node: ASTNode): void => {
  if (state.seenFetchCalls.has(node)) {
    return;
  }
  state.seenFetchCalls.add(node);
  state.context.report({
    message: 'Use the Effect HTTP client or an adapter service instead of global fetch.',
    node,
  });
};

type NativeWorkItem =
  | { kind: 'visit'; value: unknown }
  | { kind: 'leave-node'; node: ASTNode }
  | { kind: 'leave-array'; value: readonly unknown[] };

interface NativeTraversal {
  activeArrays: WeakSet<object>;
  activeNodes: WeakSet<object>;
  pending: NativeWorkItem[];
  visit: (node: ASTNode) => boolean;
  visitorKeys?: Readonly<Record<string, readonly string[]>>;
}

const pushNativeArray = (value: readonly unknown[], pending: NativeWorkItem[]): void => {
  pending.push({ kind: 'leave-array', value });
  for (let index = value.length - 1; index >= 0; index -= 1) {
    pending.push({ kind: 'visit', value: value[index] });
  }
};

const pushNativeKeyChildren = (
  node: ASTNode,
  keys: readonly string[],
  pending: NativeWorkItem[],
): void => {
  for (let index = keys.length - 1; index >= 0; index -= 1) {
    const key = keys[index];
    if (key !== undefined) {
      pending.push({ kind: 'visit', value: Reflect.get(node, key) });
    }
  }
};

const pushNativeReflectedChildren = (node: ASTNode, pending: NativeWorkItem[]): void => {
  const entries = Object.entries(node);
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry && entry[0] !== 'parent') {
      pending.push({ kind: 'visit', value: entry[1] });
    }
  }
};

const pushNativeNodeChildren = (
  node: ASTNode,
  pending: NativeWorkItem[],
  visitorKeys?: Readonly<Record<string, readonly string[]>>,
): void => {
  pending.push({ kind: 'leave-node', node });
  const keys = visitorKeys?.[node.type];
  if (keys) {
    pushNativeKeyChildren(node, keys, pending);
    return;
  }
  pushNativeReflectedChildren(node, pending);
};

const visitNativeArray = (value: readonly unknown[], traversal: NativeTraversal): void => {
  if (traversal.activeArrays.has(value)) {
    return;
  }
  traversal.activeArrays.add(value);
  pushNativeArray(value, traversal.pending);
};

const visitNativeNode = (value: unknown, traversal: NativeTraversal): void => {
  const node = asNode(value);
  if (!node || traversal.activeNodes.has(node)) {
    return;
  }
  traversal.activeNodes.add(node);
  if (!traversal.visit(node)) {
    traversal.activeNodes.delete(node);
    return;
  }
  pushNativeNodeChildren(node, traversal.pending, traversal.visitorKeys);
};

const visitNativeWorkItem = (item: NativeWorkItem, traversal: NativeTraversal): void => {
  if (item.kind === 'leave-node') {
    traversal.activeNodes.delete(item.node);
  } else if (item.kind === 'leave-array') {
    traversal.activeArrays.delete(item.value);
  } else if (Array.isArray(item.value)) {
    visitNativeArray(item.value, traversal);
  } else {
    visitNativeNode(item.value, traversal);
  }
};

const visitNativeTree = (
  node: ASTNode,
  visit: (node: ASTNode) => boolean,
  visitorKeys?: Readonly<Record<string, readonly string[]>>,
): void => {
  const traversal: NativeTraversal = {
    activeArrays: new WeakSet(),
    activeNodes: new WeakSet(),
    pending: [{ kind: 'visit', value: node }],
    visit,
    visitorKeys,
  };
  while (traversal.pending.length > 0) {
    const item = traversal.pending.pop();
    if (item) {
      visitNativeWorkItem(item, traversal);
    }
  }
};

const scanNativeWrapperArguments = (state: FetchRuleState, wrapper: ASTNode): void => {
  for (const argument of childNodes(wrapper, 'arguments')) {
    visitNativeTree(
      argument,
      (node): boolean => {
        if (isGlobalFetch(state, node, [])) {
          reportFetch(state, node);
          return false;
        }
        return node === argument || !isEffectWrapper(state, node, []);
      },
      state.sourceCode?.visitorKeys,
    );
  }
};

const scanFallbackWrapperArguments = (
  state: FetchRuleState,
  wrapper: ASTNode,
  wrapperScopes: ScopeStack,
): void => {
  for (const argument of childNodes(wrapper, 'arguments')) {
    const argumentScopes = state.fallbackScopes.get(argument) ?? wrapperScopes;
    visitFallbackTree(
      argument,
      argumentScopes,
      (node, scopes): boolean => {
        if (isGlobalFetch(state, node, scopes)) {
          reportFetch(state, node);
          return false;
        }
        return node === argument || !isEffectWrapper(state, node, scopes);
      },
      state.sourceCode?.visitorKeys,
    );
  }
};

const scanWrapperArguments = (
  state: FetchRuleState,
  wrapper: ASTNode,
  wrapperScopes: ScopeStack,
): void => {
  if (state.sourceCode) {
    scanNativeWrapperArguments(state, wrapper);
    return;
  }
  scanFallbackWrapperArguments(state, wrapper, wrapperScopes);
};

const initializeState = (state: FetchRuleState, program: ASTNode): void => {
  if (state.initializedPrograms.has(program)) {
    return;
  }
  state.initializedPrograms.add(program);
  indexGlobalFetchImports(state, program, state.source);
  if (!state.sourceCode) {
    indexFallbackScopes(state, program);
  }
};

/**
 * Build native and parser-fallback visitors for global fetch inside Effect async wrappers.
 *
 * @param context - The lint rule context.
 * @param source - Complete source used only for the legacy implicit Effect namespace.
 * @returns Program and CallExpression visitors.
 * @throws Does not throw.
 * @internal
 */
export const effectGlobalFetchAST = (context: Context, source: string): VisitorMap => {
  const state: FetchRuleState = {
    context,
    directWrappers: new Set(),
    fallbackImportBindings: new Set(),
    fallbackScopes: new WeakMap(),
    initializedPrograms: new WeakSet(),
    namespaces: new Set(),
    rootNamespaces: new Set(),
    seenFetchCalls: new WeakSet(),
    source,
    sourceCode: nativeSourceCodeFor(context),
  };
  return {
    CallExpression(value): void {
      const node = asNode(value);
      if (!node) {
        return;
      }
      const scopes = state.fallbackScopes.get(node) ?? [];
      if (isEffectWrapper(state, node, scopes)) {
        scanWrapperArguments(state, node, scopes);
      }
    },
    Program(value): void {
      const program = asNode(value);
      if (program) {
        initializeState(state, program);
      }
    },
  };
};
