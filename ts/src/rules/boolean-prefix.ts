/**
 * Boolean prefix naming helpers for custom Oxlint rules.
 *
 * @internal
 */
import { CHAR_CLASS, CLS_DIGIT, CLS_UNDER, CLS_UPPER } from './char-class';

const CHAR_CODE_UPPER_A = 65;
const CHAR_CODE_LOWER_A = 97;
const CHAR_CODE_LOWER_D = 100;
const CHAR_CODE_LOWER_H = 104;
const CHAR_CODE_LOWER_I = 105;
const CHAR_CODE_LOWER_L = 108;
const CHAR_CODE_LOWER_O = 111;
const CHAR_CODE_LOWER_S = 115;
const CHAR_CODE_LOWER_U = 117;
const FIRST_CHAR_INDEX = 0;
const SECOND_CHAR_INDEX = 1;
const THIRD_CHAR_INDEX = 2;
const FOURTH_CHAR_INDEX = 3;
const FIFTH_CHAR_INDEX = 4;
const SIXTH_CHAR_INDEX = 5;
const SEVENTH_CHAR_INDEX = 6;
const HAS_PREFIX_LENGTH = 4;
const IS_PREFIX_LENGTH = 3;
const SHOULD_PREFIX_LENGTH = 7;

const isUp = (code: number): boolean => (CHAR_CLASS[code] & CLS_UPPER) !== 0;
const isDigit = (code: number): boolean => (CHAR_CLASS[code] & CLS_DIGIT) !== 0;
const isUnder = (code: number): boolean => (CHAR_CLASS[code] & CLS_UNDER) !== 0;

/**
 * Check if a variable name has a boolean prefix (is_, has_, should_).
 */

/**
 * Check if char at pos is the given lowercase letter (case-insensitive).
 */
const isCharCI = (str: string, pos: number, lowerCode: number): boolean => {
  const ch = str.charCodeAt(pos);
  return ch === lowerCode || ch === lowerCode - (CHAR_CODE_LOWER_A - CHAR_CODE_UPPER_A);
};

const hasValidPrefixBoundary = (name: string, index: number): boolean => {
  const next = name.charCodeAt(index);
  return isUnder(next) || isUp(next) || isDigit(next);
};

const hasIsPrefix = (name: string): boolean => {
  if (!isCharCI(name, FIRST_CHAR_INDEX, CHAR_CODE_LOWER_I)) {
    return false;
  }
  if (!isCharCI(name, SECOND_CHAR_INDEX, CHAR_CODE_LOWER_S)) {
    return false;
  }
  return hasValidPrefixBoundary(name, THIRD_CHAR_INDEX);
};

const hasHasPrefix = (name: string): boolean => {
  if (name.length < HAS_PREFIX_LENGTH) {
    return false;
  }
  if (!isCharCI(name, FIRST_CHAR_INDEX, CHAR_CODE_LOWER_H)) {
    return false;
  }
  if (!isCharCI(name, SECOND_CHAR_INDEX, CHAR_CODE_LOWER_A)) {
    return false;
  }
  if (!isCharCI(name, THIRD_CHAR_INDEX, CHAR_CODE_LOWER_S)) {
    return false;
  }
  return hasValidPrefixBoundary(name, FOURTH_CHAR_INDEX);
};

const hasShouldPrefix = (name: string): boolean => {
  if (name.length < SHOULD_PREFIX_LENGTH) {
    return false;
  }
  if (!hasShouldLetters(name)) {
    return false;
  }
  return hasValidPrefixBoundary(name, SEVENTH_CHAR_INDEX);
};

const hasShouldLetters = (name: string): boolean =>
  isCharCI(name, FIRST_CHAR_INDEX, CHAR_CODE_LOWER_S) &&
  isCharCI(name, SECOND_CHAR_INDEX, CHAR_CODE_LOWER_H) &&
  isCharCI(name, THIRD_CHAR_INDEX, CHAR_CODE_LOWER_O) &&
  isCharCI(name, FOURTH_CHAR_INDEX, CHAR_CODE_LOWER_U) &&
  isCharCI(name, FIFTH_CHAR_INDEX, CHAR_CODE_LOWER_L) &&
  isCharCI(name, SIXTH_CHAR_INDEX, CHAR_CODE_LOWER_D);

/**
 * Check if string consists only of uppercase letters (and optionally digits/underscores).
 */
const isAllCaps = (name: string): boolean => {
  for (let idx = 0; idx < name.length; idx++) {
    const code = name.charCodeAt(idx);
    if (!(isUp(code) || isDigit(code) || isUnder(code))) {
      return false;
    }
  }
  // Must have at least one letter
  for (let idx = 0; idx < name.length; idx++) {
    if (isUp(name.charCodeAt(idx))) {
      return true;
    }
  }
  return false;
};

/**
 * Checks whether a boolean variable name starts with an accepted boolean prefix.
 *
 * @param name - Identifier name to inspect.
 * @returns True when the identifier starts with is, has, or should.
 */
export default function hasBooleanPrefix(name: string): boolean {
  const len = name.length;
  if (len < IS_PREFIX_LENGTH) {
    return false;
  }

  return hasIsPrefix(name) || hasHasPrefix(name) || hasShouldPrefix(name);
}

/**
 * Suggests a boolean-prefixed replacement name.
 *
 * @param name - Identifier name that failed the prefix rule.
 * @returns Suggested identifier using the configured boolean prefix convention.
 */
export const suggestBooleanName = (name: string): string => {
  if (name.length === 0) {
    return 'isEnabled';
  }

  if (isAllCaps(name)) {
    return `IS_${name}`;
  }
  if (name.includes('_')) {
    return `is_${name}`;
  }
  if (isUp(name.charCodeAt(0))) {
    return `is${name}`;
  }
  return `is${name.charAt(0).toUpperCase()}${name.slice(1)}`;
};
