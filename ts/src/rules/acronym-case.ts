/* -------------------------------------------------------------------------- */
/*         Acronym casing helpers for custom Oxlint identifier rules.         */
/* -------------------------------------------------------------------------- */
import { Array, Match, Option, pipe } from 'effect';
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
  words: readonly string[];
}

const initialUpperCount = (prevUpper: boolean): number =>
  Match.value(prevUpper).pipe(
    Match.when(true, (): number => 1),
    Match.orElse((): number => 0),
  );

const upperSplitState = (name: string, idx: number, state: SplitState): SplitState =>
  Match.value(state.prevUpper).pipe(
    Match.when(
      false,
      (): SplitState => ({
        prevUpper: true,
        prevUpperCount: 1,
        wordStart: idx,
        words: pipe(state.words, Array.append(name.slice(state.wordStart, idx))),
      }),
    ),
    Match.orElse(
      (): SplitState => ({
        ...state,
        prevUpper: true,
        prevUpperCount: state.prevUpperCount + 1,
      }),
    ),
  );

const lowerSplitState = (name: string, idx: number, state: SplitState): SplitState =>
  Match.value(state.prevUpper && state.prevUpperCount >= 2).pipe(
    Match.when(
      true,
      (): SplitState => ({
        prevUpper: false,
        prevUpperCount: 0,
        wordStart: idx - 1,
        words: pipe(state.words, Array.append(name.slice(state.wordStart, idx - 1))),
      }),
    ),
    Match.orElse((): SplitState => ({ ...state, prevUpper: false })),
  );

const nextSplitState = (name: string, idx: number, state: SplitState): SplitState =>
  Match.value(isUp(name.charCodeAt(idx))).pipe(
    Match.when(true, (): SplitState => upperSplitState(name, idx, state)),
    Match.orElse((): SplitState => lowerSplitState(name, idx, state)),
  );

const scanIndexes = (startIndex: number, endIndex: number): readonly number[] =>
  Match.value(startIndex).pipe(
    Match.when(
      (value): boolean => value > endIndex,
      () => [],
    ),
    Match.orElse((value): readonly number[] => Array.range(value, endIndex)),
  );

/**
 * Split a mixedCase identifier into word segments (character-class accelerated).
 */
const splitMixedCase = (name: string): string[] => {
  const len = name.length;
  return Match.value(len).pipe(
    Match.when(0, (): string[] => []),
    Match.orElse((): string[] => {
      const startsUpper = isUp(name.charCodeAt(0));
      const state = pipe(
        scanIndexes(1, len - 1),
        Array.reduce(
          {
            prevUpper: startsUpper,
            prevUpperCount: initialUpperCount(startsUpper),
            wordStart: 0,
            words: [],
          } satisfies SplitState,
          (currentState, idx): SplitState => nextSplitState(name, idx, currentState),
        ),
      );
      return pipe(state.words, Array.append(name.slice(state.wordStart)));
    }),
  );
};

/**
 * Check if entire string is all uppercase A-Z.
 */
const isAllUpper = (str: string, len: number): boolean =>
  pipe(
    scanIndexes(0, len - 1),
    Array.every((idx): boolean => isUp(str.charCodeAt(idx))),
  );

/**
 * Check if entire string is all lowercase a-z.
 */
const isAllLower = (str: string, len: number): boolean =>
  pipe(
    scanIndexes(0, len - 1),
    Array.every((idx): boolean => isLo(str.charCodeAt(idx))),
  );

/**
 * Strip trailing digits, return alpha length (inlined into callers).
 */
const isDigitCode = (code: number): boolean => code >= DIGIT_0 && code <= DIGIT_9;

const alphaLenFrom = (word: string, end: number): number =>
  Match.value(end).pipe(
    Match.when(0, (): number => 0),
    Match.when(
      (value): boolean => !isDigitCode(word.charCodeAt(value - 1)),
      (value): number => value,
    ),
    Match.orElse((value): number => alphaLenFrom(word, value - 1)),
  );

const alphaLen = (word: string): number => alphaLenFrom(word, word.length);

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
  const key = Match.value(isAllLower(alpha, aLen)).pipe(
    Match.when(true, (): string => alpha),
    Match.orElse((): string => alpha.toLowerCase()),
  );
  return acronyms.has(key) && !isAllUpper(alpha, aLen);
};

const hasMixedCase = (name: string): boolean =>
  pipe(
    scanIndexes(0, name.length - 1),
    Array.reduce(
      { hasLower: false, hasUpper: false },
      (state, idx): { hasLower: boolean; hasUpper: boolean } => {
        const code = name.charCodeAt(idx);
        return Match.value(code).pipe(
          Match.when(
            (value): boolean => isUp(value),
            (): { hasLower: boolean; hasUpper: boolean } => ({ ...state, hasUpper: true }),
          ),
          Match.when(
            (value): boolean => isLo(value),
            (): { hasLower: boolean; hasUpper: boolean } => ({ ...state, hasLower: true }),
          ),
          Match.orElse((): { hasLower: boolean; hasUpper: boolean } => state),
        );
      },
    ),
    (state): boolean => state.hasUpper && state.hasLower,
  );

const addEmptyResult = (name: string): string[] => {
  const empty: string[] = [];
  addToCache(name, empty);
  return empty;
};

const isLeadingLowerWord = (word: string, index: number): boolean =>
  index === 0 && isAllLower(word, word.length);

const collectAcronymViolations = (words: readonly string[]): string[] =>
  pipe(
    words,
    Array.filter(
      (word, idx): boolean => !isLeadingLowerWord(word, idx) && hasMisCasedAcronym(word),
    ),
  );

// ---- LRU cache ----
const violationCache = new Map<string, string[]>();

const addToCache = (key: string, value: string[]): void => {
  pipe(
    Match.value(violationCache.size),
    Match.when(
      (size): boolean => size >= CACHE_MAX,
      (): void => {
        pipe(
          Option.fromNullable(violationCache.keys().next().value),
          Option.match({
            onNone: (): void => undefined,
            onSome: (first): void => {
              violationCache.delete(first);
            },
          }),
        );
      },
    ),
    Match.orElse((): void => undefined),
  );
  violationCache.set(key, value);
};

/**
 * Check if an identifier contains mis-cased acronyms. LRU-cached.
 */
export default function findMisCasedAcronyms(name: string): string[] {
  const cached = violationCache.get(name);
  return pipe(
    Option.fromNullable(cached),
    Option.match({
      onNone: (): string[] =>
        Match.value(hasMixedCase(name)).pipe(
          Match.when(false, (): string[] => addEmptyResult(name)),
          Match.orElse((): string[] => {
            const words = splitMixedCase(name);
            const violations = collectAcronymViolations(words);
            addToCache(name, violations);
            return violations;
          }),
        ),
      onSome: (value): string[] => value,
    }),
  );
}

const fixedAcronymWord = (word: string, index: number): string => {
  const aLen = alphaLen(word);
  if (word.length < 2 || isLeadingLowerWord(word, index) || aLen < 2) {
    return word;
  }

  const alpha = word.slice(0, aLen);
  const key = Match.value(isAllLower(alpha, aLen)).pipe(
    Match.when(true, (): string => alpha),
    Match.orElse((): string => alpha.toLowerCase()),
  );
  return Match.value(acronyms.has(key) && !isAllUpper(alpha, aLen)).pipe(
    Match.when(true, (): string => word.slice(0, aLen).toUpperCase() + word.slice(aLen)),
    Match.orElse((): string => word),
  );
};

const fixedAcronymWords = (words: readonly string[]): string[] | undefined => {
  const fixedWords = pipe(
    words,
    Array.map((word, idx): string => fixedAcronymWord(word, idx)),
  );
  return Match.value(fixedWords).pipe(
    Match.when(
      (value): boolean =>
        pipe(
          value,
          Array.some((word, idx): boolean => word !== words[idx]),
        ),
      (value): string[] => value,
    ),
    Match.orElse((): undefined => undefined),
  );
};

/**
 * Fix mis-cased acronyms in an identifier.
 */
export const fixAcronymCase = (name: string): string =>
  Match.value(hasMixedCase(name)).pipe(
    Match.when(false, (): string => name),
    Match.orElse((): string => {
      const words = splitMixedCase(name);
      return pipe(
        Option.fromNullable(fixedAcronymWords(words)),
        Option.match({
          onNone: (): string => name,
          onSome: (fixedWords): string => pipe(fixedWords, Array.join('')),
        }),
      );
    }),
  );
