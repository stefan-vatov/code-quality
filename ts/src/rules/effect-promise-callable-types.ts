/* -------------------------------------------------------------------------- */
/*            Callable and invocation types for Promise execution.            */
/* -------------------------------------------------------------------------- */

import type { ASTNode } from './effect-ast';
import type { ScopeStack } from './effect-ast-scope';

/**
 * Arguments whose exact runtime cardinality may or may not be known.
 *
 * @internal
 */
export interface InvocationArguments {
  isExact: boolean;
  values: readonly (ASTNode | undefined)[];
}

/**
 * One statically resolved function value.
 *
 * @internal
 */
export interface FunctionBinding {
  helperScopes: HelperScopes;
  node: ASTNode;
  scopes: ScopeStack;
}

/**
 * One lexical callable-binding scope.
 *
 * @internal
 */
export type HelperScope = ReadonlyMap<string, FunctionBinding | undefined>;

/**
 * Callable-binding scopes from outermost to innermost.
 *
 * @internal
 */
export type HelperScopes = readonly HelperScope[];

/**
 * One statically resolved invocation.
 *
 * @internal
 */
export interface Invocation {
  arguments: InvocationArguments;
  binding: FunctionBinding;
}
