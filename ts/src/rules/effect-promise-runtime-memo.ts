/* -------------------------------------------------------------------------- */
/*      Detached proof fragments and escape-safe invocation memoization.      */
/* -------------------------------------------------------------------------- */

import type {
  RuntimeCallableValue,
  RuntimeChoiceValue,
  RuntimeObjectRef,
  RuntimeResult,
  RuntimeScope,
  RuntimeState,
  RuntimeStoreSnapshot,
  RuntimeTaskValue,
  RuntimeValue,
} from './effect-promise-runtime-model';
import { runtimeFalseProof, runtimeProofExecutions } from './effect-promise-runtime-proof';
import type { ASTNode } from './effect-ast';
import type { RuntimeProof } from './effect-promise-runtime-proof';

/**
 * Proof roots produced by one invocation independently of its caller.
 *
 * @internal
 */
export type RuntimeProofFragment = ReadonlyMap<ASTNode, RuntimeProof>;

/**
 * Move current proof roots aside and install an empty invocation sink.
 *
 * @internal
 */
export const isolateRuntimeProofs = (state: RuntimeState): RuntimeProofFragment => {
  const caller = new Map(state.proofs);
  state.proofs.clear();
  return caller;
};

/**
 * Capture the current invocation-local proof sink.
 *
 * @internal
 */
export const captureRuntimeProofFragment = (state: RuntimeState): RuntimeProofFragment =>
  new Map(state.proofs);

/**
 * Restore caller roots without restoring values or heap state.
 *
 * @internal
 */
export const restoreRuntimeProofs = (state: RuntimeState, proofs: RuntimeProofFragment): void => {
  state.proofs.clear();
  for (const [syncCall, proof] of proofs) {
    state.proofs.set(syncCall, proof);
  }
};

/**
 * Append a detached invocation fragment to the caller's sequential proof.
 *
 * @internal
 */
export const mergeRuntimeProofFragment = (
  state: RuntimeState,
  fragment: RuntimeProofFragment,
): void => {
  for (const [syncCall, proof] of fragment) {
    const previous = state.proofs.get(syncCall) ?? runtimeFalseProof;
    state.proofs.set(syncCall, state.factory.any(previous, proof));
  }
};

interface EscapeContext {
  before: RuntimeStoreSnapshot;
  localScopes: ReadonlySet<RuntimeScope>;
  seen: WeakSet<object>;
  state: RuntimeState;
}

const taskEscapes = (task: RuntimeTaskValue, context: EscapeContext): boolean =>
  task.scopes.some((scope): boolean => context.localScopes.has(scope));

const callableEscapes = (callable: RuntimeCallableValue, context: EscapeContext): boolean => {
  if (callable.scopes.some((scope): boolean => context.localScopes.has(scope))) {
    return true;
  }
  if (runtimeValueEscapes(callable.boundThis, context)) {
    return true;
  }
  return callable.boundArguments.some((value): boolean => runtimeValueEscapes(value, context));
};

const objectEscapes = (reference: RuntimeObjectRef, context: EscapeContext): boolean => {
  if (!context.before.heap.has(reference)) {
    return true;
  }
  for (const value of context.state.heap.get(reference)?.values() ?? []) {
    if (runtimeValueEscapes(value, context)) {
      return true;
    }
  }
  return false;
};

type StructuredRuntimeValue =
  | RuntimeCallableValue
  | RuntimeChoiceValue
  | RuntimeObjectRef
  | RuntimeTaskValue;

const structuredRuntimeValue = (value: RuntimeValue): value is StructuredRuntimeValue =>
  Boolean(
    value &&
    typeof value !== 'symbol' &&
    'kind' in value &&
    (value.kind === 'task' ||
      value.kind === 'callable' ||
      value.kind === 'object' ||
      value.kind === 'choice'),
  );

const structuredValueEscapes = (value: StructuredRuntimeValue, context: EscapeContext): boolean => {
  switch (value.kind) {
    case 'task': {
      return taskEscapes(value, context);
    }
    case 'callable': {
      return callableEscapes(value, context);
    }
    case 'object': {
      return objectEscapes(value, context);
    }
    case 'choice': {
      return value.choices.some((choice): boolean => runtimeValueEscapes(choice, context));
    }
    default: {
      return false;
    }
  }
};

const runtimeValueEscapes = (value: RuntimeValue, context: EscapeContext): boolean => {
  if (!structuredRuntimeValue(value) || context.seen.has(value)) {
    return false;
  }
  context.seen.add(value);
  return structuredValueEscapes(value, context);
};

const fragmentEscapes = (fragment: RuntimeProofFragment, context: EscapeContext): boolean => {
  for (const proof of fragment.values()) {
    for (const execution of runtimeProofExecutions(proof)) {
      if (runtimeValueEscapes(execution.task, context)) {
        return true;
      }
    }
  }
  return false;
};

/**
 * Reject memo entries that retain invocation-local identities or outcome states.
 *
 * @internal
 */
export const isRuntimeMemoSafe = (
  result: RuntimeResult,
  fragment: RuntimeProofFragment,
  localScopes: ReadonlySet<RuntimeScope>,
  before: RuntimeStoreSnapshot,
  state: RuntimeState,
): boolean => {
  if (result.outcomes) {
    return false;
  }
  const context: EscapeContext = {
    before,
    localScopes,
    seen: new WeakSet(),
    state,
  };
  return !runtimeValueEscapes(result.value, context) && !fragmentEscapes(fragment, context);
};
