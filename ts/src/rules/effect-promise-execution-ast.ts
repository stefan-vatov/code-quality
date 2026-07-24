/* -------------------------------------------------------------------------- */
/*        Execution-aware Promise traversal for Effect.sync callbacks.        */
/* -------------------------------------------------------------------------- */

import type {
  PromiseExecutionInput,
  PromiseExecutionState,
} from './effect-promise-execution-types';
import type { FunctionBinding } from './effect-promise-callables';
import type { NativeGlobalCheck } from './effect-promise-collections';
import { executePromiseGraph } from './effect-promise-execution-engine';

export type { PromiseExecutionInput } from './effect-promise-execution-types';

const neverNativeGlobal: NativeGlobalCheck = (): boolean => false;

const executionState = (input: PromiseExecutionInput): PromiseExecutionState => ({
  activeBodies: new WeakSet(),
  activeDefaults: new WeakSet(),
  isBoundary: input.isBoundary,
  isNativeGlobal: input.isNativeGlobal ?? neverNativeGlobal,
  visitorKeys: input.visitorKeys,
});

/**
 * Detect a Promise boundary that executes while an Effect.sync callback runs.
 *
 * @param input - Callback, lexical provenance, and native traversal capabilities.
 * @returns Whether the callback synchronously reaches Promise-producing work.
 * @throws Does not throw.
 * @internal
 */
export const hasExecutedPromiseBoundary = (input: PromiseExecutionInput): boolean => {
  const helperScopes = input.helperScopes ?? [];
  const binding: FunctionBinding = {
    helperScopes,
    node: input.functionNode,
    scopes: input.scopes,
  };
  return executePromiseGraph(executionState(input), binding);
};
