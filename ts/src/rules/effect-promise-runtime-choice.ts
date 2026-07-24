/* -------------------------------------------------------------------------- */
/*        Bounded identity choices for runtime branch-created values.         */
/* -------------------------------------------------------------------------- */

import type { RuntimeChoiceValue, RuntimeValue } from './effect-promise-runtime-model';
import { unknownRuntimeValue } from './effect-promise-runtime-model';

/**
 * Maximum exact identities retained by one runtime value choice.
 *
 * @internal
 */
export const RUNTIME_CHOICE_CAP = 8;

/**
 * Narrow a runtime value to one bounded identity choice.
 *
 * @internal
 */
export const runtimeChoice = (value: RuntimeValue): RuntimeChoiceValue | undefined => {
  if (value && typeof value !== 'symbol' && 'kind' in value && value.kind === 'choice') {
    return value;
  }
  return undefined;
};

const appendChoice = (target: RuntimeValue[], value: RuntimeValue): boolean => {
  const choice = runtimeChoice(value);
  if (choice) {
    for (const member of choice.choices) {
      if (!appendChoice(target, member)) {
        return false;
      }
    }
    return true;
  }
  if (!target.includes(value)) {
    target.push(value);
  }
  return target.length <= RUNTIME_CHOICE_CAP;
};

const allInputsSame = (inputs: readonly RuntimeValue[]): boolean => {
  const [first] = inputs;
  return inputs.length > 0 && inputs.every((value): boolean => value === first);
};

const collectedChoices = (inputs: readonly RuntimeValue[]): RuntimeValue[] | undefined => {
  const choices: RuntimeValue[] = [];
  for (const value of inputs) {
    if (value === unknownRuntimeValue || !appendChoice(choices, value)) {
      return undefined;
    }
  }
  return choices;
};

const existingChoice = (
  inputs: readonly RuntimeValue[],
  choices: readonly RuntimeValue[],
): RuntimeChoiceValue | undefined =>
  inputs
    .map(runtimeChoice)
    .find(
      (choice): boolean =>
        choice !== undefined &&
        choice.choices.length === choices.length &&
        choice.choices.every((value, index): boolean => value === choices[index]),
    );

const canonicalChoice = (
  inputs: readonly RuntimeValue[],
  choices: RuntimeValue[],
): RuntimeValue => {
  if (choices.length === 0) {
    return undefined;
  }
  if (choices.length === 1) {
    return choices[0];
  }
  const existing = existingChoice(inputs, choices);
  if (existing) {
    return existing;
  }
  return Object.freeze({ choices: Object.freeze(choices), kind: 'choice' });
};

/**
 * Join exact branch identities by pointer, flattening nested choices.
 *
 * @internal
 */
export const runtimeChoiceValue = (values: Iterable<RuntimeValue>): RuntimeValue => {
  const inputs = [...values];
  if (allInputsSame(inputs)) {
    return inputs[0];
  }
  const choices = collectedChoices(inputs);
  if (!choices) {
    return unknownRuntimeValue;
  }
  return canonicalChoice(inputs, choices);
};

/**
 * Join two exact values into one bounded canonical choice.
 *
 * @internal
 */
export const joinRuntimeValueChoice = (left: RuntimeValue, right: RuntimeValue): RuntimeValue => {
  if (left === right) {
    return left;
  }
  return runtimeChoiceValue([left, right]);
};
