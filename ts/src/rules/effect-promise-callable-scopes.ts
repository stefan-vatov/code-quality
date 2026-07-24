/* -------------------------------------------------------------------------- */
/*             Lexical callable provenance for Promise execution.             */
/* -------------------------------------------------------------------------- */

import type { FunctionBinding, HelperScopes } from './effect-promise-callable-types';
import {
  addObjectBindings,
  addPrimaryBindings,
  addVariableAliases,
} from './effect-promise-callable-declarations';
import { childNode, childNodes, identifierName } from './effect-ast';
import type { ASTNode } from './effect-ast';
import type { ScopeStack } from './effect-ast-scope';
import { addPatternNames } from './effect-promise-pattern-bindings';

/**
 * Extend callable scopes with declarations owned by one statement container.
 *
 * @internal
 */
export const containerHelperScopes = (
  node: ASTNode,
  scopes: ScopeStack,
  inherited: HelperScopes,
): HelperScopes => {
  const bindings = new Map<string, FunctionBinding | undefined>();
  const helperScopes = [...inherited, bindings];
  const statements = childNodes(node, 'body');
  addPrimaryBindings(bindings, statements, scopes, helperScopes, node.type === 'Program');
  addObjectBindings(bindings, statements, scopes, helperScopes);
  addVariableAliases(bindings, statements, helperScopes);
  if (bindings.size === 0) {
    return inherited;
  }
  return helperScopes;
};

/**
 * Add parameter and named-function bindings for one invoked function.
 *
 * @internal
 */
export const functionHeaderScopes = (
  functionNode: ASTNode,
  binding: FunctionBinding,
): HelperScopes => {
  const bindings = new Map<string, FunctionBinding | undefined>();
  for (const parameter of childNodes(functionNode, 'params')) {
    addPatternNames(bindings, parameter);
  }
  const name = identifierName(childNode(functionNode, 'id'));
  if (name) {
    bindings.set(name, binding);
  }
  if (bindings.size === 0) {
    return binding.helperScopes;
  }
  return [...binding.helperScopes, bindings];
};
