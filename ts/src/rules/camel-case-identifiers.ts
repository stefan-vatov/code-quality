import { CHAR_CLASS, CLS_UPPER, CLS_LOWER } from './char-class.js';

const isUp = (code: number): boolean => (CHAR_CLASS[code] & CLS_UPPER) !== 0;
const isLo = (code: number): boolean => (CHAR_CLASS[code] & CLS_LOWER) !== 0;

/**
 * Check if a name follows camelCase convention.
 */
function isCamelCase(name: string): boolean {
  const len = name.length;
  return len > 0 && isLo(name.charCodeAt(0)) && name.indexOf('_') === -1;
}

/**
 * Check if a name follows UPPER_CASE convention.
 */
function isUpperCase(name: string): boolean {
  const len = name.length;
  if (len === 0 || !isUp(name.charCodeAt(0))) {
    return false;
  }
  for (let idx = 1; idx < len; idx++) {
    const code = name.charCodeAt(idx);
    if (!(isUp(code) || (code >= 48 && code <= 57) || code === 95)) {
      return false;
    }
  }
  return true;
}

/**
 * Convert a name to camelCase.
 */
function toCamelCase(name: string): string {
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
    let result = name.slice(start, end).toLowerCase();

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
      const word = name.slice(segStart, segEnd);
      result += word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
      segStart = segEnd + 1;
    }
    return result;
  }

  return name.charAt(0).toLowerCase() + name.slice(1);
}

export { isCamelCase, isUpperCase, toCamelCase };
