/* -------------------------------------------------------------------------- */
/*           PascalCase naming helpers for type-like declarations.            */
/* -------------------------------------------------------------------------- */
import { CHAR_CLASS, CLS_LOWER, CLS_UPPER } from './char-class';

const CHAR_CODE_UNDERSCORE = 95;

const isUp = (code: number): boolean => (CHAR_CLASS[code] & CLS_UPPER) !== 0;
const isLo = (code: number): boolean => (CHAR_CLASS[code] & CLS_LOWER) !== 0;
const isLt = (code: number): boolean => (CHAR_CLASS[code] & (CLS_UPPER | CLS_LOWER)) !== 0;

const hasLowercaseLetter = (name: string): boolean => {
  for (let index = 0; index < name.length; index += 1) {
    if (isLo(name.charCodeAt(index))) {
      return true;
    }
  }
  return false;
};

const alphaLetterCount = (name: string): number => {
  let count = 0;
  for (let index = 0; index < name.length; index += 1) {
    if (isLt(name.charCodeAt(index))) {
      count += 1;
    }
  }
  return count;
};

const nextSegmentStart = (name: string, start: number): number => {
  let segmentStart = start;
  while (segmentStart < name.length && name.charCodeAt(segmentStart) === CHAR_CODE_UNDERSCORE) {
    segmentStart += 1;
  }
  return segmentStart;
};

const nextSegmentEnd = (name: string, start: number): number => {
  let segmentEnd = start;
  while (segmentEnd < name.length && name.charCodeAt(segmentEnd) !== CHAR_CODE_UNDERSCORE) {
    segmentEnd += 1;
  }
  return segmentEnd;
};

const pascalSegment = (name: string, start: number, end: number): string =>
  name.charAt(start).toUpperCase() + name.slice(start + 1, end).toLowerCase();

const appendPascalSegments = (name: string, result: string, start: number): string => {
  const parts = [result];
  let segmentStart = nextSegmentStart(name, start);
  while (segmentStart < name.length) {
    const segmentEnd = nextSegmentEnd(name, segmentStart);
    parts.push(pascalSegment(name, segmentStart, segmentEnd));
    segmentStart = nextSegmentStart(name, segmentEnd + 1);
  }
  return parts.join('');
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
  if (len === 0 || !isUp(name.charCodeAt(0)) || name.includes('_')) {
    return false;
  }
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
