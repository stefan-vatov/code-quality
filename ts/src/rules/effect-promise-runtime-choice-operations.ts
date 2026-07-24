/* -------------------------------------------------------------------------- */
/*      Heap operations distributed over bounded runtime value choices.       */
/* -------------------------------------------------------------------------- */

import type { RuntimeObjectRef, RuntimeState, RuntimeValue } from './effect-promise-runtime-model';
import {
  deleteRuntimeMember,
  readRuntimeMember,
  writeRuntimeMember,
} from './effect-promise-runtime-heap';
import {
  joinRuntimeValueChoice,
  runtimeChoice,
  runtimeChoiceValue,
} from './effect-promise-runtime-choice';
import { unknownRuntimeValue } from './effect-promise-runtime-model';

const objectReference = (value: RuntimeValue): RuntimeObjectRef | undefined => {
  if (value && typeof value !== 'symbol' && 'kind' in value && value.kind === 'object') {
    return value;
  }
  return undefined;
};

const choiceObjectAlternatives = (
  choices: readonly RuntimeValue[],
): readonly RuntimeObjectRef[] | undefined => {
  const references: RuntimeObjectRef[] = [];
  for (const alternative of choices) {
    const reference = objectReference(alternative);
    if (!reference) {
      return undefined;
    }
    references.push(reference);
  }
  return references;
};

/**
 * Return every exact object alternative, or decline a non-object value.
 *
 * @internal
 */
export const runtimeObjectAlternatives = (
  value: RuntimeValue,
): readonly RuntimeObjectRef[] | undefined => {
  const choice = runtimeChoice(value);
  if (choice) {
    return choiceObjectAlternatives(choice.choices);
  }
  const reference = objectReference(value);
  if (reference) {
    return [reference];
  }
  return undefined;
};

/**
 * Read a member from every exact object alternative and join the values.
 *
 * @internal
 */
export const readRuntimeChoiceMember = (
  state: RuntimeState,
  value: RuntimeValue,
  name: string,
): RuntimeValue => {
  const choice = runtimeChoice(value);
  const overlay = choice && state.choiceMembers.get(choice);
  if (overlay?.has(name)) {
    return overlay.get(name);
  }
  const references = runtimeObjectAlternatives(value);
  if (!references) {
    return unknownRuntimeValue;
  }
  return runtimeChoiceValue(
    references.map((reference): RuntimeValue => {
      const members = state.heap.get(reference);
      if (members && !members.has(name)) {
        return undefined;
      }
      return readRuntimeMember(state, reference, name);
    }),
  );
};

const weakWriteRuntimeMember = (
  state: RuntimeState,
  reference: RuntimeObjectRef,
  name: string,
  value: RuntimeValue,
): void => {
  const members = state.heap.get(reference);
  let previous: RuntimeValue = undefined;
  if (members?.has(name)) {
    previous = members.get(name);
  }
  writeRuntimeMember(state, reference, name, joinRuntimeValueChoice(previous, value));
};

const choiceOverlay = (
  state: RuntimeState,
  choice: NonNullable<ReturnType<typeof runtimeChoice>>,
): Map<string, RuntimeValue> => {
  const existing = state.choiceMembers.get(choice);
  if (existing) {
    return existing;
  }
  const created = new Map<string, RuntimeValue>();
  state.choiceMembers.set(choice, created);
  return created;
};

/**
 * Write exactly through the selected choice while weakening each possible concrete alias.
 *
 * @internal
 */
export const writeRuntimeChoiceMember = (
  state: RuntimeState,
  target: RuntimeValue,
  name: string,
  value: RuntimeValue,
): void => {
  const choice = runtimeChoice(target);
  const references = runtimeObjectAlternatives(target);
  if (!references) {
    return;
  }
  if (!choice) {
    writeRuntimeMember(state, references[0], name, value);
    return;
  }
  choiceOverlay(state, choice).set(name, value);
  for (const reference of references) {
    weakWriteRuntimeMember(state, reference, name, value);
  }
};

/**
 * Delete exactly through a selected choice while weakening each possible alias.
 *
 * @internal
 */
export const deleteRuntimeChoiceMember = (
  state: RuntimeState,
  target: RuntimeValue,
  name: string,
): void => {
  const choice = runtimeChoice(target);
  const references = runtimeObjectAlternatives(target);
  if (!references) {
    return;
  }
  if (!choice) {
    deleteRuntimeMember(state, references[0], name);
    return;
  }
  choiceOverlay(state, choice).set(name, undefined);
  for (const reference of references) {
    weakWriteRuntimeMember(state, reference, name, undefined);
  }
};

const runtimeMemberNames = (state: RuntimeState, value: RuntimeValue): Set<string> => {
  const names = new Set<string>();
  const choice = runtimeChoice(value);
  for (const name of (choice && state.choiceMembers.get(choice)?.keys()) ?? []) {
    names.add(name);
  }
  for (const reference of runtimeObjectAlternatives(value) ?? []) {
    for (const name of state.heap.get(reference)?.keys() ?? []) {
      names.add(name);
    }
  }
  return names;
};

/**
 * Copy joined source members through an exact or correlated Object.assign target.
 *
 * @internal
 */
export const spreadRuntimeChoiceMembers = (
  state: RuntimeState,
  source: RuntimeValue,
  target: RuntimeValue,
): void => {
  for (const name of runtimeMemberNames(state, source)) {
    if (name !== 'length') {
      writeRuntimeChoiceMember(state, target, name, readRuntimeChoiceMember(state, source, name));
    }
  }
};
