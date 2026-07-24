/* -------------------------------------------------------------------------- */
/*         Shadow-safe provenance for the native Object.assign call.          */
/* -------------------------------------------------------------------------- */

import { childNode, identifierName } from './effect-ast';
import type { ASTNode } from './effect-ast';
import type { ScopeStack } from './effect-ast-scope';

type GlobalObjectPredicate = (node: ASTNode | undefined, scopes: ScopeStack) => boolean;

/**
 * Read the two identifiers of one non-computed member expression.
 *
 * @internal
 */
export const staticMemberNames = (
  node: ASTNode | undefined,
): { objectName?: string; propertyName?: string } => {
  if (node?.type !== 'MemberExpression' || Reflect.get(node, 'computed') === true) {
    return {};
  }
  return {
    objectName: identifierName(childNode(node, 'object')),
    propertyName: identifierName(childNode(node, 'property')),
  };
};

/**
 * Match only the native global Object.assign member call.
 *
 * @internal
 */
export const isGlobalObjectAssignCall = (
  node: ASTNode,
  scopes: ScopeStack,
  isGlobalObject: GlobalObjectPredicate,
): boolean => {
  if (node.type !== 'CallExpression') {
    return false;
  }
  const callee = childNode(node, 'callee');
  if (
    callee?.type !== 'MemberExpression' ||
    Reflect.get(callee, 'computed') === true ||
    identifierName(childNode(callee, 'property')) !== 'assign'
  ) {
    return false;
  }
  const object = childNode(callee, 'object');
  return identifierName(object) === 'Object' && isGlobalObject(object, scopes);
};
