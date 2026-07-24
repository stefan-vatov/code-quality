/* -------------------------------------------------------------------------- */
/*      Lexical state machines shared by Effect source-navigation rules.      */
/* -------------------------------------------------------------------------- */
import { CHAR_CLASS, CLS_LOWER, CLS_UPPER } from './char-class';
import { findREGEXLiteralEnd, isREGEXLiteralStart } from './effect-source-regex-scan';
import { Match } from 'effect';

const CHAR_CODE_BACKSLASH = 92;
const CHAR_CODE_BLOCK_COMMENT = 42;
const CHAR_CODE_BRACE_CLOSE = 125;
const CHAR_CODE_BRACE_OPEN = 123;
const CHAR_CODE_CARRIAGE_RETURN = 13;
const CHAR_CODE_DOLLAR = 36;
const CHAR_CODE_DOUBLE_QUOTE = 34;
const CHAR_CODE_GREATER_THAN = 62;
const CHAR_CODE_LESS_THAN = 60;
const CHAR_CODE_LINE_COMMENT = 47;
const CHAR_CODE_NEWLINE = 10;
const CHAR_CODE_SINGLE_QUOTE = 39;
const CHAR_CODE_SPACE = 32;
const CHAR_CODE_TAB = 9;
const CHAR_CODE_TEMPLATE_QUOTE = 96;
const CHAR_CODE_UNDERSCORE = 95;
const LETTER_MASK = CLS_LOWER | CLS_UPPER;

const indexOrFallback = (index: number, fallback: number): number =>
  Match.value(index).pipe(
    Match.when(-1, (): number => fallback),
    Match.orElse((value): number => value),
  );

const skipLineCommentIndex = (source: string, index: number, fallback: number): number =>
  indexOrFallback(source.indexOf('\n', index + 2), fallback);

const skipBlockCommentIndex = (source: string, index: number, fallback: number): number =>
  Match.value(source.indexOf('*/', index + 2)).pipe(
    Match.when(-1, (): number => fallback),
    Match.orElse((commentEnd): number => commentEnd + 1),
  );

const isQuoteCode = (charCode: number): boolean =>
  charCode === CHAR_CODE_DOUBLE_QUOTE || charCode === CHAR_CODE_SINGLE_QUOTE;

const nextQuotedState = (charCode: number, quoteCode: number, isEscaped: boolean): number => {
  if (isEscaped) {
    return quoteCode;
  }
  if (charCode === CHAR_CODE_BACKSLASH) {
    return -quoteCode;
  }
  if (charCode === quoteCode) {
    return 0;
  }
  return quoteCode;
};

const findQuotedEnd = (source: string, startIndex: number, quoteCode: number): number => {
  const sourceLength = source.length;
  let index = startIndex + 1;
  let isEscaped = false;
  while (index < sourceLength) {
    const nextState = nextQuotedState(source.charCodeAt(index), quoteCode, isEscaped);
    if (nextState === 0) {
      return index + 1;
    }
    isEscaped = nextState < 0;
    index += 1;
  }
  return sourceLength;
};

const nextStatementCodeIndex = (source: string, index: number, sourceLength: number): number => {
  const nextCode = source.charCodeAt(index + 1);
  if (nextCode === CHAR_CODE_LINE_COMMENT) {
    return skipLineCommentIndex(source, index, sourceLength - 1) + 1;
  }
  if (nextCode === CHAR_CODE_BLOCK_COMMENT) {
    return skipBlockCommentIndex(source, index, sourceLength - 1) + 1;
  }
  if (isREGEXLiteralStart(source, index)) {
    return findREGEXLiteralEnd(source, index) + 1;
  }
  return index;
};

interface BraceScanState {
  depth: number;
  index: number;
}

const nextBraceScanState = (
  source: string,
  sourceLength: number,
  state: BraceScanState,
): BraceScanState => {
  const { depth, index } = state;
  const charCode = source.charCodeAt(index);
  return Match.value(charCode).pipe(
    Match.when(
      (code): boolean => code === CHAR_CODE_DOUBLE_QUOTE || code === CHAR_CODE_SINGLE_QUOTE,
      (code): BraceScanState => ({ depth, index: findQuotedEnd(source, index, code) }),
    ),
    Match.when(
      CHAR_CODE_TEMPLATE_QUOTE,
      (): BraceScanState => ({ depth, index: findTemplateEnd(source, index) }),
    ),
    Match.when(
      CHAR_CODE_LINE_COMMENT,
      (): BraceScanState => ({
        depth,
        index: nextStatementCodeIndex(source, index, sourceLength),
      }),
    ),
    Match.when(
      CHAR_CODE_BRACE_OPEN,
      (): BraceScanState => ({ depth: depth + 1, index: index + 1 }),
    ),
    Match.when(
      CHAR_CODE_BRACE_CLOSE,
      (): BraceScanState => ({ depth: depth - 1, index: index + 1 }),
    ),
    Match.orElse((): BraceScanState => ({ depth, index: index + 1 })),
  );
};

const findCodeBraceEnd = (source: string, startIndex: number): number => {
  let state: BraceScanState = { depth: 1, index: startIndex + 1 };
  while (state.index < source.length && state.depth > 0) {
    state = nextBraceScanState(source, source.length, state);
  }
  return state.index;
};

const nextTemplateIndex = (source: string, index: number): number => {
  const charCode = source.charCodeAt(index);
  if (charCode === CHAR_CODE_BACKSLASH) {
    return index + 2;
  }
  if (charCode === CHAR_CODE_TEMPLATE_QUOTE) {
    return -(index + 1);
  }
  if (charCode === CHAR_CODE_DOLLAR && source.charCodeAt(index + 1) === CHAR_CODE_BRACE_OPEN) {
    return findCodeBraceEnd(source, index + 1);
  }
  return index + 1;
};

const findTemplateEnd = (source: string, startIndex: number): number => {
  let index = startIndex + 1;
  while (index < source.length) {
    const nextIndex = nextTemplateIndex(source, index);
    if (nextIndex < 0) {
      return -nextIndex;
    }
    index = nextIndex;
  }
  return source.length;
};

interface JSXTag {
  endIndex: number;
  isClosing: boolean;
  isSelfClosing: boolean;
}

const isJSXNameCode = (charCode: number): boolean =>
  charCode === CHAR_CODE_DOLLAR ||
  charCode === CHAR_CODE_UNDERSCORE ||
  (charCode < CHAR_CLASS.length && (CHAR_CLASS[charCode] & LETTER_MASK) !== 0);

const isWhitespaceCode = (charCode: number): boolean =>
  charCode === CHAR_CODE_TAB ||
  charCode === CHAR_CODE_NEWLINE ||
  charCode === CHAR_CODE_CARRIAGE_RETURN ||
  charCode === CHAR_CODE_SPACE;

interface JSXTagStart {
  index: number;
  isClosing: boolean;
}

const jsxTagStart = (source: string, startIndex: number): JSXTagStart | undefined => {
  let index = startIndex + 1;
  const isClosing = source.charCodeAt(index) === CHAR_CODE_LINE_COMMENT;
  index += Number(isClosing);
  const isFragment = source.charCodeAt(index) === CHAR_CODE_GREATER_THAN;
  if (!isFragment && !isJSXNameCode(source.charCodeAt(index))) {
    return undefined;
  }
  return { index, isClosing };
};

const previousNonWhitespaceIndex = (source: string, startIndex: number, index: number): number => {
  let previousIndex = index - 1;
  while (previousIndex > startIndex && isWhitespaceCode(source.charCodeAt(previousIndex))) {
    previousIndex -= 1;
  }
  return previousIndex;
};

const nextJSXTagScan = (
  source: string,
  startIndex: number,
  index: number,
  isClosing: boolean,
): JSXTag | number => {
  const charCode = source.charCodeAt(index);
  if (charCode === CHAR_CODE_DOUBLE_QUOTE || charCode === CHAR_CODE_SINGLE_QUOTE) {
    return findQuotedEnd(source, index, charCode);
  }
  if (charCode === CHAR_CODE_BRACE_OPEN) {
    return findCodeBraceEnd(source, index);
  }
  if (charCode === CHAR_CODE_GREATER_THAN) {
    const previousIndex = previousNonWhitespaceIndex(source, startIndex, index);
    return {
      endIndex: index,
      isClosing,
      isSelfClosing: source.charCodeAt(previousIndex) === CHAR_CODE_LINE_COMMENT,
    };
  }
  return index + 1;
};

const findJSXTag = (source: string, startIndex: number): JSXTag | undefined => {
  const start = jsxTagStart(source, startIndex);
  if (start === undefined) {
    return undefined;
  }
  let { index } = start;
  while (index < source.length) {
    const next = nextJSXTagScan(source, startIndex, index, start.isClosing);
    if (typeof next !== 'number') {
      return next;
    }
    index = next;
  }
  return undefined;
};

const jsxDepthAfterTag = (depth: number, tag: JSXTag): number =>
  Match.value(tag).pipe(
    Match.when(
      ({ isClosing }): boolean => isClosing,
      (): number => depth - 1,
    ),
    Match.when(
      ({ isSelfClosing }): boolean => isSelfClosing,
      (): number => depth,
    ),
    Match.orElse((): number => depth + 1),
  );

const nextJSXElementState = (source: string, state: BraceScanState): BraceScanState => {
  const charCode = source.charCodeAt(state.index);
  if (charCode === CHAR_CODE_BRACE_OPEN) {
    return { ...state, index: findCodeBraceEnd(source, state.index) };
  }
  if (charCode !== CHAR_CODE_LESS_THAN) {
    return { ...state, index: state.index + 1 };
  }
  const tag = findJSXTag(source, state.index);
  if (tag === undefined) {
    return { ...state, index: state.index + 1 };
  }
  return { depth: jsxDepthAfterTag(state.depth, tag), index: tag.endIndex + 1 };
};

const initialJSXElementState = (source: string, startIndex: number): BraceScanState | number => {
  const root = findJSXTag(source, startIndex);
  if (root === undefined || root.isClosing) {
    return startIndex;
  }
  if (root.isSelfClosing) {
    return root.endIndex + 1;
  }
  return { depth: 1, index: root.endIndex + 1 };
};

const findJSXElementEnd = (source: string, startIndex: number): number => {
  const initialState = initialJSXElementState(source, startIndex);
  if (typeof initialState === 'number') {
    return initialState;
  }
  let state = initialState;
  while (state.index < source.length) {
    state = nextJSXElementState(source, state);
    if (state.depth === 0) {
      return state.index;
    }
  }
  return startIndex;
};

/**
 * Advance past a quoted, commented, regular-expression, template, or JSX region.
 *
 * @param source - Complete source text being scanned.
 * @param index - Current source offset.
 * @param sourceLength - Cached source length for EOF fallbacks.
 * @param charCode - Character code at the current offset.
 * @returns The first code offset after a lexical region, or the unchanged offset.
 * @throws Does not throw.
 * @internal
 */
export const nextSourceLexicalIndex = (
  source: string,
  index: number,
  sourceLength: number,
  charCode: number,
): number => {
  if (charCode === CHAR_CODE_TEMPLATE_QUOTE) {
    return findTemplateEnd(source, index);
  }
  if (isQuoteCode(charCode)) {
    return findQuotedEnd(source, index, charCode);
  }
  if (charCode === CHAR_CODE_LINE_COMMENT) {
    return nextStatementCodeIndex(source, index, sourceLength);
  }
  if (charCode === CHAR_CODE_LESS_THAN) {
    return findJSXElementEnd(source, index);
  }
  return index;
};
