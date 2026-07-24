/* -------------------------------------------------------------------------- */
/*       Explicit receiver bindings for the Effect runtime interpreter.       */
/* -------------------------------------------------------------------------- */

import type { ASTNode } from './effect-ast';
import type { RuntimeValue } from './effect-promise-runtime-model';

const boundUndefinedThis: ASTNode = Object.freeze({
  type: 'RuntimeBoundUndefinedThis',
});

/**
 * Encode an explicitly supplied receiver without conflating undefined with absence.
 *
 * @internal
 */
export const runtimeThisBinding = (value: RuntimeValue): RuntimeValue => {
  if (value === undefined) {
    return boundUndefinedThis;
  }
  return value;
};

/**
 * Decode an explicit receiver for ThisExpression evaluation.
 *
 * @internal
 */
export const runtimeThisValue = (value: RuntimeValue): RuntimeValue => {
  if (value === boundUndefinedThis) {
    return undefined;
  }
  return value;
};
