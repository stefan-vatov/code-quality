/* -------------------------------------------------------------------------- */
/*            Exact shared JavaScript primitive scalar operations.            */
/* -------------------------------------------------------------------------- */

import { unknownRuntimeValue } from './effect-promise-runtime-model';

/**
 * JavaScript primitives whose coercion can be evaluated without user code.
 *
 * @internal
 */
export type RuntimeExactScalar = boolean | number | string | null | undefined;

/**
 * Exact supported primitive or the conservative runtime unknown sentinel.
 *
 * @internal
 */
export type RuntimeScalarResult = RuntimeExactScalar | typeof unknownRuntimeValue;

type RuntimeScalarInput = RuntimeExactScalar | bigint | object | symbol;

const isRuntimeExactScalar = (value: RuntimeScalarInput): value is RuntimeExactScalar =>
  value === null ||
  value === undefined ||
  typeof value === 'boolean' ||
  typeof value === 'number' ||
  typeof value === 'string';

const isNullish = (value: RuntimeExactScalar): value is null | undefined =>
  value === null || value === undefined;

const normalizedLooseScalar = (value: RuntimeExactScalar): RuntimeExactScalar => {
  if (typeof value === 'boolean') {
    return Number(value);
  }
  return value;
};

const normalizedLooseEqual = (left: RuntimeExactScalar, right: RuntimeExactScalar): boolean => {
  if (typeof left === typeof right) {
    return left === right;
  }
  if (typeof left === 'number' && typeof right === 'string') {
    return left === Number(right);
  }
  if (typeof left === 'string' && typeof right === 'number') {
    return Number(left) === right;
  }
  return false;
};

const looseEqual = (left: RuntimeExactScalar, right: RuntimeExactScalar): boolean => {
  if (typeof left === typeof right) {
    return left === right;
  }
  if (isNullish(left) || isNullish(right)) {
    return isNullish(left) && isNullish(right);
  }
  return normalizedLooseEqual(normalizedLooseScalar(left), normalizedLooseScalar(right));
};

const equalityScalar = (
  operator: string,
  left: RuntimeExactScalar,
  right: RuntimeExactScalar,
): RuntimeScalarResult => {
  if (operator === '===') {
    return left === right;
  }
  if (operator === '!==') {
    return left !== right;
  }
  if (operator === '==') {
    return looseEqual(left, right);
  }
  if (operator === '!=') {
    return !looseEqual(left, right);
  }
  return unknownRuntimeValue;
};

const orderedComparison = (
  operator: string,
  left: number | string,
  right: number | string,
): RuntimeScalarResult => {
  if (operator === '<') {
    return left < right;
  }
  if (operator === '<=') {
    return left <= right;
  }
  if (operator === '>') {
    return left > right;
  }
  if (operator === '>=') {
    return left >= right;
  }
  return unknownRuntimeValue;
};

const relationalScalar = (
  operator: string,
  left: RuntimeExactScalar,
  right: RuntimeExactScalar,
): RuntimeScalarResult => {
  if (typeof left === 'string' && typeof right === 'string') {
    return orderedComparison(operator, left, right);
  }
  return orderedComparison(operator, Number(left), Number(right));
};

const remainderScalar = (operator: string, left: number, right: number): RuntimeScalarResult => {
  if (operator === '%') {
    return left % right;
  }
  if (operator === '**') {
    return left ** right;
  }
  return unknownRuntimeValue;
};

const numericArithmetic = (operator: string, left: number, right: number): RuntimeScalarResult => {
  if (operator === '-') {
    return left - right;
  }
  if (operator === '*') {
    return left * right;
  }
  if (operator === '/') {
    return left / right;
  }
  return remainderScalar(operator, left, right);
};

const arithmeticScalar = (
  operator: string,
  left: RuntimeExactScalar,
  right: RuntimeExactScalar,
): RuntimeScalarResult => {
  if (operator === '+') {
    if (typeof left === 'string' || typeof right === 'string') {
      return String(left) + String(right);
    }
    return Number(left) + Number(right);
  }
  return numericArithmetic(operator, Number(left), Number(right));
};

/**
 * Evaluate a binary operation only when both operands are exact safe primitives. Objects, symbols,
 * bigint values, and unknown sentinels remain conservative because their conversion may execute user
 * code or requires a separate exact numeric domain.
 *
 * @internal
 */
export const evaluateRuntimeBinaryScalar = (
  operator: string,
  left: RuntimeScalarInput,
  right: RuntimeScalarInput,
): RuntimeScalarResult => {
  if (!isRuntimeExactScalar(left) || !isRuntimeExactScalar(right)) {
    return unknownRuntimeValue;
  }
  const equality = equalityScalar(operator, left, right);
  if (equality !== unknownRuntimeValue) {
    return equality;
  }
  const relational = relationalScalar(operator, left, right);
  if (relational !== unknownRuntimeValue) {
    return relational;
  }
  return arithmeticScalar(operator, left, right);
};
