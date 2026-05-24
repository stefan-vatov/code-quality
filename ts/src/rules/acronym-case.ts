/** @internal Acronym casing helpers for custom Oxlint identifier rules. */
import { CHAR_CLASS, CLS_LOWER, CLS_UPPER } from './char-class';
import acronyms from './acronyms';

// Magic number constants
const DIGIT_0 = 48;
const DIGIT_9 = 57;
const CACHE_MAX = 4096;

// Inline helpers — arrow functions for V8 inlining hints
const isUp = (code: number): boolean => (CHAR_CLASS[code] & CLS_UPPER) !== 0;
const isLo = (code: number): boolean => (CHAR_CLASS[code] & CLS_LOWER) !== 0;

interface SplitState {
  prevUpper: boolean;
  prevUpperCount: number;
  wordStart: number;
}

const initialUpperCount = (prevUpper: boolean): number => {
  if (prevUpper) {
    return 1;
  }
  return 0;
};

const upperSplitState = (
  name: string,
  idx: number,
  words: string[],
  state: SplitState,
): SplitState => {
  if (!state.prevUpper) {
    words.push(name.slice(state.wordStart, idx));
    return { prevUpper: true, prevUpperCount: 1, wordStart: idx };
  }
  return { ...state, prevUpper: true, prevUpperCount: state.prevUpperCount + 1 };
};

const lowerSplitState = (
  name: string,
  idx: number,
  words: string[],
  state: SplitState,
): SplitState => {
  if (state.prevUpper && state.prevUpperCount >= 2) {
    words.push(name.slice(state.wordStart, idx - 1));
    return { prevUpper: false, prevUpperCount: 0, wordStart: idx - 1 };
  }
  return { ...state, prevUpper: false };
};

const nextSplitState = (
  name: string,
  idx: number,
  words: string[],
  state: SplitState,
): SplitState => {
  if (isUp(name.charCodeAt(idx))) {
    return upperSplitState(name, idx, words, state);
  }
  return lowerSplitState(name, idx, words, state);
};

/** Split a mixedCase identifier into word segments (character-class accelerated). */
const splitMixedCase = (name: string): string[] => {
  const len = name.length;
  if (len === 0) {
    return [];
  }

  const words: string[] = [];
  let state = {
    prevUpper: isUp(name.charCodeAt(0)),
    prevUpperCount: initialUpperCount(isUp(name.charCodeAt(0))),
    wordStart: 0,
  };

  for (let idx = 1; idx < len; idx++) {
    state = nextSplitState(name, idx, words, state);
  }

  words.push(name.slice(state.wordStart));
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
  const key = ((): string => {
    if (isAllLower(alpha, aLen)) {
      return alpha;
    }
    return alpha.toLowerCase();
  })();
  return acronyms.has(key) && !isAllUpper(alpha, aLen);
};

const hasMixedCase = (name: string): boolean => {
  let hasUpper = false;
  let hasLower = false;
  for (let idx = 0; idx < name.length; idx++) {
    const code = name.charCodeAt(idx);
    if (isUp(code)) {
      hasUpper = true;
    } else if (isLo(code)) {
      hasLower = true;
    }
    if (hasUpper && hasLower) {
      return true;
    }
  }
  return false;
};

const addEmptyResult = (name: string): string[] => {
  const empty: string[] = [];
  addToCache(name, empty);
  return empty;
};

const isLeadingLowerWord = (word: string, index: number): boolean =>
  index === 0 && isAllLower(word, word.length);

const collectAcronymViolations = (words: readonly string[]): string[] => {
  const violations: string[] = [];
  for (let idx = 0; idx < words.length; idx++) {
    const word = words[idx];
    if (!isLeadingLowerWord(word, idx) && hasMisCasedAcronym(word)) {
      violations.push(word);
    }
  }
  return violations;
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
    return cached;
  }

  if (!hasMixedCase(name)) {
    return addEmptyResult(name);
  }

  const words = splitMixedCase(name);
  const violations = collectAcronymViolations(words);
  addToCache(name, violations);
  return violations;
}

const fixedAcronymWord = (word: string, index: number): string => {
  const aLen = alphaLen(word);
  if (word.length < 2 || isLeadingLowerWord(word, index) || aLen < 2) {
    return word;
  }

  const alpha = word.slice(0, aLen);
  const key = ((): string => {
    if (isAllLower(alpha, aLen)) {
      return alpha;
    }
    return alpha.toLowerCase();
  })();
  if (acronyms.has(key) && !isAllUpper(alpha, aLen)) {
    return word.slice(0, aLen).toUpperCase() + word.slice(aLen);
  }
  return word;
};

const fixedAcronymWords = (words: readonly string[]): string[] | undefined => {
  const fixedWords = words.map((word, idx) => fixedAcronymWord(word, idx));
  if (fixedWords.some((word, idx): boolean => word !== words[idx])) {
    return fixedWords;
  }
  return undefined;
};

/** Fix mis-cased acronyms in an identifier. */
export const fixAcronymCase = (name: string): string => {
  if (!hasMixedCase(name)) {
    return name;
  }

  const words = splitMixedCase(name);
  const fixedWords = fixedAcronymWords(words);
  if (fixedWords) {
    return fixedWords.join('');
  }
  return name;
};
