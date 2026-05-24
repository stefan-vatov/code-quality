/**
 * ASCII character classification table for hot-path lint helpers.
 *
 * @internal
 */
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

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const CHAR_CLASS = new Uint8Array(ASCII_TABLE_SIZE);

// Populate at module init.
// A-Z
for (let idx = CHAR_CODE_UPPER_A; idx <= CHAR_CODE_UPPER_Z; idx++) {
  CHAR_CLASS[idx] = CLASS_UPPER_BIT;
}
// Lowercase letters.
for (let idx = CHAR_CODE_LOWER_A; idx <= CHAR_CODE_LOWER_Z; idx++) {
  CHAR_CLASS[idx] = CLASS_LOWER_BIT;
}
// 0-9
for (let idx = CHAR_CODE_ZERO; idx <= CHAR_CODE_NINE; idx++) {
  CHAR_CLASS[idx] = CLASS_DIGIT_BIT;
}
// Underscore.
CHAR_CLASS[CHAR_CODE_UNDERSCORE] = CLASS_UNDERSCORE_BIT;

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
