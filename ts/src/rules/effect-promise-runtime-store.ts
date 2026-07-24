/* -------------------------------------------------------------------------- */
/*       Transactional store snapshots and bounded control-flow joins.        */
/* -------------------------------------------------------------------------- */

import type {
  RuntimeExecution,
  RuntimeScope,
  RuntimeSnapshot,
  RuntimeState,
  RuntimeStoreSnapshot,
  RuntimeValue,
} from './effect-promise-runtime-model';
import { joinRuntimeValueChoice } from './effect-promise-runtime-choice';
import { runtimeFalseProof } from './effect-promise-runtime-proof';

type RuntimeMembers = ReadonlyMap<string, RuntimeValue>;

const snapshotMembers = <Key extends object>(
  source: ReadonlyMap<Key, RuntimeMembers>,
): Map<Key, RuntimeMembers> => {
  const snapshot = new Map<Key, RuntimeMembers>();
  for (const [reference, members] of source) {
    snapshot.set(reference, new Map(members));
  }
  return snapshot;
};

/**
 * Capture values and heap without coupling memo entries to caller proofs.
 *
 * @internal
 */
export const snapshotRuntimeStore = (
  state: RuntimeState,
  visibleScopes: Iterable<RuntimeScope> = state.scopes,
): RuntimeStoreSnapshot => {
  const values = new Map<RuntimeScope, RuntimeMembers>();
  for (const scope of visibleScopes) {
    values.set(scope, new Map(scope.values));
  }
  return {
    choiceMembers: snapshotMembers(state.choiceMembers),
    heap: snapshotMembers(state.heap),
    values,
  };
};

/**
 * Capture every live binding and must-execute event.
 *
 * @internal
 */
export const snapshotRuntimeState = (
  state: RuntimeState,
  visibleScopes: Iterable<RuntimeScope> = state.scopes,
): RuntimeSnapshot => ({
  ...snapshotRuntimeStore(state, visibleScopes),
  proofs: new Map(state.proofs),
});

const restoreMembers = <Key extends object>(
  target: Map<Key, Map<string, RuntimeValue>>,
  source: ReadonlyMap<Key, RuntimeMembers>,
): void => {
  target.clear();
  for (const [reference, members] of source) {
    target.set(reference, new Map(members));
  }
};

/**
 * Restore a prior transactional runtime state.
 *
 * @internal
 */
export const restoreRuntimeState = (state: RuntimeState, snapshot: RuntimeSnapshot): void => {
  state.proofs.clear();
  for (const [syncCall, proof] of snapshot.proofs) {
    state.proofs.set(syncCall, proof);
  }
  restoreMembers(state.heap, snapshot.heap);
  restoreMembers(state.choiceMembers, snapshot.choiceMembers);
  for (const [scope, saved] of snapshot.values) {
    scope.values.clear();
    for (const [name, value] of saved) {
      scope.values.set(name, value);
    }
  }
};

const joinedMembers = (left: RuntimeMembers, right: RuntimeMembers): Map<string, RuntimeValue> => {
  const joined = new Map<string, RuntimeValue>();
  for (const name of new Set([...left.keys(), ...right.keys()])) {
    joined.set(name, joinRuntimeValueChoice(left.get(name), right.get(name)));
  }
  return joined;
};

const joinedBranchLocalMembers = (
  left: RuntimeMembers | undefined,
  right: RuntimeMembers | undefined,
): Map<string, RuntimeValue> => {
  if (!left || !right) {
    return new Map(left ?? right);
  }
  return joinedMembers(left, right);
};

const joinedReferenceMembers = <Key extends object>(
  reference: Key,
  baseline: ReadonlyMap<Key, RuntimeMembers>,
  left: ReadonlyMap<Key, RuntimeMembers>,
  right: ReadonlyMap<Key, RuntimeMembers>,
): Map<string, RuntimeValue> => {
  const initial = baseline.get(reference);
  const leftMembers = left.get(reference);
  const rightMembers = right.get(reference);
  if (!initial) {
    return joinedBranchLocalMembers(leftMembers, rightMembers);
  }
  return joinedMembers(leftMembers ?? initial, rightMembers ?? initial);
};

const joinReferenceStore = <Key extends object>(
  target: Map<Key, Map<string, RuntimeValue>>,
  baseline: ReadonlyMap<Key, RuntimeMembers>,
  left: ReadonlyMap<Key, RuntimeMembers>,
  right: ReadonlyMap<Key, RuntimeMembers>,
): void => {
  for (const reference of new Set([...left.keys(), ...right.keys()])) {
    target.set(reference, joinedReferenceMembers(reference, baseline, left, right));
  }
};

const joinScopeValues = (
  target: RuntimeScope,
  left: RuntimeMembers,
  right: RuntimeMembers,
): void => {
  target.values.clear();
  for (const name of new Set([...left.keys(), ...right.keys()])) {
    target.values.set(name, joinRuntimeValueChoice(left.get(name), right.get(name)));
  }
};

const joinRuntimeProofs = (
  state: RuntimeState,
  left: RuntimeSnapshot,
  right: RuntimeSnapshot,
): void => {
  for (const syncCall of new Set([...left.proofs.keys(), ...right.proofs.keys()])) {
    const leftProof = left.proofs.get(syncCall) ?? runtimeFalseProof;
    const rightProof = right.proofs.get(syncCall) ?? runtimeFalseProof;
    const proof = state.factory.all(leftProof, rightProof);
    if (proof.kind !== 'false') {
      state.proofs.set(syncCall, proof);
    }
  }
};

/**
 * Join two feasible branch states and retain only task runs common to both.
 *
 * @internal
 */
export const joinRuntimeStates = (
  state: RuntimeState,
  baseline: RuntimeSnapshot,
  left: RuntimeSnapshot,
  right: RuntimeSnapshot,
): void => {
  restoreRuntimeState(state, baseline);
  for (const [scope, baselineValues] of baseline.values) {
    joinScopeValues(
      scope,
      left.values.get(scope) ?? baselineValues,
      right.values.get(scope) ?? baselineValues,
    );
  }
  joinReferenceStore(state.heap, baseline.heap, left.heap, right.heap);
  joinReferenceStore(
    state.choiceMembers,
    baseline.choiceMembers,
    left.choiceMembers,
    right.choiceMembers,
  );
  joinRuntimeProofs(state, left, right);
};

/**
 * Append one exact execution to the sequential proof for its declaration.
 *
 * @internal
 */
export const appendRuntimeExecution = (state: RuntimeState, execution: RuntimeExecution): void => {
  const previous = state.proofs.get(execution.syncCall) ?? runtimeFalseProof;
  state.proofs.set(execution.syncCall, state.factory.any(previous, state.factory.event(execution)));
};

const sameMembers = (left: RuntimeMembers, right: RuntimeMembers): boolean => {
  if (left.size !== right.size) {
    return false;
  }
  for (const [name, value] of left) {
    if (!right.has(name) || right.get(name) !== value) {
      return false;
    }
  }
  return true;
};

const sameReferenceStore = <Key extends object>(
  left: ReadonlyMap<Key, RuntimeMembers>,
  right: ReadonlyMap<Key, RuntimeMembers>,
): boolean => {
  if (left.size !== right.size) {
    return false;
  }
  for (const [reference, leftMembers] of left) {
    const rightMembers = right.get(reference);
    if (!rightMembers || !sameMembers(leftMembers, rightMembers)) {
      return false;
    }
  }
  return true;
};

/**
 * Compare exact visible values for recursion and completed-state memoization.
 *
 * @internal
 */
export const sameRuntimeSnapshotValues = (
  left: RuntimeStoreSnapshot,
  right: RuntimeStoreSnapshot,
): boolean => {
  if (left.values.size !== right.values.size) {
    return false;
  }
  for (const [scope, leftValues] of left.values) {
    const rightValues = right.values.get(scope);
    if (!rightValues || !sameMembers(leftValues, rightValues)) {
      return false;
    }
  }
  return (
    sameReferenceStore(left.heap, right.heap) &&
    sameReferenceStore(left.choiceMembers, right.choiceMembers)
  );
};

/**
 * Compare proof roots by normalized pointer identity.
 *
 * @internal
 */
export const sameRuntimeSnapshotProofs = (
  left: RuntimeSnapshot,
  right: RuntimeSnapshot,
): boolean => {
  if (left.proofs.size !== right.proofs.size) {
    return false;
  }
  for (const [syncCall, proof] of left.proofs) {
    if (right.proofs.get(syncCall) !== proof) {
      return false;
    }
  }
  return true;
};
