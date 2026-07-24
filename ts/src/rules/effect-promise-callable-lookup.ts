/* -------------------------------------------------------------------------- */
/*            Callable-key lookup shared by Promise AST analysis.             */
/* -------------------------------------------------------------------------- */

import type { FunctionBinding, HelperScopes } from './effect-promise-callable-types';
import { childNode, identifierName } from './effect-ast';
import { isFunctionNode, unwrappedExpression } from './effect-boundary-ast-shared';
import type { ASTNode } from './effect-ast';
import type { ScopeStack } from './effect-ast-scope';
import { staticPromisePropertyName } from './effect-promise-ast-values';

const MEMBER_SEPARATOR = '\u0000';

/**
 * Read a statically named member property.
 *
 * @internal
 */
export const memberPropertyName = (node: ASTNode | undefined): string | undefined => {
  if (node?.type !== 'MemberExpression') {
    return undefined;
  }
  const property = childNode(node, 'property');
  if (Reflect.get(node, 'computed') !== true) {
    return identifierName(property);
  }
  if (property?.type === 'Literal') {
    return staticPromisePropertyName(property);
  }
  return undefined;
};

/**
 * Build the internal lookup key for a statically named member.
 *
 * @internal
 */
export const memberBindingKey = (objectName: string, propertyName: string): string =>
  `${objectName}${MEMBER_SEPARATOR}${propertyName}`;

const memberCallableKey = (node: ASTNode): string | undefined => {
  const objectName = identifierName(childNode(node, 'object'));
  const propertyName = memberPropertyName(node);
  if (objectName && propertyName) {
    return memberBindingKey(objectName, propertyName);
  }
  return undefined;
};

const callableKey = (node: ASTNode | undefined): string | undefined => {
  const name = identifierName(node);
  if (name) {
    return name;
  }
  if (node?.type === 'MemberExpression') {
    return memberCallableKey(node);
  }
  return undefined;
};

/**
 * Construct one callable binding without changing its lexical provenance.
 *
 * @internal
 */
export const bindingForFunction = (
  node: ASTNode,
  scopes: ScopeStack,
  helperScopes: HelperScopes,
): FunctionBinding => ({ helperScopes, node, scopes });

/**
 * Resolve a callable spelling through lexical callable scopes.
 *
 * @internal
 */
export const resolvedHelper = (
  node: ASTNode | undefined,
  helperScopes: HelperScopes,
): FunctionBinding | undefined => {
  const key = callableKey(unwrappedExpression(node));
  if (!key) {
    return undefined;
  }
  for (let index = helperScopes.length - 1; index >= 0; index -= 1) {
    const scope = helperScopes[index];
    if (scope?.has(key)) {
      return scope.get(key);
    }
  }
  return undefined;
};

/**
 * Resolve a callable expression or direct function literal.
 *
 * @internal
 */
export const callableBinding = (
  node: ASTNode | undefined,
  scopes: ScopeStack,
  helperScopes: HelperScopes,
): FunctionBinding | undefined => {
  const callable = unwrappedExpression(node);
  if (isFunctionNode(callable)) {
    return bindingForFunction(callable, scopes, helperScopes);
  }
  return resolvedHelper(callable, helperScopes);
};

/**
 * Copy all statically known members between object aliases.
 *
 * @internal
 */
export const copyObjectMembers = (
  bindings: Map<string, FunctionBinding | undefined>,
  targetName: string,
  sourceName: string,
): void => {
  const prefix = `${sourceName}${MEMBER_SEPARATOR}`;
  for (const [key, binding] of bindings) {
    if (key.startsWith(prefix)) {
      bindings.set(`${targetName}${MEMBER_SEPARATOR}${key.slice(prefix.length)}`, binding);
    }
  }
};
