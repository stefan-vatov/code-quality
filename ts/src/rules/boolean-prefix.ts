/* -------------------------------------------------------------------------- */
/*           Boolean prefix naming helpers for custom Oxlint rules.           */
/* -------------------------------------------------------------------------- */
import { Array, Match, pipe } from 'effect';
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
const nameChars = (name: string): string[] => Array.fromIterable(name);

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

const hasIsPrefix = (name: string): boolean =>
  Match.value(name).pipe(
    Match.when(
      (value): boolean =>
        !isCharCI(value, FIRST_CHAR_INDEX, CHAR_CODE_LOWER_I) ||
        !isCharCI(value, SECOND_CHAR_INDEX, CHAR_CODE_LOWER_S),
      (): boolean => false,
    ),
    Match.orElse((value): boolean => hasValidPrefixBoundary(value, THIRD_CHAR_INDEX)),
  );

const hasHasPrefix = (name: string): boolean =>
  Match.value(name).pipe(
    Match.when(
      (value): boolean =>
        value.length < HAS_PREFIX_LENGTH ||
        !isCharCI(value, FIRST_CHAR_INDEX, CHAR_CODE_LOWER_H) ||
        !isCharCI(value, SECOND_CHAR_INDEX, CHAR_CODE_LOWER_A) ||
        !isCharCI(value, THIRD_CHAR_INDEX, CHAR_CODE_LOWER_S),
      (): boolean => false,
    ),
    Match.orElse((value): boolean => hasValidPrefixBoundary(value, FOURTH_CHAR_INDEX)),
  );

const hasShouldPrefix = (name: string): boolean =>
  Match.value(name).pipe(
    Match.when(
      (value): boolean => value.length < SHOULD_PREFIX_LENGTH || !hasShouldLetters(value),
      (): boolean => false,
    ),
    Match.orElse((value): boolean => hasValidPrefixBoundary(value, SEVENTH_CHAR_INDEX)),
  );

const hasShouldLetters = (name: string): boolean =>
  pipe(
    [
      [FIRST_CHAR_INDEX, CHAR_CODE_LOWER_S],
      [SECOND_CHAR_INDEX, CHAR_CODE_LOWER_H],
      [THIRD_CHAR_INDEX, CHAR_CODE_LOWER_O],
      [FOURTH_CHAR_INDEX, CHAR_CODE_LOWER_U],
      [FIFTH_CHAR_INDEX, CHAR_CODE_LOWER_L],
      [SIXTH_CHAR_INDEX, CHAR_CODE_LOWER_D],
    ] as const,
    Array.every(([index, charCode]): boolean => isCharCI(name, index, charCode)),
  );

/**
 * Check if string consists only of uppercase letters (and optionally digits/underscores).
 */
const isAllCaps = (name: string): boolean => {
  const chars = nameChars(name);
  return (
    pipe(
      chars,
      Array.every((char): boolean => {
        const code = char.charCodeAt(0);
        return isUp(code) || isDigit(code) || isUnder(code);
      }),
    ) &&
    pipe(
      chars,
      Array.some((char): boolean => isUp(char.charCodeAt(0))),
    )
  );
};

/**
 * Checks whether a boolean variable name starts with an accepted boolean prefix.
 *
 * @param name - Identifier name to inspect.
 * @returns True when the identifier starts with is, has, or should.
 */
export default function hasBooleanPrefix(name: string): boolean {
  const len = name.length;
  return Match.value(len).pipe(
    Match.when(
      (length): boolean => length < IS_PREFIX_LENGTH,
      (): boolean => false,
    ),
    Match.orElse((): boolean => hasIsPrefix(name) || hasHasPrefix(name) || hasShouldPrefix(name)),
  );
}

/**
 * Suggests a boolean-prefixed replacement name.
 *
 * @param name - Identifier name that failed the prefix rule.
 * @returns Suggested identifier using the configured boolean prefix convention.
 */
export const suggestBooleanName = (name: string): string =>
  Match.value(name).pipe(
    Match.when(
      (value): boolean => value.length === 0,
      (): string => 'isEnabled',
    ),
    Match.when(
      (value): boolean => isAllCaps(value),
      (value): string => `IS_${value}`,
    ),
    Match.when(
      (value): boolean => value.includes('_'),
      (value): string => `is_${value}`,
    ),
    Match.when(
      (value): boolean => isUp(value.charCodeAt(0)),
      (value): string => `is${value}`,
    ),
    Match.orElse((value): string => `is${value.charAt(0).toUpperCase()}${value.slice(1)}`),
  );
