import { CHAR_CLASS, CLS_UPPER } from './char-class.js';

const isUp = (code: number): boolean => (CHAR_CLASS[code] & CLS_UPPER) !== 0;

/**
 * Check if a variable name has a boolean prefix (is_, has_, should_).
 */

/** Check if char at pos is the given lowercase letter (case-insensitive). */
function isCharCI(str: string, pos: number, lowerCode: number): boolean {
  const ch = str.charCodeAt(pos);
  return ch === lowerCode || ch === lowerCode - 32;
}

/** Check if string consists only of uppercase letters (and optionally digits/underscores). */
function isAllCaps(name: string): boolean {
  for (let idx = 0; idx < name.length; idx++) {
    const code = name.charCodeAt(idx);
    if (!(isUp(code) || (code >= 48 && code <= 57) || code === 95)) {
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
}

export default function hasBooleanPrefix(name: string): boolean {
  const len = name.length;
  if (len < 3) {
    return false;
  }

  const c0 = name.charCodeAt(0);
  if (c0 === 105 || c0 === 73) {
    const c1 = name.charCodeAt(1);
    if (c1 !== 115 && c1 !== 83) {
      return false;
    }
    const next = name.charCodeAt(2);
    return next === 95 || isUp(next) || (next >= 48 && next <= 57);
  }
  if (c0 === 104 || c0 === 72) {
    if (len < 4) {
      return false;
    }
    if (!isCharCI(name, 1, 97)) {
      return false;
    }
    if (!isCharCI(name, 2, 115)) {
      return false;
    }
    const next = name.charCodeAt(3);
    return next === 95 || isUp(next) || (next >= 48 && next <= 57);
  }
  if (c0 === 115 || c0 === 83) {
    if (len < 7) {
      return false;
    }
    if (!isCharCI(name, 1, 104)) {
      return false;
    }
    if (!isCharCI(name, 2, 111)) {
      return false;
    }
    if (!isCharCI(name, 3, 117)) {
      return false;
    }
    if (!isCharCI(name, 4, 108)) {
      return false;
    }
    if (!isCharCI(name, 5, 100)) {
      return false;
    }
    const next = name.charCodeAt(6);
    return next === 95 || isUp(next) || (next >= 48 && next <= 57);
  }
  return false;
}

/**
 * Suggest a boolean-prefixed name by prepending `is`.
 */
export function suggestBooleanName(name: string): string {
  if (name.length === 0) {
    return 'isEnabled';
  }

  if (isAllCaps(name)) {
    return `IS_${name}`;
  }
  if (name.indexOf('_') !== -1) {
    return `is_${name}`;
  }
  if (isUp(name.charCodeAt(0))) {
    return `is${name}`;
  }
  return `is${name.charAt(0).toUpperCase()}${name.slice(1)}`;
}
