/* -------------------------------------------------------------------------- */
/*       Transactional joins shared by runtime control-flow statements.       */
/* -------------------------------------------------------------------------- */

import {
  RUNTIME_MAYBE_ABRUPT,
  RUNTIME_NORMAL,
  joinRuntimeStates,
  restoreRuntimeState,
  snapshotRuntimeState,
} from './effect-promise-runtime-model';
import type {
  RuntimeExecutionContext,
  RuntimeOutcome,
  RuntimeResult,
  RuntimeSnapshot,
  RuntimeStatementHost,
} from './effect-promise-runtime-model';
import {
  runtimeResultFromOutcomes,
  runtimeResultOutcomes,
} from './effect-promise-runtime-control-completions';
import { joinRuntimeValueChoice } from './effect-promise-runtime-choice';

/**
 * Normal completion without an expression value.
 *
 * @internal
 */
export const NORMAL_RUNTIME_RESULT: RuntimeResult = {
  completion: RUNTIME_NORMAL,
  value: undefined,
};

const joinedOutcomes = (
  left: RuntimeResult,
  leftState: RuntimeSnapshot,
  right: RuntimeResult,
  rightState: RuntimeSnapshot,
): readonly RuntimeOutcome[] => [
  ...runtimeResultOutcomes(left, leftState),
  ...runtimeResultOutcomes(right, rightState),
];

const canCollapseResult = (left: RuntimeResult, right: RuntimeResult): boolean =>
  !left.outcomes &&
  !right.outcomes &&
  left.completion === right.completion &&
  left.target === right.target;

const joinedBranchResult = (
  left: RuntimeResult,
  leftState: RuntimeSnapshot,
  right: RuntimeResult,
  rightState: RuntimeSnapshot,
): RuntimeResult => {
  if (canCollapseResult(left, right)) {
    return {
      completion: left.completion,
      target: left.target,
      value: joinRuntimeValueChoice(left.value, right.value),
    };
  }
  const outcomes = joinedOutcomes(left, leftState, right, rightState);
  if (outcomes.length > 0) {
    return runtimeResultFromOutcomes(outcomes);
  }
  return {
    completion: RUNTIME_MAYBE_ABRUPT,
    value: joinRuntimeValueChoice(left.value, right.value),
  };
};

interface JoinedBranch {
  result: RuntimeResult;
  state: RuntimeSnapshot;
}

const executeJoinedBranch = (
  host: RuntimeStatementHost,
  branch: () => RuntimeResult,
  context: RuntimeExecutionContext,
  baseline: RuntimeSnapshot,
  current: JoinedBranch,
): JoinedBranch => {
  restoreRuntimeState(host.state, baseline);
  const right = branch();
  const rightState = snapshotRuntimeState(host.state, context.taskScopes);
  joinRuntimeStates(host.state, baseline, current.state, rightState);
  return {
    result: joinedBranchResult(current.result, current.state, right, rightState),
    state: snapshotRuntimeState(host.state, context.taskScopes),
  };
};

/**
 * Execute feasible branches from one baseline and retain only common effects.
 *
 * @internal
 */
export const executeRuntimeBranchSequence = (
  host: RuntimeStatementHost,
  branches: readonly (() => RuntimeResult)[],
  context: RuntimeExecutionContext,
): RuntimeResult => {
  const [first] = branches;
  if (!first) {
    return NORMAL_RUNTIME_RESULT;
  }
  const baseline = snapshotRuntimeState(host.state, context.taskScopes);
  let joined: JoinedBranch = {
    result: first(),
    state: snapshotRuntimeState(host.state, context.taskScopes),
  };
  for (let index = 1; index < branches.length; index += 1) {
    const branch = branches[index];
    if (branch) {
      joined = executeJoinedBranch(host, branch, context, baseline, joined);
    }
  }
  return joined.result;
};
