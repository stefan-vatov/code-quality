/* -------------------------------------------------------------------------- */
/*          Scope and child navigation for Promise execution graphs.          */
/* -------------------------------------------------------------------------- */

import { scopesForChild, withNodeScope } from './effect-ast-scope';
import type { ASTNode } from './effect-ast';
import type { PromiseExecutionState } from './effect-promise-execution-types';
import type { ScopeStack } from './effect-ast-scope';

/**
 * Generator execution decision for an invoked function.
 *
 * @internal
 */
export const generatorExecution = (node: ASTNode, shouldExecute: boolean): number => {
  if (Reflect.get(node, 'generator') !== true) {
    return 0;
  }
  if (!shouldExecute) {
    return -1;
  }
  if (Reflect.get(node, 'async') === true) {
    return 1;
  }
  return 0;
};

/**
 * Read the traversal scopes visible at a node.
 *
 * @internal
 */
export const nodeScopesFor = (
  state: PromiseExecutionState,
  node: ASTNode,
  scopes: ScopeStack,
): ScopeStack => {
  if (state.visitorKeys) {
    return scopes;
  }
  return withNodeScope(scopes, node);
};

/**
 * Read the traversal scopes visible through one child edge.
 *
 * @internal
 */
export const childScopesFor = (
  state: PromiseExecutionState,
  nodeScopes: ScopeStack,
  node: ASTNode,
  key: string,
): ScopeStack => {
  if (state.visitorKeys) {
    return nodeScopes;
  }
  return scopesForChild(nodeScopes, node, key);
};

/**
 * Read parser visitor keys with a reflected fallback.
 *
 * @internal
 */
export const childKeysFor = (state: PromiseExecutionState, node: ASTNode): readonly string[] => {
  if (state.visitorKeys) {
    return state.visitorKeys[node.type] ?? [];
  }
  return Object.keys(node);
};

/**
 * Read the scopes visible in an invoked function body.
 *
 * @internal
 */
export const bodyScopesFor = (
  state: PromiseExecutionState,
  functionScopes: ScopeStack,
  node: ASTNode,
): ScopeStack => {
  if (state.visitorKeys) {
    return functionScopes;
  }
  return scopesForChild(functionScopes, node, 'body');
};
