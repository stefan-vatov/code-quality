/* -------------------------------------------------------------------------- */
/*         Exact Program import indexing for shared Effect AST rules.         */
/* -------------------------------------------------------------------------- */

import { Predicate } from 'effect';
import { asNode, childNode, childNodes, identifierName } from './effect-ast';
import type { ASTNode, ASTValue } from './effect-ast';
import type { EffectAPIBindings } from './effect-boundary-ast-shared';

const ROOT_MODULE = 'effect';
const EFFECT_MODULE = 'effect/Effect';

const literalString = (node: ASTNode | undefined): string | undefined => {
  if (node?.type !== 'Literal' && node?.type !== 'StringLiteral') {
    return undefined;
  }
  const value = node.value;
  if (Predicate.isString(value)) {
    return value;
  }
  return undefined;
};

const isTypeOnly = (node: ASTNode): boolean => node.importKind === 'type';

const resetBindings = (bindings: EffectAPIBindings): void => {
  bindings.directFunctionNames.clear();
  bindings.directFunctions.clear();
  bindings.namespaces.clear();
  bindings.rootNamespaces.clear();
  bindings.succeedFunctions.clear();
  bindings.suspendFunctions.clear();
  bindings.syncFunctions.clear();
};

const addDirectFunction = (
  bindings: EffectAPIBindings,
  localName: string | undefined,
  importedName: string | undefined,
): void => {
  if (!localName || !importedName) {
    return;
  }
  bindings.directFunctions.add(localName);
  bindings.directFunctionNames.set(localName, importedName);
  if (importedName === 'succeed') {
    bindings.succeedFunctions.add(localName);
  } else if (importedName === 'suspend') {
    bindings.suspendFunctions.add(localName);
  } else if (importedName === 'sync') {
    bindings.syncFunctions.add(localName);
  }
};

const addRootSpecifier = (bindings: EffectAPIBindings, specifier: ASTNode): void => {
  const localName = identifierName(childNode(specifier, 'local'));
  if (specifier.type === 'ImportNamespaceSpecifier') {
    if (localName) {
      bindings.rootNamespaces.add(localName);
    }
    return;
  }
  if (
    specifier.type === 'ImportSpecifier' &&
    identifierName(childNode(specifier, 'imported')) === 'Effect' &&
    localName
  ) {
    bindings.namespaces.add(localName);
  }
};

const addEffectSpecifier = (bindings: EffectAPIBindings, specifier: ASTNode): void => {
  const localName = identifierName(childNode(specifier, 'local'));
  if (specifier.type === 'ImportNamespaceSpecifier') {
    if (localName) {
      bindings.namespaces.add(localName);
    }
    return;
  }
  if (specifier.type === 'ImportSpecifier') {
    addDirectFunction(bindings, localName, identifierName(childNode(specifier, 'imported')));
  }
};

const isEffectModuleName = (moduleName: string | undefined): moduleName is string => {
  if (!moduleName) {
    return false;
  }
  return (
    moduleName === ROOT_MODULE ||
    moduleName.startsWith('effect/') ||
    moduleName.startsWith('@effect/')
  );
};

const addRuntimeSpecifiers = (
  bindings: EffectAPIBindings,
  declaration: ASTNode,
  moduleName: string,
): void => {
  for (const specifier of childNodes(declaration, 'specifiers')) {
    if (!isTypeOnly(specifier)) {
      if (moduleName === ROOT_MODULE) {
        addRootSpecifier(bindings, specifier);
      } else if (moduleName === EFFECT_MODULE) {
        addEffectSpecifier(bindings, specifier);
      }
    }
  }
};

const addImportDeclaration = (bindings: EffectAPIBindings, declaration: ASTNode): boolean => {
  if (declaration.type !== 'ImportDeclaration') {
    return false;
  }
  const moduleName = literalString(childNode(declaration, 'source'));
  if (!isEffectModuleName(moduleName)) {
    return false;
  }
  if (!isTypeOnly(declaration)) {
    addRuntimeSpecifiers(bindings, declaration, moduleName);
  }
  return true;
};

const indexProgramStatements = (bindings: EffectAPIBindings, body: ASTValue): boolean => {
  if (!Array.isArray(body)) {
    return false;
  }
  let hasEffectImport = false;
  const statements: readonly ASTValue[] = body;
  const statementCount = statements.length;
  for (let statementIndex = 0; statementIndex < statementCount; statementIndex += 1) {
    const statement = asNode(statements[statementIndex]);
    if (statement) {
      hasEffectImport = addImportDeclaration(bindings, statement) || hasEffectImport;
    }
  }
  return hasEffectImport;
};

/**
 * Replace source-fallback bindings with exact top-level Program imports.
 *
 * @param bindings - Mutable binding index owned by one rule instance.
 * @param program - Parsed Program whose direct children are module statements.
 * @returns Nothing; the supplied per-file binding index is updated in place.
 * @throws Does not throw.
 * @internal
 */
export const indexEffectAPIBindings = (bindings: EffectAPIBindings, program: ASTNode): void => {
  resetBindings(bindings);
  const hasEffectImport = indexProgramStatements(bindings, program.body);
  if (!hasEffectImport) {
    bindings.namespaces.add('Effect');
  }
};
