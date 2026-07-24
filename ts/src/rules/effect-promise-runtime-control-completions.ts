/* -------------------------------------------------------------------------- */
/*        Correlated completion alternatives for runtime control flow.        */
/* -------------------------------------------------------------------------- */

import {
  RUNTIME_MAYBE_ABRUPT,
  RUNTIME_NORMAL,
  RUNTIME_OUTCOME_CAP,
  joinRuntimeStates,
  restoreRuntimeState,
  snapshotRuntimeState,
  unknownRuntimeValue,
} from './effect-promise-runtime-model';
import type {
  RuntimeExecutionContext,
  RuntimeOutcome,
  RuntimeResult,
  RuntimeSnapshot,
  RuntimeStatementHost,
} from './effect-promise-runtime-model';
import { runtimeChoiceValue } from './effect-promise-runtime-choice';

const summarizedValue = (outcomes: readonly RuntimeOutcome[]): RuntimeResult['value'] =>
  runtimeChoiceValue(outcomes.map((outcome): RuntimeResult['value'] => outcome.value));

const sameCompletion = (left: RuntimeOutcome, right: RuntimeOutcome): boolean =>
  left.completion === right.completion && left.target === right.target;

const summarizedCompletion = (
  first: RuntimeOutcome,
  isSameCompletion: boolean,
): RuntimeResult['completion'] => {
  if (isSameCompletion) {
    return first.completion;
  }
  return RUNTIME_MAYBE_ABRUPT;
};

const summarizedTarget = (first: RuntimeOutcome, isSameCompletion: boolean): string | undefined => {
  if (isSameCompletion) {
    return first.target;
  }
  return undefined;
};

/**
 * Expand a legacy exact result into one state-correlated outcome.
 *
 * @internal
 */
export const runtimeResultOutcomes = (
  result: RuntimeResult,
  state: RuntimeSnapshot,
): readonly RuntimeOutcome[] => {
  if (result.outcomes) {
    return result.outcomes;
  }
  if (result.completion === RUNTIME_MAYBE_ABRUPT) {
    return [];
  }
  return [
    {
      completion: result.completion,
      state,
      target: result.target,
      value: result.value,
    },
  ];
};

/**
 * Summarize exact correlated outcomes through the legacy result fields.
 *
 * @internal
 */
export const runtimeResultFromOutcomes = (outcomes: readonly RuntimeOutcome[]): RuntimeResult => {
  const [first] = outcomes;
  if (!first || outcomes.length > RUNTIME_OUTCOME_CAP) {
    return { completion: RUNTIME_MAYBE_ABRUPT, value: unknownRuntimeValue };
  }
  const isSameCompletion = outcomes.every((outcome): boolean => sameCompletion(first, outcome));
  return {
    completion: summarizedCompletion(first, isSameCompletion),
    outcomes,
    target: summarizedTarget(first, isSameCompletion),
    value: summarizedValue(outcomes),
  };
};

const joinRemainingOutcomeStates = (
  host: RuntimeStatementHost,
  baseline: RuntimeSnapshot,
  outcomes: readonly RuntimeOutcome[],
  initial: RuntimeSnapshot,
): void => {
  let joined = initial;
  for (let index = 1; index < outcomes.length; index += 1) {
    const outcome = outcomes[index];
    if (outcome) {
      joinRuntimeStates(host.state, baseline, joined, outcome.state);
      joined = snapshotRuntimeState(host.state, baseline.values.keys());
    }
  }
};

/**
 * Join the mutable interpreter state across exact alternatives.
 *
 * @internal
 */
export const joinRuntimeOutcomeStates = (
  host: RuntimeStatementHost,
  baseline: RuntimeSnapshot,
  outcomes: readonly RuntimeOutcome[],
): void => {
  const [first] = outcomes;
  if (!first) {
    restoreRuntimeState(host.state, baseline);
    return;
  }
  restoreRuntimeState(host.state, first.state);
  joinRemainingOutcomeStates(host, baseline, outcomes, first.state);
};

const continuedOutcomes = (
  host: RuntimeStatementHost,
  outcome: RuntimeOutcome,
  context: RuntimeExecutionContext,
  next: () => RuntimeResult,
): readonly RuntimeOutcome[] => {
  if (outcome.completion !== RUNTIME_NORMAL) {
    return [outcome];
  }
  restoreRuntimeState(host.state, outcome.state);
  const result = next();
  const state = snapshotRuntimeState(host.state, context.taskScopes);
  return runtimeResultOutcomes(result, state);
};

const cappedResult = (
  host: RuntimeStatementHost,
  baseline: RuntimeSnapshot,
  outcomes: readonly RuntimeOutcome[],
): RuntimeResult => {
  joinRuntimeOutcomeStates(host, baseline, outcomes);
  return { completion: RUNTIME_MAYBE_ABRUPT, value: unknownRuntimeValue };
};

/**
 * Continue only normally completing alternatives and retain abrupt alternatives.
 *
 * @internal
 */
export const continueRuntimeResult = (
  host: RuntimeStatementHost,
  result: RuntimeResult,
  context: RuntimeExecutionContext,
  next: () => RuntimeResult,
): RuntimeResult => {
  if (!result.outcomes) {
    if (result.completion === RUNTIME_NORMAL) {
      return next();
    }
    return result;
  }
  const baseline = snapshotRuntimeState(host.state, context.taskScopes);
  const outcomes = result.outcomes.flatMap((outcome): readonly RuntimeOutcome[] =>
    continuedOutcomes(host, outcome, context, next),
  );
  if (outcomes.length > RUNTIME_OUTCOME_CAP) {
    return cappedResult(host, baseline, outcomes);
  }
  joinRuntimeOutcomeStates(host, baseline, outcomes);
  return runtimeResultFromOutcomes(outcomes);
};
