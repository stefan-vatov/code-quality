/* -------------------------------------------------------------------------- */
/*      Allocation-free lexical primitives for source comment scanning.       */
/* -------------------------------------------------------------------------- */
import { CHAR_CLASS, CLS_DIGIT, CLS_LOWER, CLS_UNDER, CLS_UPPER } from './char-class';

/**
 * Records exact source and body boundaries for a lexically scanned comment.
 */
export interface ScannedComment {
  bodyEnd: number;
  bodyStart: number;
  end: number;
  start: number;
  type: 'Block' | 'Line';
}

/**
 * Consumes one lexically scanned source comment.
 */
export type CommentConsumer = (comment: ScannedComment) => void;

/**
 * ASCII code point for a backslash.
 */
export const BACKSLASH = 92;
/**
 * ASCII code point for a backtick.
 */
export const BACKTICK = 96;
/**
 * ASCII code point for a closing brace.
 */
export const CLOSE_BRACE = 125;
/**
 * ASCII code point for a closing bracket.
 */
export const CLOSE_BRACKET = 93;
/**
 * ASCII code point for a closing parenthesis.
 */
export const CLOSE_PARENTHESIS = 41;
/**
 * ASCII code point for a dollar sign.
 */
export const DOLLAR = 36;
/**
 * ASCII code point for a double quote.
 */
export const DOUBLE_QUOTE = 34;
/**
 * ASCII code point for an equals sign.
 */
export const EQUALS = 61;
/**
 * ASCII code point for a greater-than sign.
 */
export const GREATER_THAN = 62;
/**
 * ASCII code point for a less-than sign.
 */
export const LESS_THAN = 60;
/**
 * ASCII code point for a minus sign.
 */
export const MINUS = 45;
/**
 * ASCII code point for an opening brace.
 */
export const OPEN_BRACE = 123;
/**
 * ASCII code point for an opening bracket.
 */
export const OPEN_BRACKET = 91;
/**
 * ASCII code point for an opening parenthesis.
 */
export const OPEN_PARENTHESIS = 40;
/**
 * ASCII code point for a plus sign.
 */
export const PLUS = 43;
/**
 * ASCII code point for a semicolon.
 */
export const SEMICOLON = 59;
/**
 * ASCII code point for a single quote.
 */
export const SINGLE_QUOTE = 39;
/**
 * ASCII code point for a slash.
 */
export const SLASH = 47;
/**
 * ASCII code point for an asterisk.
 */
export const STAR = 42;

const CARRIAGE_RETURN = 13;
const DOLLAR_CODE = 36;
const EXCLAMATION = 33;
const FORM_FEED = 12;
const HASH = 35;
const LINE_FEED = 10;
const LINE_SEPARATOR = 8232;
const PARAGRAPH_SEPARATOR = 8233;
const SPACE = 32;
const TAB = 9;
const VERTICAL_TAB = 11;
const IDENTIFIER_CLASS = CLS_UPPER | CLS_LOWER | CLS_DIGIT | CLS_UNDER;
const IDENTIFIER_START_CLASS = CLS_UPPER | CLS_LOWER | CLS_UNDER;

/**
 * Checks all four ECMAScript line-terminator code points without allocating.
 */
export const isECMAScriptLineEnding = (code: number): boolean =>
  code === LINE_FEED ||
  code === CARRIAGE_RETURN ||
  code === LINE_SEPARATOR ||
  code === PARAGRAPH_SEPARATOR;

/**
 * Advances across one ECMAScript line terminator while preserving CRLF as a pair.
 */
export const indexAfterLineEnding = (source: string, end: number): number => {
  const code = source.charCodeAt(end);
  if (code === CARRIAGE_RETURN && source.charCodeAt(end + 1) === LINE_FEED) {
    return end + 2;
  }
  if (isECMAScriptLineEnding(code)) {
    return end + 1;
  }
  return end;
};

/**
 * Determines whether a code point can begin an ECMAScript identifier.
 */
export const isIdentifierStart = (code: number): boolean =>
  (CHAR_CLASS[code] & IDENTIFIER_START_CLASS) !== 0 ||
  code === DOLLAR_CODE ||
  code >= CHAR_CLASS.length;

/**
 * Determines whether a code point can continue an ECMAScript identifier.
 */
export const isIdentifierPart = (code: number): boolean =>
  (CHAR_CLASS[code] & IDENTIFIER_CLASS) !== 0 || code === DOLLAR_CODE || code >= CHAR_CLASS.length;

/**
 * Determines whether a code point is source trivia recognized by the scanner.
 */
export const isTrivia = (code: number): boolean =>
  code === SPACE ||
  code === TAB ||
  code === VERTICAL_TAB ||
  code === FORM_FEED ||
  isECMAScriptLineEnding(code);

/**
 * Finds the first source index after an identifier token.
 */
export const indexAfterIdentifier = (source: string, start: number): number => {
  let index = start + 1;
  const sourceLength = source.length;
  while (index < sourceLength && isIdentifierPart(source.charCodeAt(index))) {
    index += 1;
  }
  return index;
};

/**
 * Checks whether one source segment exactly matches a listed word.
 */
export const isListedWord = (
  source: string,
  start: number,
  end: number,
  words: readonly string[],
): boolean => {
  for (const word of words) {
    if (end - start === word.length && source.startsWith(word, start)) {
      return true;
    }
  }
  return false;
};

/**
 * Finds the first source index after a quoted string, including its closing quote.
 */
export const indexAfterQuotedString = (source: string, start: number, quote: number): number => {
  let index = start + 1;
  const sourceLength = source.length;
  while (index < sourceLength) {
    const code = source.charCodeAt(index);
    if (code === BACKSLASH) {
      index += 2;
    } else if (code === quote) {
      return index + 1;
    } else {
      index += 1;
    }
  }
  return sourceLength;
};

/**
 * Finds the first source index after a regular-expression literal and its flags.
 */
export const indexAfterREGEX = (source: string, start: number): number => {
  let isInCharacterClass = false;
  for (let index = start + 1; index < source.length; index += 1) {
    const code = source.charCodeAt(index);
    if (code === BACKSLASH) {
      index += 1;
    } else if (isECMAScriptLineEnding(code)) {
      return start + 1;
    } else if (code === SLASH && !isInCharacterClass) {
      return indexAfterIdentifier(source, index);
    } else if (code === OPEN_BRACKET) {
      isInCharacterClass = true;
    } else if (code === CLOSE_BRACKET) {
      isInCharacterClass = false;
    }
  }
  return start + 1;
};

/**
 * Scans a line comment, consumes its boundaries, and returns the next source index.
 */
export const scanLineComment = (
  source: string,
  start: number,
  consumeComment: CommentConsumer,
): number => {
  let bodyEnd = start + 2;
  const sourceLength = source.length;
  while (bodyEnd < sourceLength && !isECMAScriptLineEnding(source.charCodeAt(bodyEnd))) {
    bodyEnd += 1;
  }
  consumeComment({ bodyEnd, bodyStart: start + 2, end: bodyEnd, start, type: 'Line' });
  return indexAfterLineEnding(source, bodyEnd);
};

/**
 * Scans a block comment, consumes its boundaries, and returns the next source index.
 */
export const scanBlockComment = (
  source: string,
  start: number,
  consumeComment: CommentConsumer,
): number => {
  const bodyStart = start + 2;
  const bodyEnd = source.indexOf('*/', bodyStart);
  if (bodyEnd === -1) {
    consumeComment({
      bodyEnd: source.length,
      bodyStart,
      end: source.length,
      start,
      type: 'Block',
    });
    return source.length;
  }
  const end = bodyEnd + 2;
  consumeComment({ bodyEnd, bodyStart, end, start, type: 'Block' });
  return end;
};

/**
 * Finds the first source index after an optional hashbang line.
 */
export const indexAfterHashbang = (source: string): number => {
  if (source.charCodeAt(0) !== HASH || source.charCodeAt(1) !== EXCLAMATION) {
    return 0;
  }
  let index = 2;
  while (index < source.length && !isECMAScriptLineEnding(source.charCodeAt(index))) {
    index += 1;
  }
  return indexAfterLineEnding(source, index);
};
