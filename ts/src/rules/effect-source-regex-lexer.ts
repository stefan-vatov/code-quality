/* -------------------------------------------------------------------------- */
/*          Incremental JavaScript lexer for regex source indexing.           */
/* -------------------------------------------------------------------------- */
import { CHAR_CLASS, CLS_DIGIT, CLS_LOWER, CLS_UNDER, CLS_UPPER } from './char-class';
import { findLineTerminatorIndex, isLineTerminatorCode } from './effect-source-line-terminators';
import { REGEXTokenContext } from './effect-source-regex-lexer-context';

type RegexIdentifierKind = Parameters<REGEXTokenContext['consumeIdentifier']>[0];

const newTokenContext = (isStatementStart = true): REGEXTokenContext =>
  new REGEXTokenContext(isStatementStart);

const CHAR_CODE_ASTERISK = '*'.charCodeAt(0);
const CHAR_CODE_BACKSLASH = '\\'.charCodeAt(0);
const CHAR_CODE_BRACE_CLOSE = '}'.charCodeAt(0);
const CHAR_CODE_BRACE_OPEN = '{'.charCodeAt(0);
const CHAR_CODE_BRACKET_CLOSE = ']'.charCodeAt(0);
const CHAR_CODE_BRACKET_OPEN = '['.charCodeAt(0);
const CHAR_CODE_DOLLAR = '$'.charCodeAt(0);
const CHAR_CODE_DOT = '.'.charCodeAt(0);
const CHAR_CODE_DOUBLE_QUOTE = '"'.charCodeAt(0);
const CHAR_CODE_EQUALS = '='.charCodeAt(0);
const CHAR_CODE_GREATER_THAN = '>'.charCodeAt(0);
const CHAR_CODE_PAREN_CLOSE = ')'.charCodeAt(0);
const CHAR_CODE_PAREN_OPEN = '('.charCodeAt(0);
const CHAR_CODE_SINGLE_QUOTE = "'".charCodeAt(0);
const CHAR_CODE_SLASH = '/'.charCodeAt(0);
const CHAR_CODE_TEMPLATE_QUOTE = '`'.charCodeAt(0);
const CHAR_CODE_TAB = '\t'.charCodeAt(0);
const CHAR_CODE_VERTICAL_TAB = '\v'.charCodeAt(0);
const CHAR_CODE_FORM_FEED = '\f'.charCodeAt(0);
const CHAR_CODE_SPACE = ' '.charCodeAt(0);
const CHAR_CODE_NON_BREAKING_SPACE = '\u00A0'.charCodeAt(0);
const CHAR_CODE_OGHAM_SPACE = '\u1680'.charCodeAt(0);
const CHAR_CODE_NARROW_NO_BREAKING_SPACE = '\u202F'.charCodeAt(0);
const CHAR_CODE_MEDIUM_MATHEMATICAL_SPACE = '\u205F'.charCodeAt(0);
const CHAR_CODE_IDEOGRAPHIC_SPACE = '\u3000'.charCodeAt(0);
const CHAR_CODE_ZERO_WIDTH_NON_JOINER = '\u200C'.charCodeAt(0);
const CHAR_CODE_ZERO_WIDTH_JOINER = '\u200D'.charCodeAt(0);
const CHAR_CODE_BOM = '\uFEFF'.charCodeAt(0);
const CHAR_CODE_LOWER_U = 'u'.charCodeAt(0);
const CHAR_CODE_ZERO = '0'.charCodeAt(0);
const CHAR_CODE_NINE = '9'.charCodeAt(0);
const CHAR_CODE_UPPER_A = 'A'.charCodeAt(0);
const CHAR_CODE_UPPER_F = 'F'.charCodeAt(0);
const CHAR_CODE_LOWER_A = 'a'.charCodeAt(0);
const CHAR_CODE_LOWER_F = 'f'.charCodeAt(0);
const CHAR_CODE_OPEN_BRACE_OFFSET = 'u'.length + 'a'.length;
const UNICODE_ESCAPE_BRACE_OFFSET = 'u'.length + 'a'.length + '{'.length;
const UNICODE_ESCAPE_PREFIX_LENGTH = 'u'.length + 'a'.length;
const UNICODE_ESCAPE_LENGTH = '0000'.length;
const MAX_CODE_UNIT = '\uFFFF'.charCodeAt(0);
const WHITESPACE_RANGE_START = '\u2000'.charCodeAt(0);
const WHITESPACE_RANGE_END = '\u200A'.charCodeAt(0);
const CHAR_CODE_PLUS = '+'.charCodeAt(0);
const CHAR_CODE_MINUS = '-'.charCodeAt(0);
const IDENTIFIER_MASK = CLS_UPPER | CLS_LOWER | CLS_DIGIT | CLS_UNDER;
const IDENTIFIER_START_MASK = CLS_UPPER | CLS_LOWER | CLS_UNDER;
const ELLIPSIS = '...';
const ELLIPSIS_LENGTH = ELLIPSIS.length;
const SINGLE_CHARACTER_LENGTH = 'a'.length;
const PAIR_OPERATOR_LENGTH = 'ab'.length;

const unicodeIdentifierStart = /\p{ID_Start}/uy;
const unicodeIdentifierContinue = /\p{ID_Continue}/uy;

interface REGEXIndex {
  ends: Map<number, number>;
  starts: Set<number>;
}

interface CommentEnd {
  endIndex: number;
  hasLineTerminator: boolean;
}

const KEYWORD_WORDS: readonly (readonly [string, RegexIdentifierKind])[] = [
  ['async', 'async'],
  ['await', 'expression'],
  ['break', 'break'],
  ['case', 'case'],
  ['catch', 'control'],
  ['class', 'class'],
  ['continue', 'break'],
  ['debugger', 'break'],
  ['default', 'default'],
  ['delete', 'expression'],
  ['do', 'block'],
  ['else', 'block'],
  ['export', 'export'],
  ['extends', 'extends'],
  ['finally', 'block'],
  ['for', 'control'],
  ['function', 'function'],
  ['if', 'control'],
  ['implements', 'implements'],
  ['in', 'expression'],
  ['instanceof', 'expression'],
  ['new', 'expression'],
  ['of', 'expression'],
  ['return', 'return'],
  ['switch', 'control'],
  ['throw', 'expression'],
  ['try', 'block'],
  ['typeof', 'expression'],
  ['void', 'expression'],
  ['while', 'control'],
  ['with', 'control'],
  ['yield', 'return'],
];

const isWord = (source: string, startIndex: number, endIndex: number, word: string): boolean =>
  endIndex - startIndex === word.length && source.startsWith(word, startIndex);

const identifierKind = (
  source: string,
  startIndex: number,
  endIndex: number,
): RegexIdentifierKind => {
  for (const [word, kind] of KEYWORD_WORDS) {
    if (isWord(source, startIndex, endIndex, word)) {
      return kind;
    }
  }
  return 'value';
};

const isASCIIDigit = (charCode: number): boolean =>
  charCode >= CHAR_CODE_ZERO && charCode <= CHAR_CODE_NINE;

const isASCIIIdentifierCharacter = (charCode: number): boolean =>
  charCode < CHAR_CLASS.length && (CHAR_CLASS[charCode] & IDENTIFIER_MASK) !== 0;

const isASCIIIdentifierStart = (charCode: number): boolean =>
  charCode < CHAR_CLASS.length && (CHAR_CLASS[charCode] & IDENTIFIER_START_MASK) !== 0;

const isHexDigit = (charCode: number): boolean =>
  (charCode >= CHAR_CODE_ZERO && charCode <= CHAR_CODE_NINE) ||
  (charCode >= CHAR_CODE_UPPER_A && charCode <= CHAR_CODE_UPPER_F) ||
  (charCode >= CHAR_CODE_LOWER_A && charCode <= CHAR_CODE_LOWER_F);

const unicodeCharacterMatches = (source: string, index: number, matcher: RegExp): boolean => {
  const unicodeMatcher = matcher;
  unicodeMatcher.lastIndex = index;
  return unicodeMatcher.test(source);
};

const fixedUnicodeEscapeEnd = (source: string, index: number): number | undefined => {
  for (let offset = 0; offset < UNICODE_ESCAPE_LENGTH; offset += SINGLE_CHARACTER_LENGTH) {
    if (!isHexDigit(source.charCodeAt(index + UNICODE_ESCAPE_PREFIX_LENGTH + offset))) {
      return undefined;
    }
  }
  return index + UNICODE_ESCAPE_PREFIX_LENGTH + UNICODE_ESCAPE_LENGTH;
};

const bracedUnicodeEscapeEnd = (source: string, index: number): number | undefined => {
  let endIndex = index + UNICODE_ESCAPE_BRACE_OFFSET;
  while (endIndex < source.length && source.charCodeAt(endIndex) !== CHAR_CODE_BRACE_CLOSE) {
    if (!isHexDigit(source.charCodeAt(endIndex))) {
      return undefined;
    }
    endIndex += SINGLE_CHARACTER_LENGTH;
  }
  if (
    source.charCodeAt(endIndex) !== CHAR_CODE_BRACE_CLOSE ||
    endIndex === index + UNICODE_ESCAPE_BRACE_OFFSET
  ) {
    return undefined;
  }
  return endIndex + SINGLE_CHARACTER_LENGTH;
};

const unicodeEscapeEnd = (source: string, index: number): number | undefined => {
  if (
    source.charCodeAt(index) !== CHAR_CODE_BACKSLASH ||
    source.charCodeAt(index + 1) !== CHAR_CODE_LOWER_U
  ) {
    return undefined;
  }
  if (source.charCodeAt(index + CHAR_CODE_OPEN_BRACE_OFFSET) === CHAR_CODE_BRACE_OPEN) {
    return bracedUnicodeEscapeEnd(source, index);
  }
  return fixedUnicodeEscapeEnd(source, index);
};

const codePointWidth = (source: string, index: number): number => {
  const codePoint = source.codePointAt(index);
  if (codePoint === undefined || codePoint <= MAX_CODE_UNIT) {
    return SINGLE_CHARACTER_LENGTH;
  }
  return PAIR_OPERATOR_LENGTH;
};

const isIdentifierEscape = (source: string, index: number): boolean =>
  unicodeEscapeEnd(source, index) !== undefined;

const isIdentifierCharacter = (source: string, index: number): boolean => {
  const charCode = source.charCodeAt(index);
  if (
    charCode === CHAR_CODE_DOLLAR ||
    charCode === CHAR_CODE_ZERO_WIDTH_NON_JOINER ||
    charCode === CHAR_CODE_ZERO_WIDTH_JOINER ||
    isASCIIIdentifierCharacter(charCode)
  ) {
    return true;
  }
  return (
    isIdentifierEscape(source, index) ||
    unicodeCharacterMatches(source, index, unicodeIdentifierContinue)
  );
};

const isIdentifierStart = (source: string, index: number): boolean => {
  const charCode = source.charCodeAt(index);
  if (charCode === CHAR_CODE_DOLLAR || isASCIIIdentifierStart(charCode)) {
    return true;
  }
  return (
    isIdentifierEscape(source, index) ||
    unicodeCharacterMatches(source, index, unicodeIdentifierStart)
  );
};

const firstIdentifierUnitEnd = (source: string, startIndex: number): number => {
  const escapeEnd = unicodeEscapeEnd(source, startIndex);
  if (escapeEnd !== undefined) {
    return escapeEnd;
  }
  return startIndex + codePointWidth(source, startIndex);
};

const nextIdentifierUnitEnd = (source: string, index: number): number | undefined => {
  const escapeEnd = unicodeEscapeEnd(source, index);
  if (escapeEnd !== undefined) {
    return escapeEnd;
  }
  if (!isIdentifierCharacter(source, index)) {
    return undefined;
  }
  return index + codePointWidth(source, index);
};

const identifierEnd = (source: string, startIndex: number): number => {
  let index = firstIdentifierUnitEnd(source, startIndex);
  while (index < source.length) {
    const nextIndex = nextIdentifierUnitEnd(source, index);
    if (nextIndex === undefined) {
      return index;
    }
    index = nextIndex;
  }
  return index;
};

const isUnicodeSpace = (charCode: number): boolean =>
  charCode === CHAR_CODE_NON_BREAKING_SPACE ||
  charCode === CHAR_CODE_OGHAM_SPACE ||
  (charCode >= WHITESPACE_RANGE_START && charCode <= WHITESPACE_RANGE_END) ||
  charCode === CHAR_CODE_NARROW_NO_BREAKING_SPACE ||
  charCode === CHAR_CODE_MEDIUM_MATHEMATICAL_SPACE ||
  charCode === CHAR_CODE_IDEOGRAPHIC_SPACE ||
  charCode === CHAR_CODE_BOM;

const isWhitespaceCode = (charCode: number): boolean =>
  charCode === CHAR_CODE_TAB ||
  isLineTerminatorCode(charCode) ||
  charCode === CHAR_CODE_VERTICAL_TAB ||
  charCode === CHAR_CODE_FORM_FEED ||
  charCode === CHAR_CODE_SPACE ||
  isUnicodeSpace(charCode);

const quotedEnd = (source: string, startIndex: number, quoteCode: number): number => {
  let isEscaped = false;
  let index = startIndex + SINGLE_CHARACTER_LENGTH;
  while (index < source.length) {
    const charCode = source.charCodeAt(index);
    if (isEscaped) {
      isEscaped = false;
    } else if (charCode === CHAR_CODE_BACKSLASH) {
      isEscaped = true;
    } else if (charCode === quoteCode || isLineTerminatorCode(charCode)) {
      return index + SINGLE_CHARACTER_LENGTH;
    }
    index += SINGLE_CHARACTER_LENGTH;
  }
  return source.length;
};

const numberEnd = (source: string, startIndex: number): number => {
  let index = startIndex + SINGLE_CHARACTER_LENGTH;
  while (index < source.length) {
    const charCode = source.charCodeAt(index);
    if (isASCIIDigit(charCode) || isIdentifierStart(source, index) || charCode === CHAR_CODE_DOT) {
      index += codePointWidth(source, index);
    } else {
      return index;
    }
  }
  return index;
};

const lineCommentEnd = (source: string, startIndex: number): CommentEnd => ({
  endIndex: findLineTerminatorIndex(source, startIndex + PAIR_OPERATOR_LENGTH),
  hasLineTerminator: false,
});

const blockCommentEnd = (source: string, startIndex: number): CommentEnd => {
  let hasLineTerminator = false;
  let index = startIndex + PAIR_OPERATOR_LENGTH;
  while (index < source.length) {
    const charCode = source.charCodeAt(index);
    hasLineTerminator ||= isLineTerminatorCode(charCode);
    if (charCode === CHAR_CODE_ASTERISK && source.charCodeAt(index + 1) === CHAR_CODE_SLASH) {
      return { endIndex: index + PAIR_OPERATOR_LENGTH, hasLineTerminator };
    }
    index += SINGLE_CHARACTER_LENGTH;
  }
  return { endIndex: source.length, hasLineTerminator };
};

const commentEnd = (
  source: string,
  startIndex: number,
  nextCode: number,
): CommentEnd | undefined => {
  if (nextCode === CHAR_CODE_SLASH) {
    return lineCommentEnd(source, startIndex);
  }
  if (nextCode === CHAR_CODE_ASTERISK) {
    return blockCommentEnd(source, startIndex);
  }
  return undefined;
};

const isOpeningDelimiter = (charCode: number): boolean =>
  charCode === CHAR_CODE_PAREN_OPEN ||
  charCode === CHAR_CODE_BRACKET_OPEN ||
  charCode === CHAR_CODE_BRACE_OPEN;

const isClosingDelimiter = (charCode: number): boolean =>
  charCode === CHAR_CODE_PAREN_CLOSE ||
  charCode === CHAR_CODE_BRACKET_CLOSE ||
  charCode === CHAR_CODE_BRACE_CLOSE;

const isTemplateInterpolationStart = (source: string, index: number): boolean =>
  source.charCodeAt(index) === CHAR_CODE_DOLLAR &&
  source.charCodeAt(index + SINGLE_CHARACTER_LENGTH) === CHAR_CODE_BRACE_OPEN;

const nextInterpolationDepth = (depth: number, charCode: number): number => {
  if (charCode === CHAR_CODE_BRACE_OPEN) {
    return depth + SINGLE_CHARACTER_LENGTH;
  }
  if (charCode === CHAR_CODE_BRACE_CLOSE) {
    return depth - SINGLE_CHARACTER_LENGTH;
  }
  return depth;
};

const dotTokenLength = (source: string, index: number): number => {
  if (source.startsWith(ELLIPSIS, index)) {
    return ELLIPSIS_LENGTH;
  }
  return SINGLE_CHARACTER_LENGTH;
};

const operatorLength = (isPair: boolean): number => {
  if (isPair) {
    return PAIR_OPERATOR_LENGTH;
  }
  return SINGLE_CHARACTER_LENGTH;
};

const slashOperatorLength = (nextCode: number): number => {
  if (nextCode === CHAR_CODE_EQUALS) {
    return PAIR_OPERATOR_LENGTH;
  }
  return SINGLE_CHARACTER_LENGTH;
};

const arrowOperator = (charCode: number, nextCode: number): boolean =>
  charCode === CHAR_CODE_EQUALS && nextCode === CHAR_CODE_GREATER_THAN;

const incrementOperator = (charCode: number, nextCode: number): boolean =>
  (charCode === CHAR_CODE_PLUS || charCode === CHAR_CODE_MINUS) && nextCode === charCode;

const newREGEXIndex = (): REGEXIndex => ({ ends: new Map(), starts: new Set() });

const afterValue = (context: REGEXTokenContext): void => context.afterValue();
const beginToken = (context: REGEXTokenContext): void => context.beginToken();
const consumeClosingDelimiter = (context: REGEXTokenContext, charCode: number): void =>
  context.consumeClosingDelimiter(charCode);
const consumeDOT = (context: REGEXTokenContext, tokenLength: number): void =>
  context.consumeDOT(tokenLength);
const consumeIdentifier = (
  context: REGEXTokenContext,
  source: string,
  startIndex: number,
  endIndex: number,
): void => context.consumeIdentifier(identifierKind(source, startIndex, endIndex));
const consumeOpeningDelimiter = (context: REGEXTokenContext, charCode: number): void =>
  context.consumeOpeningDelimiter(charCode);
const consumeOperator = (
  context: REGEXTokenContext,
  source: string,
  index: number,
  charCode: number,
): number => context.consumeOperator(source, index, charCode);

/**
 * Primitive operations shared by the incremental source lexer.
 *
 * @internal
 */
export const regexLexerPrimitives = {
  afterValue,
  arrowOperator,
  beginToken,
  blockCommentEnd,
  charCodeAsterisk: CHAR_CODE_ASTERISK,
  charCodeBackslash: CHAR_CODE_BACKSLASH,
  charCodeBraceClose: CHAR_CODE_BRACE_CLOSE,
  charCodeBraceOpen: CHAR_CODE_BRACE_OPEN,
  charCodeDOT: CHAR_CODE_DOT,
  charCodeDoubleQuote: CHAR_CODE_DOUBLE_QUOTE,
  charCodeEquals: CHAR_CODE_EQUALS,
  charCodeGreaterThan: CHAR_CODE_GREATER_THAN,
  charCodeParenClose: CHAR_CODE_PAREN_CLOSE,
  charCodeParenOpen: CHAR_CODE_PAREN_OPEN,
  charCodeSingleQuote: CHAR_CODE_SINGLE_QUOTE,
  charCodeSlash: CHAR_CODE_SLASH,
  charCodeTemplateQuote: CHAR_CODE_TEMPLATE_QUOTE,
  commentEnd,
  consumeClosingDelimiter,
  consumeDOT,
  consumeIdentifier,
  consumeOpeningDelimiter,
  consumeOperator,
  dotTokenLength,
  ellipsisLength: ELLIPSIS_LENGTH,
  identifierEnd,
  identifierStart: isIdentifierStart,
  incrementOperator,
  isASCIIDigit,
  isClosingDelimiter,
  isLineTerminatorCode,
  isOpeningDelimiter,
  isTemplateInterpolationStart,
  isWhitespaceCode,
  newREGEXIndex,
  newTokenContext,
  nextInterpolationDepth,
  numberEnd,
  operatorLength,
  pairOperatorLength: PAIR_OPERATOR_LENGTH,
  quotedEnd,
  singleCharacterLength: SINGLE_CHARACTER_LENGTH,
  slashOperatorLength,
};
