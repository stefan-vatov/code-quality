/** @internal Source scanning utilities for Effect lint rules. */
import { CHAR_CLASS, CLS_DIGIT, CLS_LOWER, CLS_UNDER, CLS_UPPER } from './char-class';

const regexPrefixChars = new Set(['(', '[', '{', '=', ':', ',', ';', '!', '?', '&', '|']);
const regexPrefixWords = new Set(['case', 'delete', 'return', 'throw', 'typeof', 'void', 'yield']);
const STRIP_CACHE_MAX = 256;
const codeOnlyCache = new Map<string, string>();
const IDENTIFIER_MASK = CLS_UPPER | CLS_LOWER | CLS_DIGIT | CLS_UNDER;
const CHAR_CODE_SPACE = 32;
const CHAR_CODE_TAB = 9;
const CHAR_CODE_NEWLINE = 10;
const CHAR_CODE_CARRIAGE_RETURN = 13;
const CHAR_CODE_VERTICAL_TAB = 11;
const CHAR_CODE_FORM_FEED = 12;
const CHAR_CODE_DOLLAR = 36;

const isWhitespaceCode = (code: number): boolean =>
  code === CHAR_CODE_SPACE ||
  code === CHAR_CODE_TAB ||
  code === CHAR_CODE_NEWLINE ||
  code === CHAR_CODE_CARRIAGE_RETURN ||
  code === CHAR_CODE_VERTICAL_TAB ||
  code === CHAR_CODE_FORM_FEED;

const appendNewlineOrBlank = (output: string, char: string): string => {
  if (char === '\n') {
    return output + char;
  }
  return `${output} `;
};

const appendPreservedOrBlank = (output: string, shouldPreserve: boolean, char: string): string => {
  if (shouldPreserve) {
    return output + char;
  }
  return `${output} `;
};

interface StripState {
  index: number;
  isBlockComment: boolean;
  isEscaped: boolean;
  isLineComment: boolean;
  quote: string;
  stripped: string;
  templateExpressionDepth: number;
}

const lineCommentStep = (state: StripState, char: string): StripState => {
  if (char === '\n') {
    return {
      ...state,
      isLineComment: false,
      stripped: state.stripped + char,
    };
  }
  return {
    ...state,
    stripped: `${state.stripped} `,
  };
};

const blockCommentStep = (
  state: StripState,
  char: string,
  nextChar: string | undefined,
): StripState => {
  if (char === '*' && nextChar === '/') {
    return {
      ...state,
      index: state.index + 1,
      isBlockComment: false,
      stripped: `${state.stripped}  `,
    };
  }
  return {
    ...state,
    stripped: appendNewlineOrBlank(state.stripped, char),
  };
};

const templateInterpolationStartStep = (state: StripState): StripState => ({
  ...state,
  index: state.index + 1,
  quote: '',
  stripped: `${state.stripped}  `,
  templateExpressionDepth: state.templateExpressionDepth + 1,
});

const quotedStep = (state: StripState, char: string, nextChar: string | undefined): StripState => {
  const shouldPreserve = char === '\n';
  if (state.quote === '`' && char === '$' && nextChar === '{' && !state.isEscaped) {
    return templateInterpolationStartStep(state);
  }
  if (state.isEscaped) {
    return {
      ...state,
      isEscaped: false,
      stripped: appendNewlineOrBlank(state.stripped, char),
    };
  }
  if (char === '\\') {
    return {
      ...state,
      isEscaped: true,
      stripped: appendNewlineOrBlank(state.stripped, char),
    };
  }
  if (char === state.quote) {
    return {
      ...state,
      quote: '',
      stripped: state.stripped + char,
    };
  }
  return {
    ...state,
    stripped: appendPreservedOrBlank(state.stripped, shouldPreserve || char === state.quote, char),
  };
};

const templateBraceStep = (state: StripState, char: string): StripState | undefined => {
  if (state.templateExpressionDepth <= 0) {
    return undefined;
  }
  if (char === '{') {
    return {
      ...state,
      stripped: state.stripped + char,
      templateExpressionDepth: state.templateExpressionDepth + 1,
    };
  }
  if (char !== '}') {
    return undefined;
  }

  const templateExpressionDepth = state.templateExpressionDepth - 1;
  if (templateExpressionDepth === 0) {
    return {
      ...state,
      quote: '`',
      stripped: `${state.stripped} `,
      templateExpressionDepth,
    };
  }
  return {
    ...state,
    stripped: state.stripped + char,
    templateExpressionDepth,
  };
};

const codeStep = (
  source: string,
  state: StripState,
  char: string,
  nextChar: string | undefined,
): StripState => {
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
      stripped: state.stripped + ' '.repeat(endIndex - state.index + 1),
    };
  }
  if (char === '"' || char === "'" || char === '`') {
    return { ...state, quote: char, stripped: state.stripped + char };
  }
  return { ...state, stripped: state.stripped + char };
};

const stripCodeOnlyStep = (source: string, state: StripState): StripState => {
  const char = source[state.index];
  const nextChar = source[state.index + 1];
  if (state.isLineComment) {
    return lineCommentStep(state, char);
  }
  if (state.isBlockComment) {
    return blockCommentStep(state, char, nextChar);
  }
  if (state.quote) {
    return quotedStep(state, char, nextChar);
  }
  return templateBraceStep(state, char) ?? codeStep(source, state, char, nextChar);
};

const initialStripState = (): StripState => ({
  index: 0,
  isBlockComment: false,
  isEscaped: false,
  isLineComment: false,
  quote: '',
  stripped: '',
  templateExpressionDepth: 0,
});

const isASCIIIdentifierChar = (source: string, index: number): boolean => {
  const code = source.charCodeAt(index);
  return (
    code === CHAR_CODE_DOLLAR ||
    (code < CHAR_CLASS.length && (CHAR_CLASS[code] & IDENTIFIER_MASK) !== 0)
  );
};

const isASCIILetter = (source: string, index: number): boolean => {
  const code = source.charCodeAt(index);
  return code < CHAR_CLASS.length && (CHAR_CLASS[code] & (CLS_UPPER | CLS_LOWER)) !== 0;
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

const cached = (cache: Map<string, string>, source: string): string | undefined =>
  cache.get(source);

const cacheResult = (cache: Map<string, string>, source: string, value: string): string => {
  if (cache.size >= STRIP_CACHE_MAX) {
    const firstKey = cache.keys().next().value;
    if (firstKey !== undefined) {
      cache.delete(firstKey);
    }
  }
  cache.set(source, value);
  return value;
};

const previousSignificantIndex = (source: string, index: number): number => {
  for (let cursor = index - 1; cursor >= 0; cursor--) {
    if (!isWhitespaceCode(source.charCodeAt(cursor))) {
      return cursor;
    }
  }

  return -1;
};

const wordBefore = (source: string, index: number): string => {
  const endIndex = previousSignificantIndex(source, index);
  if (endIndex === -1 || !isASCIIIdentifierChar(source, endIndex)) {
    return '';
  }

  let startIndex = endIndex;
  while (startIndex > 0 && isASCIIIdentifierChar(source, startIndex - 1)) {
    startIndex--;
  }

  return source.slice(startIndex, endIndex + 1);
};

/** Internal helper exported for package-local composition.
 *
 * @internal
 */
export const isREGEXLiteralStart = (source: string, index: number): boolean => {
  if (source[index] !== '/' || source[index + 1] === '/' || source[index + 1] === '*') {
    return false;
  }

  const previousIndex = previousSignificantIndex(source, index);
  if (previousIndex === -1) {
    return true;
  }

  return (
    regexPrefixChars.has(source[previousIndex]) || regexPrefixWords.has(wordBefore(source, index))
  );
};

const regexFlagsEndIndex = (source: string, index: number): number => {
  let flagsEndIndex = index;
  while (isASCIILetter(source, flagsEndIndex + 1)) {
    flagsEndIndex++;
  }
  return flagsEndIndex;
};

const scanREGEXDelimiter = (
  source: string,
  index: number,
  isCharacterClass: boolean,
): { endIndex?: number; isCharacterClass: boolean; isEscaped: boolean } | undefined => {
  const char = source[index];
  if (char === '\n') {
    return { endIndex: -1, isCharacterClass, isEscaped: false };
  }
  if (char === '/' && !isCharacterClass) {
    return { endIndex: regexFlagsEndIndex(source, index), isCharacterClass, isEscaped: false };
  }
  return undefined;
};

const scanREGEXCharacterClass = (
  char: string,
  isCharacterClass: boolean,
): { isCharacterClass: boolean; isEscaped: boolean } => {
  if (char === '[') {
    return { isCharacterClass: true, isEscaped: false };
  }
  if (char === ']') {
    return { isCharacterClass: false, isEscaped: false };
  }
  return { isCharacterClass, isEscaped: false };
};

const scanREGEXLiteralChar = (
  source: string,
  index: number,
  isEscaped: boolean,
  isCharacterClass: boolean,
): { endIndex?: number; isCharacterClass: boolean; isEscaped: boolean } => {
  const char = source[index];
  if (isEscaped) {
    return { isCharacterClass, isEscaped: false };
  }
  if (char === '\\') {
    return { isCharacterClass, isEscaped: true };
  }
  const delimiter = scanREGEXDelimiter(source, index, isCharacterClass);
  if (delimiter) {
    return delimiter;
  }
  return scanREGEXCharacterClass(char, isCharacterClass);
};

/** Internal helper exported for package-local composition.
 *
 * @internal
 */
export const findREGEXLiteralEnd = (source: string, startIndex: number): number => {
  let isEscaped = false;
  let isCharacterClass = false;

  for (let index = startIndex + 1; index < source.length; index++) {
    const result = scanREGEXLiteralChar(source, index, isEscaped, isCharacterClass);
    if (result.endIndex === -1) {
      return startIndex;
    }
    if (result.endIndex !== undefined) {
      return result.endIndex;
    }
    ({ isCharacterClass, isEscaped } = result);
  }

  return startIndex;
};

const skipLineCommentIndex = (source: string, index: number): number => {
  const newlineIndex = source.indexOf('\n', index + 2);
  if (newlineIndex === -1) {
    return source.length;
  }
  return newlineIndex;
};

const skipBlockCommentIndex = (source: string, index: number): number => {
  const commentEnd = source.indexOf('*/', index + 2);
  if (commentEnd === -1) {
    return source.length;
  }
  return commentEnd + 1;
};

const skipNonCodeIndex = (source: string, index: number): number | undefined => {
  const char = source[index];
  const nextChar = source[index + 1];
  if (char === '/' && nextChar === '/') {
    return skipLineCommentIndex(source, index);
  }
  if (char === '/' && nextChar === '*') {
    return skipBlockCommentIndex(source, index);
  }
  if (isREGEXLiteralStart(source, index)) {
    return findREGEXLiteralEnd(source, index);
  }
  return undefined;
};

const quoteOrNonCodeScan = (
  source: string,
  index: number,
  quoteState: QuoteState,
): { index: number; quoteState: QuoteState } | undefined => {
  const char = source[index];
  if (quoteState.quote) {
    return { index, quoteState: nextQuoteState(quoteState, char) };
  }
  const quote = quoteStart(char);
  if (quote) {
    return { index, quoteState: { isEscaped: false, quote } };
  }
  const nonCodeIndex = skipNonCodeIndex(source, index);
  if (nonCodeIndex !== undefined) {
    return { index: nonCodeIndex, quoteState };
  }
  return undefined;
};

const nextBalancedCallScan = (
  source: string,
  index: number,
  depth: number,
  quoteState: QuoteState,
): { depth: number; index: number; isEnd: boolean; quoteState: QuoteState } => {
  const quoteOrNonCode = quoteOrNonCodeScan(source, index, quoteState);
  if (quoteOrNonCode) {
    return { ...quoteOrNonCode, depth, isEnd: false };
  }
  const char = source[index];
  if (char === '(') {
    return { depth: depth + 1, index, isEnd: false, quoteState };
  }
  if (char !== ')') {
    return { depth, index, isEnd: false, quoteState };
  }
  return { depth: depth - 1, index, isEnd: depth - 1 === 0, quoteState };
};

/** Internal helper exported for package-local composition.
 *
 * @internal
 */
export const findBalancedCallEnd = (source: string, openParenIndex: number): number => {
  let depth = 0;
  let quoteState = { isEscaped: false, quote: '' };

  for (let index = openParenIndex; index < source.length; index++) {
    const next = nextBalancedCallScan(source, index, depth, quoteState);
    if (next.isEnd) {
      return index;
    }
    ({ depth, index, quoteState } = next);
  }

  return source.length - 1;
};

const nextBraceScan = (
  source: string,
  index: number,
  depth: number,
  quoteState: QuoteState,
): { depth: number; index: number; isEnd: boolean; quoteState: QuoteState } => {
  const quoteOrNonCode = quoteOrNonCodeScan(source, index, quoteState);
  if (quoteOrNonCode) {
    return { ...quoteOrNonCode, depth, isEnd: false };
  }
  const char = source[index];
  if (char === '{') {
    return { depth: depth + 1, index, isEnd: false, quoteState };
  }
  if (char !== '}') {
    return { depth, index, isEnd: false, quoteState };
  }
  return { depth: depth - 1, index, isEnd: depth - 1 === 0, quoteState };
};

/** Internal helper exported for package-local composition.
 *
 * @internal
 */
export const stripCommentsAndStrings = (source: string): string => {
  const cachedValue = cached(codeOnlyCache, source);
  if (cachedValue !== undefined) {
    return cachedValue;
  }

  let state = initialStripState();
  while (state.index < source.length) {
    const stepped = stripCodeOnlyStep(source, state);
    state = { ...stepped, index: stepped.index + 1 };
  }

  return cacheResult(codeOnlyCache, source, state.stripped);
};

/** Internal helper exported for package-local composition.
 *
 * @internal
 */
export const findMatchingBrace = (source: string, openIndex: number): number => {
  let depth = 0;
  let quoteState = { isEscaped: false, quote: '' };

  for (let index = openIndex; index < source.length; index++) {
    const next = nextBraceScan(source, index, depth, quoteState);
    if (next.isEnd) {
      return index;
    }
    ({ depth, index, quoteState } = next);
  }

  return -1;
};
