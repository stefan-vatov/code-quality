/* -------------------------------------------------------------------------- */
/*         Explicit completion states for Promise execution analysis.         */
/* -------------------------------------------------------------------------- */

import type { ArgumentValue, ParameterEnvironments } from './effect-promise-environment-types';
import { concreteArgument, isUndefinedArgument } from './effect-promise-environment-values';
import { unknownArgument } from './effect-promise-environment-types';

/**
 * Normal evaluation completed without reaching Promise-producing work.
 *
 * @internal
 */
export const COMPLETION_NORMAL = 0;

/**
 * A function or getter returned normally to its caller.
 *
 * @internal
 */
export const COMPLETION_RETURN = 1;

/**
 * Evaluation definitely threw before later work could execute.
 *
 * @internal
 */
export const COMPLETION_THROW = 2;

/**
 * Evaluation definitely reached Promise-producing work.
 *
 * @internal
 */
export const COMPLETION_UNSAFE = 3;

/**
 * Evaluation may complete abruptly, so later work is not provably executed.
 *
 * @internal
 */
export const COMPLETION_MAYBE_ABRUPT = 4;

/**
 * Evaluation provably does not return to its caller.
 *
 * @internal
 */
export const COMPLETION_NON_TERMINATING = 5;

/**
 * Evaluation may not return, so later work is not provably executed.
 *
 * @internal
 */
export const COMPLETION_MAYBE_NON_TERMINATING = 6;

/**
 * Exact or conservative completion from one evaluated AST path.
 *
 * @internal
 */
export type PromiseCompletion =
  | typeof COMPLETION_NORMAL
  | typeof COMPLETION_RETURN
  | typeof COMPLETION_THROW
  | typeof COMPLETION_UNSAFE
  | typeof COMPLETION_MAYBE_ABRUPT
  | typeof COMPLETION_NON_TERMINATING
  | typeof COMPLETION_MAYBE_NON_TERMINATING;

/**
 * Completion together with the exact value produced by Normal or Return evaluation.
 *
 * @internal
 */
export interface PromiseEvaluation {
  completion: PromiseCompletion;
  value: ArgumentValue;
}

/**
 * Shared value-less Normal evaluation.
 *
 * @internal
 */
export const NORMAL_EVALUATION: PromiseEvaluation = {
  completion: COMPLETION_NORMAL,
  value: undefined,
};

/**
 * Shared value-less Throw evaluation.
 *
 * @internal
 */
export const THROW_EVALUATION: PromiseEvaluation = {
  completion: COMPLETION_THROW,
  value: undefined,
};

/**
 * Shared value-less Unsafe evaluation.
 *
 * @internal
 */
export const UNSAFE_EVALUATION: PromiseEvaluation = {
  completion: COMPLETION_UNSAFE,
  value: undefined,
};

/**
 * Shared value-less NonTerminating evaluation.
 *
 * @internal
 */
export const NON_TERMINATING_EVALUATION: PromiseEvaluation = {
  completion: COMPLETION_NON_TERMINATING,
  value: undefined,
};

/**
 * Build a Normal evaluation carrying one abstract runtime value.
 *
 * @internal
 */
export const normalEvaluation = (value: ArgumentValue): PromiseEvaluation => ({
  completion: COMPLETION_NORMAL,
  value,
});

/**
 * Build a Return evaluation carrying one abstract runtime value.
 *
 * @internal
 */
export const returnEvaluation = (value: ArgumentValue): PromiseEvaluation => ({
  completion: COMPLETION_RETURN,
  value,
});

/**
 * One copy of the mutable values visible before a control-flow split.
 *
 * @internal
 */
export type PromiseEnvironmentSnapshot = readonly ReadonlyMap<string, ArgumentValue>[];

/**
 * Capture active invocation values before evaluating one speculative branch.
 *
 * @internal
 */
export const snapshotPromiseEnvironments = (
  environments: ParameterEnvironments,
): PromiseEnvironmentSnapshot => environments.map(({ values }) => new Map(values));

/**
 * Restore active invocation values before evaluating another feasible branch.
 *
 * @internal
 */
export const restorePromiseEnvironments = (
  environments: ParameterEnvironments,
  snapshot: PromiseEnvironmentSnapshot,
): void => {
  for (let index = 0; index < environments.length; index += 1) {
    const values = environments[index]?.values;
    const saved = snapshot[index];
    if (values && saved) {
      values.clear();
      for (const [name, value] of saved) {
        values.set(name, value);
      }
    }
  }
};

/**
 * Join two abstract values without selecting either feasible branch.
 *
 * @param left - Value produced by the first feasible branch.
 * @param right - Value produced by the second feasible branch.
 * @returns Their shared exact identity or the unknown-value sentinel.
 * @throws Does not throw.
 * @internal
 */
export const joinedArgument = (left: ArgumentValue, right: ArgumentValue): ArgumentValue => {
  if (left === right || (isUndefinedArgument(left) && isUndefinedArgument(right))) {
    return left;
  }
  const leftConcrete = concreteArgument(left);
  const rightConcrete = concreteArgument(right);
  if (leftConcrete?.node === rightConcrete?.node) {
    return left;
  }
  return unknownArgument;
};

const joinEnvironmentAt = (
  environments: ParameterEnvironments,
  left: PromiseEnvironmentSnapshot,
  right: PromiseEnvironmentSnapshot,
  index: number,
): void => {
  const values = environments[index]?.values;
  const leftValues = left[index];
  const rightValues = right[index];
  if (!values || !leftValues || !rightValues) {
    return;
  }
  values.clear();
  for (const name of new Set([...leftValues.keys(), ...rightValues.keys()])) {
    values.set(name, joinedArgument(leftValues.get(name), rightValues.get(name)));
  }
};

/**
 * Join mutable values after two feasible branches without choosing either branch.
 *
 * @internal
 */
export const joinPromiseEnvironments = (
  environments: ParameterEnvironments,
  left: PromiseEnvironmentSnapshot,
  right: PromiseEnvironmentSnapshot,
): void => {
  for (let index = 0; index < environments.length; index += 1) {
    joinEnvironmentAt(environments, left, right, index);
  }
};

const isNonTerminatingCompletion = (completion: PromiseCompletion): boolean =>
  completion === COMPLETION_NON_TERMINATING || completion === COMPLETION_MAYBE_NON_TERMINATING;

const isAbruptCompletion = (completion: PromiseCompletion): boolean =>
  completion === COMPLETION_THROW ||
  completion === COMPLETION_RETURN ||
  completion === COMPLETION_MAYBE_ABRUPT;

/**
 * Join completion from two feasible branches conservatively.
 *
 * @internal
 */
export const joinPromiseCompletions = (
  left: PromiseCompletion,
  right: PromiseCompletion,
): PromiseCompletion => {
  if (left === right) {
    return left;
  }
  if (isNonTerminatingCompletion(left) || isNonTerminatingCompletion(right)) {
    return COMPLETION_MAYBE_NON_TERMINATING;
  }
  if (isAbruptCompletion(left) || isAbruptCompletion(right)) {
    return COMPLETION_MAYBE_ABRUPT;
  }
  return COMPLETION_NORMAL;
};

/**
 * Join completion and value from two feasible branches conservatively.
 *
 * @internal
 */
export const joinPromiseEvaluations = (
  left: PromiseEvaluation,
  right: PromiseEvaluation,
): PromiseEvaluation => {
  const completion = joinPromiseCompletions(left.completion, right.completion);
  if (completion === COMPLETION_NORMAL || completion === COMPLETION_RETURN) {
    return { completion, value: joinedArgument(left.value, right.value) };
  }
  return { completion, value: undefined };
};
