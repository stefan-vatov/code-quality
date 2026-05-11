/**
 * Pre-computed character classification table for ASCII (0-127).
 *
 * Bitmask values:
 *   1 = uppercase letter (A-Z, 65-90)
 *   2 = lowercase letter (a-z, 97-122)
 *   4 = digit (0-9, 48-57)
 *   8 = underscore (_)
 *
 * Usage: CHAR_CLASS[charCode] & CLS_UPPER → boolean
 */

const CHAR_CLASS = new Uint8Array(128);

// Populate at module init (runs once)
for (let idx = 65; idx <= 90; idx++) {
  CHAR_CLASS[idx] = 1;
} // A-Z
for (let idx = 97; idx <= 122; idx++) {
  CHAR_CLASS[idx] = 2;
} // A-z
for (let idx = 48; idx <= 57; idx++) {
  CHAR_CLASS[idx] = 4;
} // 0-9
CHAR_CLASS[95] = 8; // _

const CLS_UPPER = 1;
const CLS_LOWER = 2;
const CLS_DIGIT = 4;
const CLS_UNDER = 8;

export { CHAR_CLASS, CLS_UPPER, CLS_LOWER, CLS_DIGIT, CLS_UNDER };
