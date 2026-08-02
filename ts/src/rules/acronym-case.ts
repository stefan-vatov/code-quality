/* -------------------------------------------------------------------------- */
/*         Acronym casing helpers for custom Oxlint identifier rules.         */
/* -------------------------------------------------------------------------- */
import { CHAR_CLASS, CLS_LOWER, CLS_UPPER } from './char-class';
import acronyms from './acronyms';
import { createWeightedCache } from './source-cache';

// Magic number constants
const DIGIT_0 = 48;
const DIGIT_9 = 57;
const CACHE_MAX = 4096;
const BYTES_PER_MEBIBYTE = 1_048_576;
const CACHE_MAX_MEBIBYTES = 5;
const CACHE_MAX_WEIGHT = CACHE_MAX_MEBIBYTES * BYTES_PER_MEBIBYTE;
const UTF16_CODE_UNIT_BYTES = 2;
const CACHE_ENTRY_BYTES = 128;
const ARRAY_BASE_BYTES = 128;

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

const consumeUpperCharacter = (
  name: string,
  idx: number,
  state: SplitState,
  words: string[],
): void => {
  const nextState = state;
  if (state.prevUpper) {
    nextState.prevUpperCount += 1;
  } else {
    words.push(name.slice(state.wordStart, idx));
    nextState.wordStart = idx;
    nextState.prevUpperCount = 1;
  }
  nextState.prevUpper = true;
};

const consumeNonUpperCharacter = (
  name: string,
  idx: number,
  state: SplitState,
  words: string[],
): void => {
  const nextState = state;
  if (state.prevUpper && state.prevUpperCount >= 2) {
    words.push(name.slice(state.wordStart, idx - 1));
    nextState.wordStart = idx - 1;
    nextState.prevUpperCount = 0;
  }
  nextState.prevUpper = false;
};

const scanMixedCase = (name: string, len: number, state: SplitState, words: string[]): void => {
  for (let idx = 1; idx < len; idx += 1) {
    if (isUp(name.charCodeAt(idx))) {
      consumeUpperCharacter(name, idx, state, words);
    } else {
      consumeNonUpperCharacter(name, idx, state, words);
    }
  }
  words.push(name.slice(state.wordStart));
};

/**
 * Split a mixedCase identifier into word segments (character-class accelerated).
 */
const splitMixedCase = (name: string): string[] => {
  const len = name.length;
  if (len === 0) {
    return [];
  }

  const words: string[] = [];
  const prevUpper = isUp(name.charCodeAt(0));
  const state: SplitState = {
    prevUpper,
    prevUpperCount: initialUpperCount(prevUpper),
    wordStart: 0,
  };

  scanMixedCase(name, len, state, words);
  return words;
};

/**
 * Check if entire string is all uppercase A-Z.
 */
const isAllUpper = (str: string, len: number): boolean => {
  for (let idx = 0; idx < len; idx += 1) {
    if (!isUp(str.charCodeAt(idx))) {
      return false;
    }
  }
  return true;
};

/**
 * Check if entire string is all lowercase a-z.
 */
const isAllLower = (str: string, len: number): boolean => {
  for (let idx = 0; idx < len; idx += 1) {
    if (!isLo(str.charCodeAt(idx))) {
      return false;
    }
  }
  return true;
};

/**
 * Strip trailing digits, return alpha length (inlined into callers).
 */
const isDigitCode = (code: number): boolean => code >= DIGIT_0 && code <= DIGIT_9;

const alphaLenFrom = (word: string, end: number): number => {
  let alphaEnd = end;
  while (alphaEnd > 0 && isDigitCode(word.charCodeAt(alphaEnd - 1))) {
    alphaEnd -= 1;
  }
  return alphaEnd;
};

const alphaLen = (word: string): number => alphaLenFrom(word, word.length);

const acronymKey = (alpha: string, len: number): string => {
  if (isAllLower(alpha, len)) {
    return alpha;
  }
  return alpha.toLowerCase();
};

/**
 * Check if a word is a mis-cased acronym.
 */
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
  const key = acronymKey(alpha, aLen);
  return acronyms.has(key) && !isAllUpper(alpha, aLen);
};

const hasMixedCase = (name: string): boolean => {
  const len = name.length;
  let hasLower = false;
  let hasUpper = false;

  for (let idx = 0; idx < len; idx += 1) {
    const code = name.charCodeAt(idx);
    hasUpper ||= isUp(code);
    hasLower ||= isLo(code);
    if (hasLower && hasUpper) {
      return true;
    }
  }
  return false;
};

const isLeadingLowerWord = (word: string, index: number): boolean =>
  index === 0 && isAllLower(word, word.length);

const collectAcronymViolations = (words: readonly string[]): string[] => {
  const violations: string[] = [];
  for (let idx = 0; idx < words.length; idx += 1) {
    const word = words[idx];
    if (!isLeadingLowerWord(word, idx) && hasMisCasedAcronym(word)) {
      violations.push(word);
    }
  }
  return violations;
};

type ViolationCache = ReturnType<typeof createWeightedCache<string, string[]>>;

const violationCache: ViolationCache = createWeightedCache({
  maxEntries: CACHE_MAX,
  maxWeight: CACHE_MAX_WEIGHT,
});

const UTF16Weight = (value: string): number => value.length * UTF16_CODE_UNIT_BYTES;
const weightForUTF16 = UTF16Weight;

const violationCacheWeight = (key: string, value: readonly string[]): number => {
  let weight = CACHE_ENTRY_BYTES + ARRAY_BASE_BYTES + weightForUTF16(key);
  for (const violation of value) {
    weight += CACHE_ENTRY_BYTES + weightForUTF16(violation);
  }
  return weight;
};

const addToCache = (key: string, value: string[]): string[] =>
  violationCache.set(key, value, violationCacheWeight(key, value));

const addEmptyResult = (name: string): string[] => addToCache(name, []);

/**
 * Check if an identifier contains mis-cased acronyms. FIFO-cached.
 */
export default function findMisCasedAcronyms(name: string): string[] {
  const cached = violationCache.get(name);
  if (cached !== undefined) {
    return cached;
  }
  if (!hasMixedCase(name)) {
    return addEmptyResult(name);
  }

  const words = splitMixedCase(name);
  return addToCache(name, collectAcronymViolations(words));
}

const fixedAcronymWord = (word: string, index: number): string => {
  const aLen = alphaLen(word);
  if (word.length < 2 || isLeadingLowerWord(word, index) || aLen < 2) {
    return word;
  }

  const alpha = word.slice(0, aLen);
  const key = acronymKey(alpha, aLen);
  if (!acronyms.has(key) || isAllUpper(alpha, aLen)) {
    return word;
  }
  return alpha.toUpperCase() + word.slice(aLen);
};

const fixedAcronymWords = (words: readonly string[]): string[] | undefined => {
  let fixedWords: string[] | undefined = undefined;
  for (let idx = 0; idx < words.length; idx += 1) {
    const word = words[idx];
    const fixedWord = fixedAcronymWord(word, idx);
    if (fixedWord !== word) {
      fixedWords ??= words.slice(0, idx);
      fixedWords.push(fixedWord);
    } else if (fixedWords !== undefined) {
      fixedWords.push(word);
    }
  }
  return fixedWords;
};

/**
 * Fix mis-cased acronyms in an identifier.
 */
export const fixAcronymCase = (name: string): string => {
  if (!hasMixedCase(name)) {
    return name;
  }
  const fixedWords = fixedAcronymWords(splitMixedCase(name));
  if (fixedWords === undefined) {
    return name;
  }
  return fixedWords.join('');
};
