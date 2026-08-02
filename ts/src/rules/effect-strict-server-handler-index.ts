/* -------------------------------------------------------------------------- */
/*       One-pass lexical boundaries for server-handler source ranges.        */
/* -------------------------------------------------------------------------- */
import type { SourceRange } from './effect-strict-server-handler-types';
import { findMatchingBrace } from './effect-source-helpers';

const CHAR_CODE_DIGIT_START = 48;
const CHAR_CODE_DIGIT_END = 57;
const CHAR_CODE_UPPER_START = 65;
const CHAR_CODE_UPPER_END = 90;
const CHAR_CODE_LOWER_START = 97;
const CHAR_CODE_LOWER_END = 122;
const CHAR_CODE_DOLLAR = 36;
const CHAR_CODE_UNDERSCORE = 95;
const CHAR_CODE_PAREN_OPEN = 40;
const CHAR_CODE_PAREN_CLOSE = 41;
const CHAR_CODE_BRACKET_OPEN = 91;
const CHAR_CODE_BRACKET_CLOSE = 93;
const CHAR_CODE_BRACE_OPEN = 123;
const CHAR_CODE_BRACE_CLOSE = 125;
const CHAR_CODE_COMMA = 44;
const CHAR_CODE_SEMICOLON = 59;
const CHAR_CODE_TAB = 9;
const CHAR_CODE_LINE_FEED = 10;
const CHAR_CODE_VERTICAL_TAB = 11;
const CHAR_CODE_FORM_FEED = 12;
const CHAR_CODE_CARRIAGE_RETURN = 13;
const CHAR_CODE_SPACE = 32;
const CHAR_CODE_NONBREAKING_SPACE = 160;

/**
 * Provides indexed delimiter and expression-boundary queries.
 *
 * @param closeByOpen - Matching delimiter offsets.
 * @param expressionEnd - Finds the inclusive end of an expression.
 * @param frameAt - Innermost delimiter frame at each source offset.
 * @param frameCloses - Closing offsets for delimiter frames.
 * @param frameOpens - Opening offsets for delimiter frames.
 * @param previousCode - Previous non-whitespace source offsets.
 * @returns An immutable lexical navigation view.
 * @throws Does not throw.
 * @internal
 */
export interface ExpressionBoundaryIndex {
  readonly closeByOpen: ReadonlyMap<number, number>;
  readonly expressionEnd: (start: number) => number;
  readonly frameAt: Int32Array;
  readonly frameCloses: readonly number[];
  readonly frameOpens: readonly number[];
  readonly previousCode: Int32Array;
}

interface DelimiterFrame {
  id: number;
  open: number;
  openCode: number;
}

interface BuilderState {
  readonly closeByOpen: Map<number, number>;
  readonly frameAt: Int32Array;
  readonly frameCloses: number[];
  readonly frameDepths: number[];
  readonly frameOpens: number[];
  readonly previousCode: Int32Array;
  readonly separatorIndexes: number[][];
  readonly stack: DelimiterFrame[];
  previousIndex: number;
}

/**
 * Tests whether a source code unit can occur inside an identifier.
 *
 * @param charCode - UTF-16 code-unit value.
 * @returns Whether the code unit is an ASCII identifier character.
 * @throws Does not throw.
 * @internal
 */
export const isIdentifierPart = (charCode: number): boolean =>
  (charCode >= CHAR_CODE_DIGIT_START && charCode <= CHAR_CODE_DIGIT_END) ||
  (charCode >= CHAR_CODE_UPPER_START && charCode <= CHAR_CODE_UPPER_END) ||
  (charCode >= CHAR_CODE_LOWER_START && charCode <= CHAR_CODE_LOWER_END) ||
  charCode === CHAR_CODE_DOLLAR ||
  charCode === CHAR_CODE_UNDERSCORE;

/**
 * Tests whether a source code unit is whitespace for boundary scanning.
 *
 * @param charCode - UTF-16 code-unit value.
 * @returns Whether the code unit is a supported whitespace character.
 * @throws Does not throw.
 * @internal
 */
export const isWhitespace = (charCode: number): boolean =>
  charCode === CHAR_CODE_TAB ||
  charCode === CHAR_CODE_LINE_FEED ||
  charCode === CHAR_CODE_VERTICAL_TAB ||
  charCode === CHAR_CODE_FORM_FEED ||
  charCode === CHAR_CODE_CARRIAGE_RETURN ||
  charCode === CHAR_CODE_SPACE ||
  charCode === CHAR_CODE_NONBREAKING_SPACE;

const isOpeningDelimiter = (charCode: number): boolean =>
  charCode === CHAR_CODE_PAREN_OPEN ||
  charCode === CHAR_CODE_BRACKET_OPEN ||
  charCode === CHAR_CODE_BRACE_OPEN;

const closesDelimiter = (openCode: number, closeCode: number): boolean => {
  if (openCode === CHAR_CODE_PAREN_OPEN) {
    return closeCode === CHAR_CODE_PAREN_CLOSE;
  }
  if (openCode === CHAR_CODE_BRACKET_OPEN) {
    return closeCode === CHAR_CODE_BRACKET_CLOSE;
  }
  return openCode === CHAR_CODE_BRACE_OPEN && closeCode === CHAR_CODE_BRACE_CLOSE;
};

/**
 * Finds the first sorted value at or after a target offset.
 *
 * @param values - Sorted source offsets.
 * @param target - Lower-bound target offset.
 * @returns The matching array position.
 * @throws Does not throw.
 * @internal
 */
export const lowerBound = (values: readonly number[], target: number): number => {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    const value = values[middle] ?? Number.POSITIVE_INFINITY;
    if (value < target) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return low;
};

const createBuilderState = (sourceLength: number): BuilderState => {
  const frameAt = new Int32Array(sourceLength);
  const previousCode = new Int32Array(sourceLength);
  frameAt.fill(-1);
  previousCode.fill(-1);
  return {
    closeByOpen: new Map(),
    frameAt,
    frameCloses: [],
    frameDepths: [],
    frameOpens: [],
    previousCode,
    previousIndex: -1,
    separatorIndexes: [],
    stack: [],
  };
};

const recordSeparator = (state: BuilderState, index: number, charCode: number): boolean => {
  const builderState = state;
  if (charCode !== CHAR_CODE_COMMA && charCode !== CHAR_CODE_SEMICOLON) {
    return false;
  }
  const separators = builderState.separatorIndexes[builderState.stack.length];
  if (separators) {
    separators.push(index);
  } else {
    builderState.separatorIndexes[builderState.stack.length] = [index];
  }
  return true;
};

const recordOpeningDelimiter = (state: BuilderState, index: number, charCode: number): boolean => {
  const builderState = state;
  if (!isOpeningDelimiter(charCode)) {
    return false;
  }
  const id = builderState.frameCloses.length;
  builderState.frameCloses.push(-1);
  builderState.frameDepths.push(builderState.stack.length + 1);
  builderState.frameOpens.push(index);
  builderState.stack.push({ id, open: index, openCode: charCode });
  return true;
};

const recordClosingDelimiter = (state: BuilderState, index: number, charCode: number): void => {
  const builderState = state;
  const frame = builderState.stack.at(-1);
  if (!frame || !closesDelimiter(frame.openCode, charCode)) {
    return;
  }
  builderState.stack.pop();
  builderState.frameCloses[frame.id] = index;
  builderState.closeByOpen.set(frame.open, index);
};

const recordDelimiter = (state: BuilderState, index: number, charCode: number): void => {
  const wasSeparator = recordSeparator(state, index, charCode);
  if (wasSeparator) {
    return;
  }
  const wasOpening = recordOpeningDelimiter(state, index, charCode);
  if (!wasOpening) {
    recordClosingDelimiter(state, index, charCode);
  }
};

const scanCharacter = (state: BuilderState, source: string, index: number): void => {
  const builderState = state;
  builderState.frameAt[index] = builderState.stack.at(-1)?.id ?? -1;
  builderState.previousCode[index] = builderState.previousIndex;
  const charCode = source.charCodeAt(index);
  if (!isWhitespace(charCode)) {
    builderState.previousIndex = index;
  }
  recordDelimiter(state, index, charCode);
};

const scanSource = (state: BuilderState, source: string): void => {
  for (let index = 0; index < source.length; index += 1) {
    scanCharacter(state, source, index);
  }
};

const frameBoundaryFor = (
  state: BuilderState,
  sourceLength: number,
  frameId: number,
): { closeIndex: number; depth: number } => {
  if (frameId < 0) {
    return { closeIndex: sourceLength, depth: 0 };
  }
  return {
    closeIndex: state.frameCloses[frameId] ?? sourceLength,
    depth: state.frameDepths[frameId] ?? 0,
  };
};

const expressionEndFor = (state: BuilderState, sourceLength: number, start: number): number => {
  if (start < 0 || start >= sourceLength) {
    return start - 1;
  }
  const frameId = state.frameAt[start] ?? -1;
  const boundary = frameBoundaryFor(state, sourceLength, frameId);
  const separators = state.separatorIndexes[boundary.depth] ?? [];
  const separatorIndex = separators[lowerBound(separators, start)] ?? sourceLength;
  return Math.min(separatorIndex, boundary.closeIndex) - 1;
};

/**
 * Builds one-pass lexical boundaries for a source projection.
 *
 * @param source - Comment and literal-free source projection.
 * @returns Indexed delimiter and expression-boundary queries.
 * @throws Does not throw.
 * @internal
 */
export const buildExpressionBoundaryIndex = (source: string): ExpressionBoundaryIndex => {
  const state = createBuilderState(source.length);
  scanSource(state, source);
  return {
    closeByOpen: state.closeByOpen,
    expressionEnd: (start): number => expressionEndFor(state, source.length, start),
    frameAt: state.frameAt,
    frameCloses: state.frameCloses,
    frameOpens: state.frameOpens,
    previousCode: state.previousCode,
  };
};

const bodyStartAfterParameters = (source: string, parameterClose: number): number => {
  let bodyStart = parameterClose + 1;
  while (bodyStart < source.length && isWhitespace(source.charCodeAt(bodyStart))) {
    bodyStart += 1;
  }
  while (bodyStart < source.length && source.charCodeAt(bodyStart) !== CHAR_CODE_BRACE_OPEN) {
    if (source.charCodeAt(bodyStart) === CHAR_CODE_SEMICOLON) {
      return -1;
    }
    bodyStart += 1;
  }
  return bodyStart;
};

const bodyEndAt = (source: string, boundary: ExpressionBoundaryIndex, bodyStart: number): number =>
  boundary.closeByOpen.get(bodyStart) ?? findMatchingBrace(source, bodyStart);

/**
 * Finds a function body after a parameter list.
 *
 * @param source - Comment and literal-free source projection.
 * @param boundary - Indexed delimiter boundaries.
 * @param parameterOpen - Opening parenthesis of the parameter list.
 * @returns The inclusive function body range, or undefined when malformed.
 * @throws Does not throw.
 * @internal
 */
export const functionBodyRange = (
  source: string,
  boundary: ExpressionBoundaryIndex,
  parameterOpen: number,
): SourceRange | undefined => {
  const parameterClose = boundary.closeByOpen.get(parameterOpen);
  if (parameterClose === undefined) {
    return undefined;
  }
  const bodyStart = bodyStartAfterParameters(source, parameterClose);
  if (bodyStart < 0 || bodyStart >= source.length) {
    return undefined;
  }
  const bodyEnd = bodyEndAt(source, boundary, bodyStart);
  if (bodyEnd < bodyStart) {
    return undefined;
  }
  return { end: bodyEnd, start: bodyStart };
};
