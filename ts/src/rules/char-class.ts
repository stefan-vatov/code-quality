/* -------------------------------------------------------------------------- */
/*      ASCII character classification table for hot-path lint helpers.       */
/* -------------------------------------------------------------------------- */
import { Array, pipe } from 'effect';

const ASCII_TABLE_SIZE = 128;
const CHAR_CODE_ZERO = 48;
const CHAR_CODE_NINE = 57;
const CHAR_CODE_UPPER_A = 65;
const CHAR_CODE_UPPER_Z = 90;
const CHAR_CODE_LOWER_A = 97;
const CHAR_CODE_LOWER_Z = 122;
const CHAR_CODE_UNDERSCORE = 95;
const CLASS_UPPER_BIT = 1;
const CLASS_LOWER_BIT = 2;
const CLASS_DIGIT_BIT = 4;
const CLASS_UNDERSCORE_BIT = 8;

const buildCharClass = (): Uint8Array => {
  const charClass = new Uint8Array(ASCII_TABLE_SIZE);

  pipe(
    Array.range(CHAR_CODE_UPPER_A, CHAR_CODE_UPPER_Z),
    Array.forEach((idx): void => {
      charClass[idx] = CLASS_UPPER_BIT;
    }),
  );

  pipe(
    Array.range(CHAR_CODE_LOWER_A, CHAR_CODE_LOWER_Z),
    Array.forEach((idx): void => {
      charClass[idx] = CLASS_LOWER_BIT;
    }),
  );

  pipe(
    Array.range(CHAR_CODE_ZERO, CHAR_CODE_NINE),
    Array.forEach((idx): void => {
      charClass[idx] = CLASS_DIGIT_BIT;
    }),
  );

  charClass[CHAR_CODE_UNDERSCORE] = CLASS_UNDERSCORE_BIT;
  return charClass;
};

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const CHAR_CLASS = buildCharClass();

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const CLS_UPPER = CLASS_UPPER_BIT;
/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const CLS_LOWER = CLASS_LOWER_BIT;
/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const CLS_DIGIT = CLASS_DIGIT_BIT;
/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const CLS_UNDER = CLASS_UNDERSCORE_BIT;
