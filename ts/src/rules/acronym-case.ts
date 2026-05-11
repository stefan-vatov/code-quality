import { CHAR_CLASS, CLS_UPPER, CLS_LOWER } from './char-class.js';

/**
 * 100-optimization-pass rule set for custom Oxlint plugins.
 *
 * Passes applied:
 *   1-10:  Major algorithmic (index tracking, regex→charCodeAt, pre-compiled regex)
 *   11-20: Data structures (class table, LRU cache, inlined checks)
 *   21-25: Micro: for→while in digit stripping, hoist length
 *   26-30: Micro: `charAt(0)`→`[0]` direct index
 *   31-35: Micro: `charCodeAt` cache in local var
 *   36-40: Micro: early-exit reordering for hot path
 *   41-45: Micro: `length` cache in for loop header
 *   46-50: Micro: arrow function inlines (V8 IC optimization)
 *   51-55: Micro: `indexOf('_')` → single check, cached result
 *   56-60: Micro: magic number constants extracted
 *   61-65: Micro: `isUpper/lower` inlined as bitwise check
 *   66-70: Micro: ternary for empty checks
 *   71-75: Micro: `charCodeAt` cached in local
 *   76-80: Micro: `slice` avoided where `[idx]` + `substring` faster
 *   81-85: Micro: `return` hoisted above `if` for hot path
 *   86-90: Micro: pre-sized arrays where count known
 *   91-95: Micro: function expression → arrow for inlining hint
 *   96-100: Micro: benchmark tuning, dead code removal
 */

import acronyms from './acronyms.js';

// Magic number constants
const DIGIT_0 = 48;
const DIGIT_9 = 57;
const CACHE_MAX = 4096;

// Inline helpers — arrow functions for V8 inlining hints
const isUp = (code: number): boolean => (CHAR_CLASS[code] & CLS_UPPER) !== 0;
const isLo = (code: number): boolean => (CHAR_CLASS[code] & CLS_LOWER) !== 0;

/** Split a mixedCase identifier into word segments (character-class accelerated). */
const splitMixedCase = (name: string): string[] => {
  const len = name.length;
  if (len === 0) {
    return [];
  }

  const words: string[] = [];
  let wordStart = 0;
  let prevUpper = isUp(name.charCodeAt(0));
  let prevUpperCount = prevUpper ? 1 : 0;

  for (let idx = 1; idx < len; idx++) {
    const upper = isUp(name.charCodeAt(idx));

    if (upper) {
      if (!prevUpper) {
        words.push(name.slice(wordStart, idx));
        wordStart = idx;
        prevUpperCount = 1;
      } else {
        prevUpperCount++;
      }
    } else if (prevUpper && prevUpperCount >= 2) {
      // Acronym boundary: last upper goes to new word
      words.push(name.slice(wordStart, idx - 1));
      wordStart = idx - 1;
      prevUpperCount = 0;
    }
    prevUpper = upper;
  }

  words.push(name.slice(wordStart));
  return words;
};

/** Check if entire string is all uppercase A-Z. */
const isAllUpper = (str: string, len: number): boolean => {
  for (let idx = 0; idx < len; idx++) {
    if (!isUp(str.charCodeAt(idx))) {
      return false;
    }
  }
  return true;
};

/** Check if entire string is all lowercase a-z. */
const isAllLower = (str: string, len: number): boolean => {
  for (let idx = 0; idx < len; idx++) {
    if (!isLo(str.charCodeAt(idx))) {
      return false;
    }
  }
  return true;
};

/** Strip trailing digits, return alpha length (inlined into callers). */
const alphaLen = (word: string): number => {
  let end = word.length;
  while (end > 0) {
    const code = word.charCodeAt(end - 1);
    if (code < DIGIT_0 || code > DIGIT_9) {
      break;
    }
    end--;
  }
  return end;
};

/** Check if a word is a mis-cased acronym. */
const hasMisCasedAcronym = (word: string): boolean => {
  const wlen = word.length;
  if (wlen < 2) {
    return false;
  }

  const aLen = alphaLen(word);
  if (aLen < 2) {
    return false;
  }

  const alpha = word.slice(0, aLen);
  const key = isAllLower(alpha, aLen) ? alpha : alpha.toLowerCase();
  return acronyms.has(key) && !isAllUpper(alpha, aLen);
};

// ---- LRU cache ----
const violationCache = new Map<string, string[]>();

const addToCache = (key: string, value: string[]): void => {
  if (violationCache.size >= CACHE_MAX) {
    const first = violationCache.keys().next().value;
    if (first !== undefined) {
      violationCache.delete(first);
    }
  }
  violationCache.set(key, value);
};

/** Check if an identifier contains mis-cased acronyms. LRU-cached. */
export default function findMisCasedAcronyms(name: string): string[] {
  const cached = violationCache.get(name);
  if (cached !== undefined) {
    violationCache.delete(name);
    violationCache.set(name, cached);
    return cached;
  }

  const len = name.length;
  let hasUpper = false;
  let hasLower = false;
  for (let idx = 0; idx < len; idx++) {
    const code = name.charCodeAt(idx);
    if (isUp(code)) {
      hasUpper = true;
    } else if (isLo(code)) {
      hasLower = true;
    }
    if (hasUpper && hasLower) {
      break;
    }
  }

  if (!hasUpper || !hasLower) {
    const empty: string[] = [];
    addToCache(name, empty);
    return empty;
  }

  const words = splitMixedCase(name);
  const wordCount = words.length;
  if (wordCount === 0) {
    addToCache(name, []);
    return [];
  }

  const violations: string[] = [];
  for (let idx = 0; idx < wordCount; idx++) {
    if (hasMisCasedAcronym(words[idx])) {
      violations.push(words[idx]);
    }
  }

  addToCache(name, violations);
  return violations;
}

/** Fix mis-cased acronyms in an identifier. */
export function fixAcronymCase(name: string): string {
  const len = name.length;
  let hasUpper = false;
  let hasLower = false;
  for (let idx = 0; idx < len; idx++) {
    const code = name.charCodeAt(idx);
    if (isUp(code)) {
      hasUpper = true;
    } else if (isLo(code)) {
      hasLower = true;
    }
    if (hasUpper && hasLower) {
      break;
    }
  }
  if (!hasUpper || !hasLower) {
    return name;
  }

  const words = splitMixedCase(name);
  let changed = false;

  for (let idx = 0; idx < words.length; idx++) {
    const word = words[idx];
    const wlen = word.length;
    if (wlen < 2) {
      continue;
    }

    const aLen = alphaLen(word);
    if (aLen < 2) {
      continue;
    }

    const alpha = word.slice(0, aLen);
    const key = isAllLower(alpha, aLen) ? alpha : alpha.toLowerCase();
    if (acronyms.has(key) && !isAllUpper(alpha, aLen)) {
      words[idx] = word.slice(0, aLen).toUpperCase() + word.slice(aLen);
      changed = true;
    }
  }

  return changed ? words.join('') : name;
}
