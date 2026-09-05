/* -------------------------------------------------------------------------- */
/*       Import classification for global fetch Effect async wrappers.        */
/* -------------------------------------------------------------------------- */

import { childNode, childNodes, identifierName } from './effect-ast';
import { Predicate } from 'effect';
import type { ASTNode } from './effect-ast';
import { effectImportAliases } from './effect-rule-core';

/**
 * Import bindings needed by the global-fetch AST visitor.
 *
 * @internal
 */
export interface GlobalFetchImportIndex {
  directWrappers: Set<string>;
  fallbackImportBindings: Set<string>;
  namespaces: Set<string>;
  rootNamespaces: Set<string>;
}

/**
 * Effect APIs whose callbacks may execute global fetch.
 *
 * @internal
 */
export const globalFetchAsyncWrapperNames: ReadonlySet<string> = new Set(['promise', 'tryPromise']);

const stringValue = (node: ASTNode | undefined): string | undefined => {
  if (node?.type !== 'Literal') {
    return undefined;
  }
  const value = node.value;
  if (Predicate.isString(value)) {
    return value;
  }
  return undefined;
};

const isTypeOnly = (node: ASTNode): boolean => node.importKind === 'type';

const isOfficialNamespace = (
  specifier: ASTNode,
  modulePath: string | undefined,
  imported: string | undefined,
): boolean =>
  (modulePath === 'effect' && specifier.type === 'ImportSpecifier' && imported === 'Effect') ||
  (modulePath === 'effect/Effect' && specifier.type === 'ImportNamespaceSpecifier');

const isOfficialRootNamespace = (specifier: ASTNode, modulePath: string | undefined): boolean =>
  modulePath === 'effect' && specifier.type === 'ImportNamespaceSpecifier';

const isOfficialDirectWrapper = (
  specifier: ASTNode,
  modulePath: string | undefined,
  imported: string | undefined,
): boolean =>
  modulePath === 'effect/Effect' &&
  specifier.type === 'ImportSpecifier' &&
  Boolean(imported && globalFetchAsyncWrapperNames.has(imported));

const indexOfficialValueImport = (
  index: GlobalFetchImportIndex,
  specifier: ASTNode,
  modulePath: string | undefined,
  imported: string | undefined,
  localName: string,
): boolean => {
  if (isOfficialRootNamespace(specifier, modulePath)) {
    index.rootNamespaces.add(localName);
    return true;
  }
  if (isOfficialNamespace(specifier, modulePath, imported)) {
    index.namespaces.add(localName);
    return true;
  }
  if (isOfficialDirectWrapper(specifier, modulePath, imported)) {
    index.directWrappers.add(localName);
    return true;
  }
  return false;
};

const indexValueImport = (
  index: GlobalFetchImportIndex,
  specifier: ASTNode,
  modulePath: string | undefined,
  localName: string,
): boolean => {
  const imported = identifierName(childNode(specifier, 'imported'));
  if (indexOfficialValueImport(index, specifier, modulePath, imported, localName)) {
    return true;
  }
  index.fallbackImportBindings.add(localName);
  return false;
};

const indexImportSpecifier = (
  index: GlobalFetchImportIndex,
  specifier: ASTNode,
  modulePath: string | undefined,
): boolean => {
  if (isTypeOnly(specifier)) {
    return false;
  }
  const localName = identifierName(childNode(specifier, 'local'));
  if (localName) {
    return indexValueImport(index, specifier, modulePath, localName);
  }
  return false;
};

const indexImportDeclaration = (index: GlobalFetchImportIndex, declaration: ASTNode): boolean => {
  if (declaration.type !== 'ImportDeclaration' || isTypeOnly(declaration)) {
    return false;
  }
  const modulePath = stringValue(childNode(declaration, 'source'));
  let hasOfficialBinding = false;
  for (const specifier of childNodes(declaration, 'specifiers')) {
    hasOfficialBinding = indexImportSpecifier(index, specifier, modulePath) || hasOfficialBinding;
  }
  return hasOfficialBinding;
};

/**
 * Index only official Effect wrapper imports and fallback shadow bindings.
 *
 * @param index - Mutable per-rule import sets.
 * @param program - The current Program node.
 * @param source - Source used only by the legacy implicit Effect fallback.
 * @throws Does not throw.
 * @internal
 */
export const indexGlobalFetchImports = (
  index: GlobalFetchImportIndex,
  program: ASTNode,
  source: string,
): void => {
  let hasOfficialBinding = false;
  for (const declaration of childNodes(program, 'body')) {
    hasOfficialBinding = indexImportDeclaration(index, declaration) || hasOfficialBinding;
  }
  if (!hasOfficialBinding && effectImportAliases(source).includes('Effect')) {
    index.namespaces.add('Effect');
  }
};
