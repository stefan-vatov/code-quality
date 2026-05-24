/** @internal camelCase naming helpers for custom Oxlint identifier rules. */
import { CHAR_CLASS, CLS_LOWER, CLS_UPPER } from './char-class';

const CHAR_CODE_ZERO = 48;
const CHAR_CODE_NINE = 57;
const CHAR_CODE_UNDERSCORE = 95;

const isUp = (code: number): boolean => (CHAR_CLASS[code] & CLS_UPPER) !== 0;
const isLo = (code: number): boolean => (CHAR_CLASS[code] & CLS_LOWER) !== 0;

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

const camelTailSegment = (name: string, start: number, end: number): string => {
  const word = name.slice(start, end);
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
};

const appendCamelSegments = (name: string, result: string, start: number): string => {
  let output = result;
  let segStart = start;
  while (segStart < name.length) {
    segStart = nextSegmentStart(name, segStart);
    if (segStart >= name.length) {
      break;
    }
    const segEnd = nextSegmentEnd(name, segStart);
    output += camelTailSegment(name, segStart, segEnd);
    segStart = segEnd + 1;
  }
  return output;
};

const underscoreNameToCamelCase = (name: string): string => {
  const start = nextSegmentStart(name, 0);
  if (start >= name.length) {
    return '';
  }

  const end = nextSegmentEnd(name, start);
  return appendCamelSegments(name, name.slice(start, end).toLowerCase(), end + 1);
};

/**
 * Check if a name follows camelCase convention.
 */
export const isCamelCase = (name: string): boolean => {
  const len = name.length;
  return len > 0 && isLo(name.charCodeAt(0)) && !name.includes('_');
};

/**
 * Check if a name follows UPPER_CASE convention.
 */
export const isUpperCase = (name: string): boolean => {
  const len = name.length;
  if (len === 0 || !isUp(name.charCodeAt(0))) {
    return false;
  }
  for (let idx = 1; idx < len; idx++) {
    const code = name.charCodeAt(idx);
    if (
      !(
        isUp(code) ||
        (code >= CHAR_CODE_ZERO && code <= CHAR_CODE_NINE) ||
        code === CHAR_CODE_UNDERSCORE
      )
    ) {
      return false;
    }
  }
  return true;
};

/**
 * Convert a name to camelCase.
 */
export const toCamelCase = (name: string): string => {
  if (name.length === 0) {
    return '';
  }

  if (name.includes('_')) {
    return underscoreNameToCamelCase(name);
  }

  return name.charAt(0).toLowerCase() + name.slice(1);
};
