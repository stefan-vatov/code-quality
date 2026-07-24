/* -------------------------------------------------------------------------- */
/*       Identity-preserving object and array heap for runtime values.        */
/* -------------------------------------------------------------------------- */

import type { RuntimeObjectRef, RuntimeState, RuntimeValue } from './effect-promise-runtime-model';
import type { ASTNode } from './effect-ast';
import { unknownRuntimeValue } from './effect-promise-runtime-model';

/**
 * Allocate one exact object identity in the mutable runtime heap.
 *
 * @internal
 */
export const allocateRuntimeObject = (
  state: RuntimeState,
  isArray = false,
  source?: ASTNode,
): RuntimeObjectRef => {
  const reference: RuntimeObjectRef = { identity: {}, isArray, kind: 'object', source };
  state.heap.set(reference, new Map());
  return reference;
};

/**
 * Read one exact member from an object identity.
 *
 * @internal
 */
export const readRuntimeMember = (
  state: RuntimeState,
  reference: RuntimeObjectRef,
  name: string,
): RuntimeValue => state.heap.get(reference)?.get(name) ?? unknownRuntimeValue;

/**
 * Write one exact member through every alias of an object identity.
 *
 * @internal
 */
export const writeRuntimeMember = (
  state: RuntimeState,
  reference: RuntimeObjectRef,
  name: string,
  value: RuntimeValue,
): void => {
  state.heap.get(reference)?.set(name, value);
};

/**
 * Delete one exact member through every alias of an object identity.
 *
 * @internal
 */
export const deleteRuntimeMember = (
  state: RuntimeState,
  reference: RuntimeObjectRef,
  name: string,
): void => {
  state.heap.get(reference)?.delete(name);
};

/**
 * Copy all enumerable abstract members in insertion order.
 *
 * @internal
 */
export const spreadRuntimeMembers = (
  state: RuntimeState,
  source: RuntimeObjectRef,
  target: RuntimeObjectRef,
): void => {
  const targetMembers = state.heap.get(target);
  if (!targetMembers) {
    return;
  }
  for (const [name, value] of state.heap.get(source) ?? []) {
    if (name !== 'length') {
      targetMembers.set(name, value);
    }
  }
};

/**
 * Read exact array elements from numeric heap members.
 *
 * @internal
 */
export const runtimeArrayValues = (
  state: RuntimeState,
  reference: RuntimeObjectRef,
): readonly RuntimeValue[] | undefined => {
  if (!reference.isArray) {
    return undefined;
  }
  const members = state.heap.get(reference);
  const { arrayLength } = reference;
  if (arrayLength === undefined) {
    return undefined;
  }
  const values: RuntimeValue[] = [];
  for (let index = 0; index < arrayLength; index += 1) {
    values.push(members?.get(String(index)) ?? unknownRuntimeValue);
  }
  return values;
};
