/* -------------------------------------------------------------------------- */
/*          Ignored source-region helpers for exported JSDoc checks.          */
/* -------------------------------------------------------------------------- */
const CHAR_CODE_BACKSLASH = 92;
const CHAR_CODE_NEWLINE = 10;
const CHAR_CODE_ASTERISK = 42;
const CHAR_CODE_SLASH = 47;
const CHAR_CODE_DOUBLE_QUOTE = 34;
const CHAR_CODE_SINGLE_QUOTE = 39;
const CHAR_CODE_BACKTICK = 96;
const STATE_LINE_COMMENT = 1;
const STATE_BLOCK_COMMENT = 2;
const STATE_ESCAPED = 4;
const STATE_DOUBLE_QUOTE = 8;
const STATE_SINGLE_QUOTE = 16;
const STATE_BACKTICK = 32;
const STATE_QUOTE_MASK = STATE_DOUBLE_QUOTE | STATE_SINGLE_QUOTE | STATE_BACKTICK;

/**
 * Index of ignored lexical positions and raw JSDoc starts for one source.
 */
export interface IgnoredTextIndex {
  readonly isInside: (pos: number) => boolean;
  readonly jsdocStarts: readonly number[];
}

const isIgnoredState = (state: number): boolean =>
  (state & (STATE_LINE_COMMENT | STATE_BLOCK_COMMENT | STATE_QUOTE_MASK)) !== 0;

const boundedPositionFor = (pos: number, sourceLength: number): number => {
  if (pos < sourceLength) {
    return pos;
  }
  return sourceLength;
};

const isJSDocStartAt = (source: string, idx: number): boolean =>
  source.charCodeAt(idx) === CHAR_CODE_SLASH &&
  source.charCodeAt(idx + 1) === CHAR_CODE_ASTERISK &&
  source.charCodeAt(idx + 2) === CHAR_CODE_ASTERISK;

const nextLineCommentState = (state: number, charCode: number): number => {
  if (charCode === CHAR_CODE_NEWLINE) {
    return state & ~STATE_LINE_COMMENT;
  }
  return state;
};

const nextBlockCommentState = (state: number, charCode: number, nextCharCode: number): number => {
  if (charCode === CHAR_CODE_ASTERISK && nextCharCode === CHAR_CODE_SLASH) {
    return state & ~STATE_BLOCK_COMMENT;
  }
  return state;
};

const isClosingQuote = (state: number, charCode: number): boolean =>
  ((state & STATE_DOUBLE_QUOTE) !== 0 && charCode === CHAR_CODE_DOUBLE_QUOTE) ||
  ((state & STATE_SINGLE_QUOTE) !== 0 && charCode === CHAR_CODE_SINGLE_QUOTE) ||
  ((state & STATE_BACKTICK) !== 0 && charCode === CHAR_CODE_BACKTICK);

const nextQuotedState = (state: number, charCode: number): number => {
  if ((state & STATE_ESCAPED) !== 0) {
    return state & ~STATE_ESCAPED;
  }
  if (charCode === CHAR_CODE_BACKSLASH) {
    return state | STATE_ESCAPED;
  }
  if (isClosingQuote(state, charCode)) {
    return state & ~STATE_QUOTE_MASK;
  }
  return state;
};

const quoteStateFor = (charCode: number): number => {
  if (charCode === CHAR_CODE_DOUBLE_QUOTE) {
    return STATE_DOUBLE_QUOTE;
  }
  if (charCode === CHAR_CODE_SINGLE_QUOTE) {
    return STATE_SINGLE_QUOTE;
  }
  if (charCode === CHAR_CODE_BACKTICK) {
    return STATE_BACKTICK;
  }
  return 0;
};

const nextUnquotedState = (state: number, charCode: number, nextCharCode: number): number => {
  if (charCode === CHAR_CODE_SLASH && nextCharCode === CHAR_CODE_SLASH) {
    return state | STATE_LINE_COMMENT;
  }
  if (charCode === CHAR_CODE_SLASH && nextCharCode === CHAR_CODE_ASTERISK) {
    return state | STATE_BLOCK_COMMENT;
  }
  const quoteState = quoteStateFor(charCode);
  if (quoteState !== 0) {
    return state | quoteState;
  }
  return state;
};

const nextIgnoredState = (state: number, charCode: number, nextCharCode: number): number => {
  if ((state & STATE_LINE_COMMENT) !== 0) {
    return nextLineCommentState(state, charCode);
  }
  if ((state & STATE_BLOCK_COMMENT) !== 0) {
    return nextBlockCommentState(state, charCode, nextCharCode);
  }
  if ((state & STATE_QUOTE_MASK) !== 0) {
    return nextQuotedState(state, charCode);
  }
  return nextUnquotedState(state, charCode, nextCharCode);
};

const ignoredPositionQuery = (
  ignoredPositions: Uint8Array,
  sourceLength: number,
  pos: number,
): boolean => {
  if (pos <= 0) {
    return false;
  }
  const boundedPosition = boundedPositionFor(pos, sourceLength);
  return ignoredPositions[boundedPosition] === 1;
};

const scanIgnoredText = (
  source: string,
  ignoredPositions: Uint8Array,
  jsdocStarts: number[],
): number => {
  const positions = ignoredPositions;
  let state = 0;
  for (let idx = 0; idx < source.length; idx += 1) {
    if (isJSDocStartAt(source, idx)) {
      jsdocStarts.push(idx);
    }
    positions[idx] = Number(isIgnoredState(state));
    state = nextIgnoredState(state, source.charCodeAt(idx), source.charCodeAt(idx + 1));
  }
  return state;
};

/**
 * Builds lexical state and raw JSDoc indexes for one source invocation.
 *
 * @param source - Source text to index.
 * @returns A reusable ignored-text and JSDoc position index.
 */
export const createIgnoredTextIndex = (source: string): IgnoredTextIndex => {
  const sourceLength = source.length;
  const ignoredPositions = new Uint8Array(sourceLength + 1);
  const jsdocStarts: number[] = [];
  const state = scanIgnoredText(source, ignoredPositions, jsdocStarts);

  ignoredPositions[sourceLength] = Number(isIgnoredState(state));
  const isInside = (pos: number): boolean =>
    ignoredPositionQuery(ignoredPositions, sourceLength, pos);

  return { isInside, jsdocStarts };
};

let cachedSource: string | undefined = undefined;
let cachedIndex: IgnoredTextIndex | undefined = undefined;

const indexFor = (source: string): IgnoredTextIndex => {
  if (cachedIndex !== undefined && cachedSource === source) {
    return cachedIndex;
  }
  const nextIndex = createIgnoredTextIndex(source);
  cachedSource = source;
  cachedIndex = nextIndex;
  return nextIndex;
};

/**
 * Checks whether a source offset is inside a comment or string literal.
 *
 * @param source - Source text to inspect.
 * @param pos - Zero-based source offset to query.
 * @returns Whether the offset is inside ignored lexical text.
 */
export const isInsideIgnoredText = (source: string, pos: number): boolean =>
  indexFor(source).isInside(pos);
