/* -------------------------------------------------------------------------- */
/* Acronym casing helpers for the explicit opt-in rename codemod.             */
/*                                                                            */
/* This module intentionally lives outside the Oxlint plugin.  Acronym casing */
/* is a migration convention, not a reliable correctness signal, so it must   */
/* never participate in a normal lint run.                                    */
/* -------------------------------------------------------------------------- */
import acronyms from './acronyms';

const DIGIT_0 = 48;
const DIGIT_9 = 57;
const UPPER_A = 65;
const UPPER_Z = 90;
const LOWER_A = 97;
const LOWER_Z = 122;

const isUp = (code: number): boolean => code >= UPPER_A && code <= UPPER_Z;
const isLo = (code: number): boolean => code >= LOWER_A && code <= LOWER_Z;
const isDigitCode = (code: number): boolean => code >= DIGIT_0 && code <= DIGIT_9;

interface SplitState {
  prevUpper: boolean;
  prevUpperCount: number;
  wordStart: number;
}

const consumeUpperCharacter = (
  name: string,
  index: number,
  state: SplitState,
  words: string[],
): void => {
  if (state.prevUpper) {
    state.prevUpperCount += 1;
  } else {
    words.push(name.slice(state.wordStart, index));
    state.wordStart = index;
    state.prevUpperCount = 1;
  }
  state.prevUpper = true;
};

const consumeNonUpperCharacter = (
  name: string,
  index: number,
  state: SplitState,
  words: string[],
): void => {
  if (state.prevUpper && state.prevUpperCount >= 2) {
    words.push(name.slice(state.wordStart, index - 1));
    state.wordStart = index - 1;
    state.prevUpperCount = 0;
  }
  state.prevUpper = false;
};

const splitMixedCase = (name: string): string[] => {
  if (name.length === 0) {
    return [];
  }

  const words: string[] = [];
  const state: SplitState = {
    prevUpper: isUp(name.charCodeAt(0)),
    prevUpperCount: isUp(name.charCodeAt(0)) ? 1 : 0,
    wordStart: 0,
  };

  for (let index = 1; index < name.length; index += 1) {
    if (isUp(name.charCodeAt(index))) {
      consumeUpperCharacter(name, index, state, words);
    } else {
      consumeNonUpperCharacter(name, index, state, words);
    }
  }
  words.push(name.slice(state.wordStart));
  return words;
};

const isAllUpper = (value: string): boolean => {
  for (let index = 0; index < value.length; index += 1) {
    if (!isUp(value.charCodeAt(index))) {
      return false;
    }
  }
  return true;
};

const isAllLower = (value: string): boolean => {
  for (let index = 0; index < value.length; index += 1) {
    if (!isLo(value.charCodeAt(index))) {
      return false;
    }
  }
  return true;
};

const alphaLength = (word: string): number => {
  let end = word.length;
  while (end > 0 && isDigitCode(word.charCodeAt(end - 1))) {
    end -= 1;
  }
  return end;
};

const acronymKey = (alpha: string): string => (isAllLower(alpha) ? alpha : alpha.toLowerCase());

const hasMisCasedAcronym = (word: string): boolean => {
  if (word.length < 2) {
    return false;
  }

  const alphaLengthValue = alphaLength(word);
  if (alphaLengthValue < 2) {
    return false;
  }

  const alpha = word.slice(0, alphaLengthValue);
  return acronyms.has(acronymKey(alpha)) && !isAllUpper(alpha);
};

const hasMixedCase = (name: string): boolean => {
  let hasLower = false;
  let hasUpper = false;
  for (let index = 0; index < name.length; index += 1) {
    const code = name.charCodeAt(index);
    hasUpper ||= isUp(code);
    hasLower ||= isLo(code);
    if (hasLower && hasUpper) {
      return true;
    }
  }
  return false;
};

const isLeadingLowerWord = (word: string, index: number): boolean =>
  index === 0 && isAllLower(word);

const fixedAcronymWord = (word: string, index: number): string => {
  const alphaLengthValue = alphaLength(word);
  if (word.length < 2 || isLeadingLowerWord(word, index) || alphaLengthValue < 2) {
    return word;
  }

  const alpha = word.slice(0, alphaLengthValue);
  if (!acronyms.has(acronymKey(alpha)) || isAllUpper(alpha)) {
    return word;
  }
  return alpha.toUpperCase() + word.slice(alphaLengthValue);
};

const collectAcronymViolations = (words: readonly string[]): string[] => {
  const violations: string[] = [];
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index];
    if (!isLeadingLowerWord(word, index) && hasMisCasedAcronym(word)) {
      violations.push(word);
    }
  }
  return violations;
};

/** Return mis-cased acronym words in an identifier. */
export default function findMisCasedAcronyms(name: string): string[] {
  if (!hasMixedCase(name)) {
    return [];
  }
  return collectAcronymViolations(splitMixedCase(name));
}

/** Return an identifier with recognized acronym segments upper-cased. */
export const fixAcronymCase = (name: string): string => {
  if (!hasMixedCase(name)) {
    return name;
  }

  const words = splitMixedCase(name);
  let fixedWords: string[] | undefined;
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index];
    const fixedWord = fixedAcronymWord(word, index);
    if (fixedWord !== word) {
      fixedWords ??= words.slice(0, index);
      fixedWords.push(fixedWord);
    } else if (fixedWords !== undefined) {
      fixedWords.push(word);
    }
  }
  return fixedWords === undefined ? name : fixedWords.join('');
};
