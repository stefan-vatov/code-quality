/* -------------------------------------------------------------------------- */
/*    Imported-reference identity for strict AST-backed Effect call rules.    */
/* -------------------------------------------------------------------------- */

import type { NativeReference, NativeSourceCode } from './effect-native-references';
import { asNode, childNode, childNodes, identifierName } from './effect-ast';
import {
  isImportReference,
  nativeReferenceIndexFor,
  nativeSourceCodeFor,
} from './effect-native-references';
import { scopesForChild, withNodeScope } from './effect-ast-scope';
import type { ASTNode } from './effect-ast';
import type { Context } from './effect-rule-core';
import type { ScopeStack } from './effect-ast-scope';

const DIRECT_BINDING = 1;
const NAMESPACE_BINDING = 2;
const ROOT_NAMESPACE_BINDING = 4;

interface Binding {
  importedName?: string;
  isImplicit: boolean;
  kind: number;
}

interface CalleeReference {
  binding: Binding;
  node: ASTNode;
}

/**
 * Per-rule imported call matcher initialized by the host Program visitor.
 *
 * @internal
 */
export interface ImportedEffectCallMatcher {
  initialize: (node: object) => void;
  matches: (callee: object | undefined) => boolean;
}

interface MatcherState {
  bindings: Map<string, Binding>;
  fallbackCalls: WeakSet<object>;
  nativeReferences: WeakMap<object, NativeReference> | undefined;
  sourceCode: NativeSourceCode | undefined;
}

type ASTProperty = ASTNode | readonly ASTProperty[] | boolean | null | number | string | undefined;

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

const isComputedMember = (node: ASTNode): boolean => Reflect.get(node, 'computed') === true;

const addBinding = (
  bindings: Map<string, Binding>,
  localName: string | undefined,
  kind: number,
  importedName?: string,
): void => {
  if (!localName) {
    return;
  }
  const current = bindings.get(localName);
  bindings.set(localName, {
    importedName: importedName ?? current?.importedName,
    isImplicit: false,
    kind: kind | (current?.kind ?? 0),
  });
};

const namedImport = (
  bindings: Map<string, Binding>,
  specifier: ASTNode,
  moduleName: string,
  APIName: string,
  names: ReadonlySet<string>,
): void => {
  const importedName = identifierName(childNode(specifier, 'imported'));
  const localName = identifierName(childNode(specifier, 'local'));
  if (moduleName === 'effect') {
    if (importedName === APIName) {
      addBinding(bindings, localName, NAMESPACE_BINDING);
    }
    return;
  }
  if (moduleName === `effect/${APIName}` && importedName && names.has(importedName)) {
    addBinding(bindings, localName, DIRECT_BINDING, importedName);
  }
};

const importSpecifier = (
  bindings: Map<string, Binding>,
  specifier: ASTNode,
  moduleName: string,
  APIName: string,
  names: ReadonlySet<string>,
): void => {
  if (isTypeImport(specifier)) {
    return;
  }
  if (specifier.type === 'ImportNamespaceSpecifier') {
    const localName = identifierName(childNode(specifier, 'local'));
    if (moduleName === 'effect') {
      addBinding(bindings, localName, NAMESPACE_BINDING | ROOT_NAMESPACE_BINDING);
    } else if (moduleName === `effect/${APIName}`) {
      addBinding(bindings, localName, NAMESPACE_BINDING);
    }
    return;
  }
  if (specifier.type === 'ImportSpecifier') {
    namedImport(bindings, specifier, moduleName, APIName, names);
  }
};

const isEffectModule = (moduleName: string): boolean =>
  moduleName === 'effect' || moduleName.startsWith('effect/') || moduleName.startsWith('@effect/');

const collectImportBindings = (
  bindings: Map<string, Binding>,
  statement: ASTNode,
  APIName: string,
  names: ReadonlySet<string>,
): boolean => {
  if (statement.type !== 'ImportDeclaration') {
    return false;
  }
  const moduleName = literalString(childNode(statement, 'source'));
  if (!moduleName || !isEffectModule(moduleName)) {
    return false;
  }
  if (!isTypeImport(statement)) {
    for (const specifier of childNodes(statement, 'specifiers')) {
      importSpecifier(bindings, specifier, moduleName, APIName, names);
    }
  }
  return true;
};

const collectBindings = (
  program: ASTNode,
  APIName: string,
  names: ReadonlySet<string>,
): Map<string, Binding> => {
  const bindings = new Map<string, Binding>();
  let hasEffectImport = false;
  for (const statement of childNodes(program, 'body')) {
    hasEffectImport = collectImportBindings(bindings, statement, APIName, names) || hasEffectImport;
  }
  if (!hasEffectImport) {
    bindings.set(APIName, {
      isImplicit: true,
      kind: NAMESPACE_BINDING,
    });
  }
  return bindings;
};

const directReference = (
  callee: ASTNode,
  state: MatcherState,
  names: ReadonlySet<string>,
): CalleeReference | undefined => {
  const localName = identifierName(callee);
  if (!localName) {
    return undefined;
  }
  const binding = state.bindings.get(localName);
  if (
    binding &&
    (binding.kind & DIRECT_BINDING) !== 0 &&
    binding.importedName &&
    names.has(binding.importedName)
  ) {
    return { binding, node: callee };
  }
  return undefined;
};

const isAcceptedFunctionName = (
  value: string | undefined,
  names: ReadonlySet<string>,
): value is string => Boolean(value && names.has(value));

const namespaceReference = (
  member: ASTNode,
  state: MatcherState,
  names: ReadonlySet<string>,
): CalleeReference | undefined => {
  const propertyName = identifierName(childNode(member, 'property'));
  const object = childNode(member, 'object');
  const objectName = identifierName(object);
  if (!isAcceptedFunctionName(propertyName, names) || !object || !objectName) {
    return undefined;
  }
  const binding = state.bindings.get(objectName);
  if (binding && (binding.kind & NAMESPACE_BINDING) !== 0) {
    return { binding, node: object };
  }
  return undefined;
};

const rootObject = (member: ASTNode, APIName: string): ASTNode | undefined => {
  const APIObject = childNode(member, 'object');
  if (APIObject?.type !== 'MemberExpression' || isComputedMember(APIObject)) {
    return undefined;
  }
  if (identifierName(childNode(APIObject, 'property')) !== APIName) {
    return undefined;
  }
  return childNode(APIObject, 'object');
};

const rootBindingReference = (state: MatcherState, root: ASTNode): CalleeReference | undefined => {
  const rootName = identifierName(root);
  if (!rootName) {
    return undefined;
  }
  const binding = state.bindings.get(rootName);
  if (binding && (binding.kind & ROOT_NAMESPACE_BINDING) !== 0) {
    return { binding, node: root };
  }
  return undefined;
};

const rootNamespaceReference = (
  member: ASTNode,
  state: MatcherState,
  APIName: string,
  names: ReadonlySet<string>,
): CalleeReference | undefined => {
  const propertyName = identifierName(childNode(member, 'property'));
  if (!isAcceptedFunctionName(propertyName, names)) {
    return undefined;
  }
  const root = rootObject(member, APIName);
  if (!root) {
    return undefined;
  }
  return rootBindingReference(state, root);
};

const calleeReference = (
  value: object | undefined,
  state: MatcherState,
  APIName: string,
  names: ReadonlySet<string>,
): CalleeReference | undefined => {
  const callee = asNode(value);
  if (!callee) {
    return undefined;
  }
  const direct = directReference(callee, state, names);
  if (direct) {
    return direct;
  }
  if (callee.type !== 'MemberExpression' || isComputedMember(callee)) {
    return undefined;
  }
  return (
    namespaceReference(callee, state, names) ??
    rootNamespaceReference(callee, state, APIName, names)
  );
};

const isShadowed = (name: string, scopes: ScopeStack): boolean => {
  const scopeCount = scopes.length;
  for (let scopeIndex = 0; scopeIndex < scopeCount; scopeIndex += 1) {
    if (scopes[scopeIndex]?.has(name)) {
      return true;
    }
  }
  return false;
};

const addFallbackCall = (
  node: ASTNode,
  state: MatcherState,
  APIName: string,
  names: ReadonlySet<string>,
  scopes: ScopeStack,
): void => {
  if (node.type !== 'CallExpression') {
    return;
  }
  const callee = childNode(node, 'callee');
  const reference = calleeReference(callee, state, APIName, names);
  const referenceName = reference && identifierName(reference.node);
  if (callee && referenceName && !isShadowed(referenceName, scopes)) {
    state.fallbackCalls.add(callee);
  }
};

const visitFallbackValue = (
  value: ASTProperty,
  state: MatcherState,
  APIName: string,
  names: ReadonlySet<string>,
  scopes: ScopeStack,
): void => {
  if (isASTPropertyArray(value)) {
    const valueCount = value.length;
    for (let valueIndex = 0; valueIndex < valueCount; valueIndex += 1) {
      visitFallbackValue(value[valueIndex], state, APIName, names, scopes);
    }
    return;
  }
  const child = asNode(value);
  if (child) {
    visitFallbackNode(child, state, APIName, names, scopes);
  }
};

const visitFallbackNode = (
  node: ASTNode,
  state: MatcherState,
  APIName: string,
  names: ReadonlySet<string>,
  scopes: ScopeStack,
): void => {
  const nodeScopes = withNodeScope(scopes, node);
  addFallbackCall(node, state, APIName, names, nodeScopes);
  for (const [key, value] of Object.entries(node)) {
    if (key !== 'parent') {
      visitFallbackValue(
        value as ASTProperty,
        state,
        APIName,
        names,
        scopesForChild(nodeScopes, node, key),
      );
    }
  }
};

const isNativeReference = (reference: CalleeReference, state: MatcherState): boolean => {
  if (reference.binding.isImplicit) {
    return (
      state.sourceCode?.isGlobalReference?.(reference.node) === true ||
      nativeReferencesFor(state)?.get(reference.node)?.resolved === null
    );
  }
  return isImportReference(reference.node, nativeReferencesFor(state));
};

const nativeReferencesFor = (state: MatcherState): WeakMap<object, NativeReference> | undefined => {
  const mutableState = state;
  if (!mutableState.nativeReferences && mutableState.sourceCode) {
    mutableState.nativeReferences = nativeReferenceIndexFor(mutableState.sourceCode);
  }
  return mutableState.nativeReferences;
};

/**
 * Build an exact imported-reference matcher for selected functions of one Effect API module. Native
 * Oxlint visitors use scope-manager identity in constant time. Direct synthetic callers receive a
 * lexical Program fallback so tests and older compatible hosts retain exact semantics.
 *
 * @param context - The current rule context.
 * @param APIName - The Effect API namespace, such as `Effect`.
 * @param functionNames - Callable exports accepted by this matcher.
 * @returns A Program initializer and allocation-free callee predicate.
 * @throws Does not throw.
 * @internal
 */
export const importedEffectCallMatcher = (
  context: Context,
  APIName: string,
  functionNames: readonly string[],
): ImportedEffectCallMatcher => {
  const names = new Set(functionNames);
  const sourceCode = nativeSourceCodeFor(context);
  const state: MatcherState = {
    bindings: new Map(),
    fallbackCalls: new WeakSet(),
    nativeReferences: undefined,
    sourceCode,
  };

  return {
    initialize(value): void {
      const program = asNode(value);
      if (!program) {
        return;
      }
      state.bindings = collectBindings(program, APIName, names);
      if (!sourceCode) {
        visitFallbackNode(program, state, APIName, names, []);
      }
    },
    matches(value): boolean {
      const callee = asNode(value);
      if (!callee) {
        return false;
      }
      if (!sourceCode) {
        return state.fallbackCalls.has(callee);
      }
      const reference = calleeReference(callee, state, APIName, names);
      return Boolean(reference && isNativeReference(reference, state));
    },
  };
};
