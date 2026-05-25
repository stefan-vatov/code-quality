/* -------------------------------------------------------------------------- */
/*        CamelCase naming helpers for custom Oxlint identifier rules.        */
/* -------------------------------------------------------------------------- */
import { Array, Match, pipe } from 'effect';
import { CHAR_CLASS, CLS_LOWER, CLS_UPPER } from './char-class';

const CHAR_CODE_ZERO = 48;
const CHAR_CODE_NINE = 57;
const CHAR_CODE_UNDERSCORE = 95;

const isUp = (code: number): boolean => (CHAR_CLASS[code] & CLS_UPPER) !== 0;
const isLo = (code: number): boolean => (CHAR_CLASS[code] & CLS_LOWER) !== 0;

const nextSegmentStart = (name: string, start: number): number =>
  Match.value(start).pipe(
    Match.when(
      (segmentStart): boolean =>
        segmentStart < name.length && name.charCodeAt(segmentStart) === CHAR_CODE_UNDERSCORE,
      (segmentStart): number => nextSegmentStart(name, segmentStart + 1),
    ),
    Match.orElse((segmentStart): number => segmentStart),
  );

const nextSegmentEnd = (name: string, start: number): number =>
  Match.value(start).pipe(
    Match.when(
      (segmentEnd): boolean =>
        segmentEnd < name.length && name.charCodeAt(segmentEnd) !== CHAR_CODE_UNDERSCORE,
      (segmentEnd): number => nextSegmentEnd(name, segmentEnd + 1),
    ),
    Match.orElse((segmentEnd): number => segmentEnd),
  );

const camelTailSegment = (name: string, start: number, end: number): string => {
  const word = name.slice(start, end);
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
};

const appendCamelSegments = (name: string, result: string, start: number): string => {
  const segmentStart = nextSegmentStart(name, start);
  return Match.value(segmentStart).pipe(
    Match.when(
      (normalizedSegmentStart): boolean => normalizedSegmentStart >= name.length,
      (): string => result,
    ),
    Match.orElse((normalizedSegmentStart): string => {
      const segmentEnd = nextSegmentEnd(name, normalizedSegmentStart);
      const nextResult = result + camelTailSegment(name, normalizedSegmentStart, segmentEnd);
      return appendCamelSegments(name, nextResult, segmentEnd + 1);
    }),
  );
};

const underscoreNameToCamelCase = (name: string): string =>
  Match.value(nextSegmentStart(name, 0)).pipe(
    Match.when(
      (start): boolean => start >= name.length,
      (): string => '',
    ),
    Match.orElse((start): string => {
      const end = nextSegmentEnd(name, start);
      return appendCamelSegments(name, name.slice(start, end).toLowerCase(), end + 1);
    }),
  );

/**
 * Check if a name follows camelCase convention.
 */
export const isCamelCase = (name: string): boolean => {
  const len = name.length;
  return len > 0 && isLo(name.charCodeAt(0)) && !name.includes('_');
};

const isUpperCaseTailCode = (code: number): boolean =>
  isUp(code) || (code >= CHAR_CODE_ZERO && code <= CHAR_CODE_NINE) || code === CHAR_CODE_UNDERSCORE;

/**
 * Check if a name follows UPPER_CASE convention.
 */
export const isUpperCase = (name: string): boolean => {
  const len = name.length;
  return Match.value(len).pipe(
    Match.when(
      (length): boolean => length === 0 || !isUp(name.charCodeAt(0)),
      (): boolean => false,
    ),
    Match.orElse((): boolean =>
      pipe(
        Array.fromIterable(name.slice(1)),
        Array.every((char): boolean => isUpperCaseTailCode(char.charCodeAt(0))),
      ),
    ),
  );
};

/**
 * Convert a name to camelCase.
 */
export const toCamelCase = (name: string): string =>
  Match.value(name).pipe(
    Match.when(
      (value): boolean => value.length === 0,
      (): string => '',
    ),
    Match.when(
      (value): boolean => value.includes('_'),
      (value): string => underscoreNameToCamelCase(value),
    ),
    Match.orElse((value): string => value.charAt(0).toLowerCase() + value.slice(1)),
  );
