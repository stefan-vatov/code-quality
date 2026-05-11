import { CHAR_CLASS, CLS_UPPER, CLS_LOWER } from './char-class.js';

const isUp = (code: number): boolean => (CHAR_CLASS[code] & CLS_UPPER) !== 0;
const isLo = (code: number): boolean => (CHAR_CLASS[code] & CLS_LOWER) !== 0;
const isLt = (code: number): boolean => (CHAR_CLASS[code] & (CLS_UPPER | CLS_LOWER)) !== 0;

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
  if (name.indexOf('_') !== -1) {
    return false;
  }

  // Must not be entirely uppercase (that's the constant convention).
  // Digits are fine — only check alphabetic characters.
  let alphaCount = 0;
  let allUpper = true;
  for (let idx = 0; idx < len; idx++) {
    const code = name.charCodeAt(idx);
    if (isLt(code)) {
      alphaCount++;
      if (isLo(code)) {
        allUpper = false;
      }
    }
  }
  return !(allUpper && alphaCount > 1);
}

/**
 * Convert a name to PascalCase.
 */
export function toPascalCase(name: string): string {
  if (name.length === 0) {
    return '';
  }

  if (name.indexOf('_') !== -1) {
    let start = 0;
    while (start < name.length && name.charCodeAt(start) === 95) {
      start++;
    }
    if (start >= name.length) {
      return '';
    }

    let end = start;
    while (end < name.length && name.charCodeAt(end) !== 95) {
      end++;
    }
    let result = name.charAt(start).toUpperCase() + name.slice(start + 1, end).toLowerCase();

    let segStart = end + 1;
    while (segStart < name.length) {
      while (segStart < name.length && name.charCodeAt(segStart) === 95) {
        segStart++;
      }
      if (segStart >= name.length) {
        break;
      }
      let segEnd = segStart;
      while (segEnd < name.length && name.charCodeAt(segEnd) !== 95) {
        segEnd++;
      }
      result +=
        name.charAt(segStart).toUpperCase() + name.slice(segStart + 1, segEnd).toLowerCase();
      segStart = segEnd + 1;
    }
    return result;
  }

  return name.charAt(0).toUpperCase() + name.slice(1);
}
