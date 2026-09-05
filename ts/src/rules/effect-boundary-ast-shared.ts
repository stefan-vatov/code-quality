/* -------------------------------------------------------------------------- */
/*         Shared Effect call identity for AST-backed boundary rules.         */
/* -------------------------------------------------------------------------- */

import { childNode, identifierName } from './effect-ast';
import { effectFunctionAliases, effectImportAliases } from './effect-rule-core';
import type { ASTNode } from './effect-ast';
import type { NativeReference } from './effect-native-references';
import type { ScopeStack } from './effect-ast-scope';
import { indexEffectAPIBindings } from './effect-import-bindings';
import { isImportReference } from './effect-native-references';
import { scopeHasBinding } from './effect-ast-scope';
import { stripComments } from './effect-source-helpers';

/**
 * Imported Effect bindings used by boundary rules.
 *
 * @internal
 */
export interface EffectAPIBindings {
  directFunctionNames: Map<string, string>;
  directFunctions: Set<string>;
  namespaces: Set<string>;
  rootNamespaces: Set<string>;
  succeedFunctions: Set<string>;
  suspendFunctions: Set<string>;
  syncFunctions: Set<string>;
}

const transparentExpressionTypes: ReadonlySet<string> = new Set([
  'ChainExpression',
  'ParenthesizedExpression',
  'TSAsExpression',
  'TSInstantiationExpression',
  'TSNonNullExpression',
  'TSSatisfiesExpression',
  'TSTypeAssertion',
]);

/**
 * Determine whether an AST node introduces a deferred function body.
 *
 * @internal
 */
export const isFunctionNode = (node: ASTNode | undefined): node is ASTNode =>
  node?.type === 'ArrowFunctionExpression' ||
  node?.type === 'FunctionDeclaration' ||
  node?.type === 'FunctionExpression';

/**
 * Find a function through syntax-only expression wrappers.
 *
 * @internal
 */
export const unwrappedExpression = (node: ASTNode | undefined): ASTNode | undefined => {
  let current = node;
  while (current && transparentExpressionTypes.has(current.type)) {
    current = childNode(current, 'expression');
  }
  return current;
};

const rootNamespaceImportPattern =
  /(?:^|\n)\s*import\s+(?!type\b)\*\s+as\s+([A-Za-z_$][\w$]*)\s+from\s*['"]effect['"]/g;

const rootEffectNamespacesFor = (source: string): Set<string> => {
  const namespaces = new Set<string>();
  const commentFreeSource = stripComments(source);
  for (const match of commentFreeSource.matchAll(rootNamespaceImportPattern)) {
    const [, localName] = match;
    if (localName) {
      namespaces.add(localName);
    }
  }
  return namespaces;
};

/** Build the imported Effect binding index for one source file. @internal */
export const effectAPIBindingsFor = (source: string): EffectAPIBindings => ({
  directFunctionNames: new Map(),
  directFunctions: new Set(effectFunctionAliases(source, 'Effect')),
  namespaces: new Set(effectImportAliases(source)),
  rootNamespaces: rootEffectNamespacesFor(source),
  succeedFunctions: new Set(effectFunctionAliases(source, 'Effect', 'succeed')),
  suspendFunctions: new Set(effectFunctionAliases(source, 'Effect', 'suspend')),
  syncFunctions: new Set(effectFunctionAliases(source, 'Effect', 'sync')),
});

/** Replace source-fallback bindings with exact Program import identities. @internal */
export const indexEffectAPIBindingsFromProgram = (
  bindings: EffectAPIBindings,
  program: ASTNode,
): void => {
  indexEffectAPIBindings(bindings, program);
};

/** Check a lexical scope stack for a value binding. @internal */
export const isShadowed = (name: string, scopes: ScopeStack): boolean =>
  scopeHasBinding(name, scopes);

const staticMember = (node: ASTNode | undefined): ASTNode | undefined => {
  const member = unwrappedExpression(node);
  if (member?.type !== 'MemberExpression' || member.computed === true) {
    return undefined;
  }
  return member;
};

const staticMemberPropertyName = (node: ASTNode | undefined): string | undefined => {
  const member = staticMember(node);
  if (member) {
    return identifierName(childNode(member, 'property'));
  }
  return undefined;
};

const rootEffectImportIdentifier = (
  object: ASTNode | undefined,
  bindings: EffectAPIBindings,
): ASTNode | undefined => {
  const rootMember = staticMember(object);
  if (!rootMember || identifierName(childNode(rootMember, 'property')) !== 'Effect') {
    return undefined;
  }
  const importIdentifier = unwrappedExpression(childNode(rootMember, 'object'));
  const importName = identifierName(importIdentifier);
  if (importName && bindings.rootNamespaces.has(importName)) {
    return importIdentifier;
  }
  return undefined;
};

const effectMemberImportIdentifier = (
  node: ASTNode | undefined,
  bindings: EffectAPIBindings,
): ASTNode | undefined => {
  const member = staticMember(node);
  if (!member) {
    return undefined;
  }
  const object = unwrappedExpression(childNode(member, 'object'));
  const directImportName = identifierName(object);
  if (object && directImportName && bindings.namespaces.has(directImportName)) {
    return object;
  }
  return rootEffectImportIdentifier(object, bindings);
};

const directBindingsFor = (
  APIName: string | undefined,
  bindings: EffectAPIBindings,
): ReadonlySet<string> => {
  if (APIName === 'succeed') {
    return bindings.succeedFunctions;
  }
  if (APIName === 'suspend') {
    return bindings.suspendFunctions;
  }
  if (APIName === 'sync') {
    return bindings.syncFunctions;
  }
  return bindings.directFunctions;
};

const isEffectMemberCall = (
  callee: ASTNode | undefined,
  APIName: string | undefined,
  bindings: EffectAPIBindings,
  scopes: ScopeStack,
  references: WeakMap<object, NativeReference> | undefined,
): boolean => {
  const propertyName = staticMemberPropertyName(callee);
  if (!propertyName || (APIName !== undefined && propertyName !== APIName)) {
    return false;
  }
  const importIdentifier = effectMemberImportIdentifier(callee, bindings);
  const importName = identifierName(importIdentifier);
  if (!importIdentifier || !importName) {
    return false;
  }
  if (references) {
    return isImportReference(importIdentifier, references);
  }
  return !isShadowed(importName, scopes);
};

const isDirectEffectCall = (
  callee: ASTNode | undefined,
  APIName: string | undefined,
  bindings: EffectAPIBindings,
  scopes: ScopeStack,
  references: WeakMap<object, NativeReference> | undefined,
): boolean => {
  const name = identifierName(callee);
  if (!name || !directBindingsFor(APIName, bindings).has(name)) {
    return false;
  }
  if (references) {
    return isImportReference(callee, references);
  }
  return !isShadowed(name, scopes);
};

/** Test whether call syntax could refer to an imported Effect API before scope lookup. @internal */
export const couldBeEffectCall = (
  node: ASTNode,
  APIName: string | undefined,
  bindings: EffectAPIBindings,
): boolean => {
  if (node.type !== 'CallExpression') {
    return false;
  }
  const callee = unwrappedExpression(childNode(node, 'callee'));
  const propertyName = staticMemberPropertyName(callee);
  if (
    propertyName &&
    (APIName === undefined || propertyName === APIName) &&
    effectMemberImportIdentifier(callee, bindings)
  ) {
    return true;
  }
  const name = identifierName(callee);
  return Boolean(name && directBindingsFor(APIName, bindings).has(name));
};

/** Test a call against imported Effect namespace and direct bindings. @internal */
export const isEffectCall = (
  node: ASTNode,
  APIName: string | undefined,
  bindings: EffectAPIBindings,
  scopes: ScopeStack,
  references?: WeakMap<object, NativeReference>,
): boolean => {
  if (node.type !== 'CallExpression') {
    return false;
  }
  const callee = unwrappedExpression(childNode(node, 'callee'));
  return (
    isEffectMemberCall(callee, APIName, bindings, scopes, references) ||
    isDirectEffectCall(callee, APIName, bindings, scopes, references)
  );
};

const fallbackDirectEffectAPIName = (
  name: string | undefined,
  bindings: EffectAPIBindings,
): string => {
  if (name && bindings.succeedFunctions.has(name)) {
    return 'succeed';
  }
  if (name && bindings.suspendFunctions.has(name)) {
    return 'suspend';
  }
  if (name && bindings.syncFunctions.has(name)) {
    return 'sync';
  }
  return '';
};

const directEffectAPIName = (name: string | undefined, bindings: EffectAPIBindings): string => {
  if (!name) {
    return '';
  }
  const importedName = bindings.directFunctionNames.get(name);
  return importedName ?? fallbackDirectEffectAPIName(name, bindings);
};

/** Read the canonical API name of a verified Effect call when known. @internal */
export const effectCallAPIName = (
  node: ASTNode,
  bindings: EffectAPIBindings,
  scopes: ScopeStack,
  references?: WeakMap<object, NativeReference>,
): string | undefined => {
  if (!isEffectCall(node, undefined, bindings, scopes, references)) {
    return undefined;
  }
  const callee = unwrappedExpression(childNode(node, 'callee'));
  const propertyName = staticMemberPropertyName(callee);
  if (propertyName) {
    return propertyName;
  }
  return directEffectAPIName(identifierName(callee), bindings);
};
