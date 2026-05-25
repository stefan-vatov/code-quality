/* -------------------------------------------------------------------------- */
/*           PascalCase naming helpers for type-like declarations.            */
/* -------------------------------------------------------------------------- */
import { Array, Match, pipe } from 'effect';
import { CHAR_CLASS, CLS_LOWER, CLS_UPPER } from './char-class';

const CHAR_CODE_UNDERSCORE = 95;

const isUp = (code: number): boolean => (CHAR_CLASS[code] & CLS_UPPER) !== 0;
const isLo = (code: number): boolean => (CHAR_CLASS[code] & CLS_LOWER) !== 0;
const isLt = (code: number): boolean => (CHAR_CLASS[code] & (CLS_UPPER | CLS_LOWER)) !== 0;

const nameChars = (name: string): string[] => Array.fromIterable(name);

const hasLowercaseLetter = (name: string): boolean =>
  pipe(
    nameChars(name),
    Array.some((char): boolean => isLo(char.charCodeAt(0))),
  );

const alphaLetterCount = (name: string): number =>
  pipe(
    nameChars(name),
    Array.filter((char): boolean => isLt(char.charCodeAt(0))),
    Array.length,
  );

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

const pascalSegment = (name: string, start: number, end: number): string =>
  name.charAt(start).toUpperCase() + name.slice(start + 1, end).toLowerCase();

const appendPascalSegments = (name: string, result: string, start: number): string => {
  const segmentStart = nextSegmentStart(name, start);
  return Match.value(segmentStart).pipe(
    Match.when(
      (normalizedSegmentStart): boolean => normalizedSegmentStart >= name.length,
      (): string => result,
    ),
    Match.orElse((normalizedSegmentStart): string => {
      const segmentEnd = nextSegmentEnd(name, normalizedSegmentStart);
      const nextResult = result + pascalSegment(name, normalizedSegmentStart, segmentEnd);
      return appendPascalSegments(name, nextResult, segmentEnd + 1);
    }),
  );
};

const underscoreNameToPascalCase = (name: string): string =>
  Match.value(nextSegmentStart(name, 0)).pipe(
    Match.when(
      (start): boolean => start >= name.length,
      (): string => '',
    ),
    Match.orElse((start): string => {
      const end = nextSegmentEnd(name, start);
      return appendPascalSegments(name, pascalSegment(name, start, end), end + 1);
    }),
  );

/**
 * Check if a name follows PascalCase convention.
 */
export default function isPascalCase(name: string): boolean {
  const len = name.length;
  return Match.value(name).pipe(
    Match.when(
      (value): boolean => len === 0 || !isUp(value.charCodeAt(0)) || value.includes('_'),
      (): boolean => false,
    ),
    Match.orElse((value): boolean => hasLowercaseLetter(value) || alphaLetterCount(value) <= 1),
  );
}

/**
 * Convert a name to PascalCase.
 */
export const toPascalCase = (name: string): string =>
  Match.value(name).pipe(
    Match.when(
      (value): boolean => value.length === 0,
      (): string => '',
    ),
    Match.when(
      (value): boolean => value.includes('_'),
      (value): string => underscoreNameToPascalCase(value),
    ),
    Match.orElse((value): string => value.charAt(0).toUpperCase() + value.slice(1)),
  );
