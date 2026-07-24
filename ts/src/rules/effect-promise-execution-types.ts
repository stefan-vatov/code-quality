/* -------------------------------------------------------------------------- */
/*                 Inputs for Promise execution AST analysis.                 */
/* -------------------------------------------------------------------------- */

import type { ASTNode } from './effect-ast';
import type { HelperScopes } from './effect-promise-callable-types';
import type { NativeGlobalCheck } from './effect-promise-collections';
import type { ScopeStack } from './effect-ast-scope';

/**
 * AST visitor-key table supplied by Oxlint when available.
 *
 * @internal
 */
export type PromiseVisitorKeys = Readonly<Record<string, readonly string[]>>;

/**
 * Inputs for one execution-aware callback analysis.
 *
 * @internal
 */
export interface PromiseExecutionInput {
  functionNode: ASTNode;
  helperScopes?: HelperScopes;
  isBoundary: (node: ASTNode, scopes: ScopeStack) => boolean;
  isNativeGlobal?: NativeGlobalCheck;
  scopes: ScopeStack;
  visitorKeys?: PromiseVisitorKeys;
}

/**
 * Stable execution capabilities and recursion guards for one analysis.
 *
 * @internal
 */
export interface PromiseExecutionState {
  activeBodies: WeakSet<object>;
  activeDefaults: WeakSet<object>;
  isBoundary: (node: ASTNode, scopes: ScopeStack) => boolean;
  isNativeGlobal: NativeGlobalCheck;
  visitorKeys: PromiseVisitorKeys | undefined;
}
