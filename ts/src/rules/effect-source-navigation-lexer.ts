/* -------------------------------------------------------------------------- */
/*      Lexical state machines shared by Effect source-navigation rules.      */
/* -------------------------------------------------------------------------- */
import { CHAR_CLASS, CLS_LOWER, CLS_UPPER } from './char-class';
import {
  findLineTerminatorIndex,
  indexAfterLineTerminator,
  isLineTerminatorCode,
} from './effect-source-line-terminators';
import { findREGEXLiteralEnd, isREGEXLiteralStart } from './effect-source-regex-scan';
import { Match, Predicate } from 'effect';

const CHAR_CODE_BACKSLASH = 92;
const CHAR_CODE_BLOCK_COMMENT = 42;
const CHAR_CODE_BRACE_CLOSE = 125;
const CHAR_CODE_BRACE_OPEN = 123;
const CHAR_CODE_DOLLAR = 36;
const CHAR_CODE_DOUBLE_QUOTE = 34;
const CHAR_CODE_GREATER_THAN = 62;
const CHAR_CODE_LESS_THAN = 60;
const CHAR_CODE_LINE_COMMENT = 47;
const CHAR_CODE_SINGLE_QUOTE = 39;
const CHAR_CODE_SPACE = 32;
const CHAR_CODE_TAB = 9;
const CHAR_CODE_TEMPLATE_QUOTE = 96;
const CHAR_CODE_UNDERSCORE = 95;
const LETTER_MASK = CLS_LOWER | CLS_UPPER;

const skipLineCommentIndex = (source: string, index: number, fallback: number): number => {
  const lineEnd = findLineTerminatorIndex(source, index + 2);
  if (lineEnd === source.length) {
    return fallback;
  }
  return indexAfterLineTerminator(source, lineEnd) - 1;
};

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

interface JSXElementScanState {
  depth: number;
  index: number;
}

interface CodeBraceScanFrame {
  depth: number;
  index: number;
  kind: 'code-brace';
}

interface TemplateScanFrame {
  index: number;
  kind: 'template';
}

type LexicalRegionFrame = CodeBraceScanFrame | TemplateScanFrame;

interface AdvanceLexicalStep {
  frame: LexicalRegionFrame;
  kind: 'advance';
}

interface PushLexicalStep {
  frame: LexicalRegionFrame;
  kind: 'push';
}

interface CompleteLexicalStep {
  endIndex: number;
  kind: 'complete';
}

type LexicalStep = AdvanceLexicalStep | CompleteLexicalStep | PushLexicalStep;

const nextCodeBraceIndex = (source: string, index: number): number => {
  const nextIndex = nextStatementCodeIndex(source, index, source.length);
  if (nextIndex === index) {
    return index + 1;
  }
  return nextIndex;
};

const stepTemplateFrame = (source: string, frame: TemplateScanFrame): LexicalStep => {
  const { index } = frame;
  const charCode = source.charCodeAt(index);
  if (charCode === CHAR_CODE_BACKSLASH) {
    return { frame: { ...frame, index: index + 2 }, kind: 'advance' };
  }
  if (charCode === CHAR_CODE_TEMPLATE_QUOTE) {
    return { endIndex: index + 1, kind: 'complete' };
  }
  if (charCode === CHAR_CODE_DOLLAR && source.charCodeAt(index + 1) === CHAR_CODE_BRACE_OPEN) {
    return { frame: { depth: 1, index: index + 2, kind: 'code-brace' }, kind: 'push' };
  }
  return { frame: { ...frame, index: index + 1 }, kind: 'advance' };
};

const skipCodeBraceRegion = (
  source: string,
  frame: CodeBraceScanFrame,
): LexicalStep | undefined => {
  const { index } = frame;
  const charCode = source.charCodeAt(index);
  if (isQuoteCode(charCode)) {
    return { frame: { ...frame, index: findQuotedEnd(source, index, charCode) }, kind: 'advance' };
  }
  if (charCode === CHAR_CODE_TEMPLATE_QUOTE) {
    return { frame: { index, kind: 'template' }, kind: 'push' };
  }
  if (charCode !== CHAR_CODE_LINE_COMMENT) {
    return undefined;
  }
  return { frame: { ...frame, index: nextCodeBraceIndex(source, index) }, kind: 'advance' };
};

const stepCodeBraceDelimiter = (frame: CodeBraceScanFrame, charCode: number): LexicalStep => {
  const { index } = frame;
  if (charCode === CHAR_CODE_BRACE_OPEN) {
    return { frame: { ...frame, depth: frame.depth + 1, index: index + 1 }, kind: 'advance' };
  }
  if (charCode !== CHAR_CODE_BRACE_CLOSE) {
    return { frame: { ...frame, index: index + 1 }, kind: 'advance' };
  }
  const nextFrame = { ...frame, depth: frame.depth - 1, index: index + 1 };
  if (nextFrame.depth !== 0) {
    return { frame: nextFrame, kind: 'advance' };
  }
  return { endIndex: nextFrame.index, kind: 'complete' };
};

const stepCodeBraceFrame = (source: string, frame: CodeBraceScanFrame): LexicalStep => {
  const { index } = frame;
  const charCode = source.charCodeAt(index);
  const regionStep = skipCodeBraceRegion(source, frame);
  if (regionStep !== undefined) {
    return regionStep;
  }
  return stepCodeBraceDelimiter(frame, charCode);
};

const stepLexicalRegion = (source: string, frames: LexicalRegionFrame[]): LexicalStep => {
  const frame = frames.at(-1);
  if (frame === undefined) {
    return { endIndex: source.length, kind: 'complete' };
  }
  if (frame.index >= source.length) {
    return { endIndex: source.length, kind: 'complete' };
  }
  if (frame.kind === 'template') {
    return stepTemplateFrame(source, frame);
  }
  return stepCodeBraceFrame(source, frame);
};

const completeLexicalStep = (
  frames: LexicalRegionFrame[],
  endIndex: number,
): number | undefined => {
  frames.pop();
  const parent = frames.at(-1);
  if (parent === undefined) {
    return endIndex;
  }
  frames.pop();
  frames.push({ ...parent, index: endIndex });
  return undefined;
};

const applyLexicalStep = (frames: LexicalRegionFrame[], step: LexicalStep): number | undefined => {
  if (step.kind === 'advance') {
    frames.pop();
    frames.push(step.frame);
    return undefined;
  }
  if (step.kind === 'push') {
    frames.push(step.frame);
    return undefined;
  }
  return completeLexicalStep(frames, step.endIndex);
};

const scanLexicalRegion = (source: string, initialFrame: LexicalRegionFrame): number => {
  const frames: LexicalRegionFrame[] = [initialFrame];
  while (frames.length > 0) {
    const endIndex = applyLexicalStep(frames, stepLexicalRegion(source, frames));
    if (endIndex !== undefined) {
      return endIndex;
    }
  }
  return source.length;
};

const findCodeBraceEnd = (source: string, startIndex: number): number =>
  scanLexicalRegion(source, { depth: 1, index: startIndex + 1, kind: 'code-brace' });

const findTemplateEnd = (source: string, startIndex: number): number =>
  scanLexicalRegion(source, { index: startIndex + 1, kind: 'template' });

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
  charCode === CHAR_CODE_TAB || isLineTerminatorCode(charCode) || charCode === CHAR_CODE_SPACE;

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
    if (!Predicate.isNumber(next)) {
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

const nextJSXElementState = (source: string, state: JSXElementScanState): JSXElementScanState => {
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

const initialJSXElementState = (
  source: string,
  startIndex: number,
): JSXElementScanState | number => {
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
  if (Predicate.isNumber(initialState)) {
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
