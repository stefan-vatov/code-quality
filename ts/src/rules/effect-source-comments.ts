/** @internal Comment stripping helper for source-backed Effect lint rules. */
import { CHAR_CLASS, CLS_DIGIT, CLS_LOWER, CLS_UNDER, CLS_UPPER } from './char-class';

const regexPrefixChars = new Set(['(', '[', '{', '=', ':', ',', ';', '!', '?', '&', '|']);
const regexPrefixWords = new Set(['case', 'delete', 'return', 'throw', 'typeof', 'void', 'yield']);
const COMMENT_CACHE_MAX = 256;
const commentCache = new Map<string, string>();
const IDENTIFIER_MASK = CLS_UPPER | CLS_LOWER | CLS_DIGIT | CLS_UNDER;
const CHAR_CODE_SPACE = 32;
const CHAR_CODE_TAB = 9;
const CHAR_CODE_NEWLINE = 10;
const CHAR_CODE_CARRIAGE_RETURN = 13;
const CHAR_CODE_VERTICAL_TAB = 11;
const CHAR_CODE_FORM_FEED = 12;
const CHAR_CODE_DOLLAR = 36;

const appendNewlineOrBlank = (output: string, char: string): string => {
  if (char === '\n') {
    return output + char;
  }
  return `${output} `;
};

const isWhitespaceCode = (code: number): boolean =>
  code === CHAR_CODE_SPACE ||
  code === CHAR_CODE_TAB ||
  code === CHAR_CODE_NEWLINE ||
  code === CHAR_CODE_CARRIAGE_RETURN ||
  code === CHAR_CODE_VERTICAL_TAB ||
  code === CHAR_CODE_FORM_FEED;

const isASCIIIdentifierChar = (source: string, index: number): boolean => {
  const charCode = source.charCodeAt(index);
  return charCode === CHAR_CODE_DOLLAR || (CHAR_CLASS[charCode] & IDENTIFIER_MASK) !== 0;
};

const isASCIILetter = (source: string, index: number): boolean => {
  const charCode = source.charCodeAt(index);
  return (CHAR_CLASS[charCode] & (CLS_UPPER | CLS_LOWER)) !== 0;
};

interface QuoteState {
  isEscaped: boolean;
  quote: string;
}

const quoteStart = (char: string): string => {
  if (char === '"' || char === "'" || char === '`') {
    return char;
  }
  return '';
};

const nextQuoteState = (state: QuoteState, char: string): QuoteState => {
  if (state.isEscaped) {
    return { ...state, isEscaped: false };
  }
  if (char === '\\') {
    return { ...state, isEscaped: true };
  }
  if (char === state.quote) {
    return { isEscaped: false, quote: '' };
  }
  return state;
};

const cacheResult = (source: string, value: string): string => {
  if (commentCache.size >= COMMENT_CACHE_MAX) {
    const firstKey = commentCache.keys().next().value;
    if (firstKey !== undefined) {
      commentCache.delete(firstKey);
    }
  }
  commentCache.set(source, value);
  return value;
};

const previousSignificantIndex = (source: string, index: number): number => {
  let current = index - 1;
  while (current >= 0 && isWhitespaceCode(source.charCodeAt(current))) {
    current--;
  }
  return current;
};

const wordBefore = (source: string, index: number): string => {
  let start = index;
  while (start > 0 && isASCIILetter(source, start - 1)) {
    start--;
  }
  return source.slice(start, index);
};

const isREGEXPrefixChar = (source: string, index: number): boolean =>
  regexPrefixChars.has(source[index]);

const isREGEXPrefixWord = (source: string, index: number): boolean =>
  isASCIIIdentifierChar(source, index) && regexPrefixWords.has(wordBefore(source, index + 1));

const isREGEXLiteralStart = (source: string, index: number): boolean => {
  if (source[index] !== '/' || source[index + 1] === '/' || source[index + 1] === '*') {
    return false;
  }
  const previousIndex = previousSignificantIndex(source, index);
  if (previousIndex === -1) {
    return true;
  }

  if (isREGEXPrefixChar(source, previousIndex)) {
    return true;
  }
  return isREGEXPrefixWord(source, previousIndex);
};

const regexFlagsEndIndex = (source: string, index: number): number => {
  let endIndex = index;
  while (endIndex + 1 < source.length && isASCIILetter(source, endIndex + 1)) {
    endIndex++;
  }
  return endIndex;
};

const scanREGEXDelimiter = (
  source: string,
  index: number,
  isEscaped: boolean,
  isCharacterClass: boolean,
): { index: number; isEscaped: boolean; isEnd: boolean } | undefined => {
  const char = source[index];
  if (!isEscaped && !isCharacterClass && char === '/') {
    return { index: regexFlagsEndIndex(source, index), isEnd: true, isEscaped: false };
  }
  if (isEscaped) {
    return { index, isEnd: false, isEscaped: false };
  }
  if (char === '\\') {
    return { index, isEnd: false, isEscaped: true };
  }
  return undefined;
};

const scanREGEXCharacterClass = (
  source: string,
  index: number,
  isEscaped: boolean,
  isCharacterClass: boolean,
): boolean => {
  if (isEscaped) {
    return isCharacterClass;
  }
  if (source[index] === '[') {
    return true;
  }
  if (source[index] === ']') {
    return false;
  }
  return isCharacterClass;
};

const findREGEXLiteralEnd = (source: string, startIndex: number): number => {
  let isEscaped = false;
  let isCharacterClass = false;

  for (let index = startIndex + 1; index < source.length; index++) {
    const delimiter = scanREGEXDelimiter(source, index, isEscaped, isCharacterClass);
    if (delimiter?.isEnd) {
      return delimiter.index;
    }
    isEscaped = delimiter?.isEscaped ?? false;
    isCharacterClass = scanREGEXCharacterClass(source, index, isEscaped, isCharacterClass);
  }

  return startIndex;
};

interface StripCommentState {
  index: number;
  isBlockComment: boolean;
  isEscaped: boolean;
  isLineComment: boolean;
  quote: string;
  stripped: string;
}

const lineCommentStripStep = (state: StripCommentState, char: string): StripCommentState => {
  if (char === '\n') {
    return { ...state, isLineComment: false, stripped: state.stripped + char };
  }
  return { ...state, stripped: `${state.stripped} ` };
};

const blockCommentStripStep = (
  state: StripCommentState,
  char: string,
  nextChar: string | undefined,
): StripCommentState => {
  if (char === '*' && nextChar === '/') {
    return {
      ...state,
      index: state.index + 1,
      isBlockComment: false,
      stripped: `${state.stripped}  `,
    };
  }
  return { ...state, stripped: appendNewlineOrBlank(state.stripped, char) };
};

const quotedStripStep = (state: StripCommentState, char: string): StripCommentState => ({
  ...state,
  ...nextQuoteState(state, char),
  stripped: state.stripped + char,
});

const codeStripStep = (
  source: string,
  state: StripCommentState,
  char: string,
  nextChar: string | undefined,
): StripCommentState => {
  if (char === '/' && nextChar === '/') {
    return {
      ...state,
      index: state.index + 1,
      isLineComment: true,
      stripped: `${state.stripped}  `,
    };
  }
  if (char === '/' && nextChar === '*') {
    return {
      ...state,
      index: state.index + 1,
      isBlockComment: true,
      stripped: `${state.stripped}  `,
    };
  }
  if (isREGEXLiteralStart(source, state.index)) {
    const endIndex = findREGEXLiteralEnd(source, state.index);
    return {
      ...state,
      index: endIndex,
      stripped: state.stripped + source.slice(state.index, endIndex + 1),
    };
  }
  return { ...state, quote: quoteStart(char), stripped: state.stripped + char };
};

const stripCommentStep = (source: string, state: StripCommentState): StripCommentState => {
  const char = source[state.index];
  const nextChar = source[state.index + 1];
  if (state.isLineComment) {
    return lineCommentStripStep(state, char);
  }
  if (state.isBlockComment) {
    return blockCommentStripStep(state, char, nextChar);
  }
  if (state.quote) {
    return quotedStripStep(state, char);
  }
  return codeStripStep(source, state, char, nextChar);
};

const initialStripCommentState = (): StripCommentState => ({
  index: 0,
  isBlockComment: false,
  isEscaped: false,
  isLineComment: false,
  quote: '',
  stripped: '',
});

/** Internal helper exported for package-local composition.
 *
 * @internal
 */
export const stripComments = (source: string): string => {
  const cachedValue = commentCache.get(source);
  if (cachedValue !== undefined) {
    return cachedValue;
  }

  let state = initialStripCommentState();
  while (state.index < source.length) {
    const stepped = stripCommentStep(source, state);
    state = { ...stepped, index: stepped.index + 1 };
  }

  return cacheResult(source, state.stripped);
};
