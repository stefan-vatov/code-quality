/** @internal PascalCase naming helpers for type-like declarations. */
import { CHAR_CLASS, CLS_LOWER, CLS_UPPER } from './char-class';

const CHAR_CODE_UNDERSCORE = 95;

const isUp = (code: number): boolean => (CHAR_CLASS[code] & CLS_UPPER) !== 0;
const isLo = (code: number): boolean => (CHAR_CLASS[code] & CLS_LOWER) !== 0;
const isLt = (code: number): boolean => (CHAR_CLASS[code] & (CLS_UPPER | CLS_LOWER)) !== 0;

const hasLowercaseLetter = (name: string): boolean => {
  for (let idx = 0; idx < name.length; idx++) {
    if (isLo(name.charCodeAt(idx))) {
      return true;
    }
  }
  return false;
};

const alphaLetterCount = (name: string): number => {
  let count = 0;
  for (let idx = 0; idx < name.length; idx++) {
    if (isLt(name.charCodeAt(idx))) {
      count++;
    }
  }
  return count;
};

const nextSegmentStart = (name: string, start: number): number => {
  let segmentStart = start;
  while (segmentStart < name.length && name.charCodeAt(segmentStart) === CHAR_CODE_UNDERSCORE) {
    segmentStart++;
  }
  return segmentStart;
};

const nextSegmentEnd = (name: string, start: number): number => {
  let segmentEnd = start;
  while (segmentEnd < name.length && name.charCodeAt(segmentEnd) !== CHAR_CODE_UNDERSCORE) {
    segmentEnd++;
  }
  return segmentEnd;
};

const pascalSegment = (name: string, start: number, end: number): string =>
  name.charAt(start).toUpperCase() + name.slice(start + 1, end).toLowerCase();

const appendPascalSegments = (name: string, result: string, start: number): string => {
  let output = result;
  let segStart = start;
  while (segStart < name.length) {
    segStart = nextSegmentStart(name, segStart);
    if (segStart >= name.length) {
      break;
    }
    const segEnd = nextSegmentEnd(name, segStart);
    output += pascalSegment(name, segStart, segEnd);
    segStart = segEnd + 1;
  }
  return output;
};

const underscoreNameToPascalCase = (name: string): string => {
  const start = nextSegmentStart(name, 0);
  if (start >= name.length) {
    return '';
  }

  const end = nextSegmentEnd(name, start);
  return appendPascalSegments(name, pascalSegment(name, start, end), end + 1);
};

/**
 * Check if a name follows PascalCase convention.
 */
export default function isPascalCase(name: string): boolean {
  const len = name.length;
  if (len === 0) {
    return false;
  }
  if (!isUp(name.charCodeAt(0))) {
    return false;
  }
  if (name.includes('_')) {
    return false;
  }

  // Must not be entirely uppercase (that's the constant convention).
  // Digits are fine — only check alphabetic characters.
  return hasLowercaseLetter(name) || alphaLetterCount(name) <= 1;
}

/**
 * Convert a name to PascalCase.
 */
export const toPascalCase = (name: string): string => {
  if (name.length === 0) {
    return '';
  }

  if (name.includes('_')) {
    return underscoreNameToPascalCase(name);
  }

  return name.charAt(0).toUpperCase() + name.slice(1);
};
