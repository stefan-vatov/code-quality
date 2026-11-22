const CHAR_CODE_BRACE_CLOSE = 125,
  CHAR_CODE_BRACE_OPEN = 123;
const CHAR_CODE_BRACKET_CLOSE = 93,
  CHAR_CODE_BRACKET_OPEN = 91;
const CHAR_CODE_COMMA = 44;
const CHAR_CODE_DIGIT_NINE = 57,
  CHAR_CODE_DIGIT_ZERO = 48;
const CHAR_CODE_PAREN_CLOSE = 41,
  CHAR_CODE_PAREN_OPEN = 40;
const CHAR_CODE_ASTERISK = 42,
  CHAR_CODE_BACKSLASH = 92,
  CHAR_CODE_BACKTICK = 96;
const CHAR_CODE_CARRIAGE_RETURN = 13,
  CHAR_CODE_DOLLAR = 36,
  CHAR_CODE_DOUBLE_QUOTE = 34;
const CHAR_CODE_LINE_FEED = 10,
  CHAR_CODE_LOWER_A = 97,
  CHAR_CODE_LOWER_Z = 122;
const CHAR_CODE_SINGLE_QUOTE = 39,
  CHAR_CODE_SLASH = 47,
  CHAR_CODE_SPACE = 32;
const CHAR_CODE_UNDERSCORE = 95,
  CHAR_CODE_UPPER_A = 65,
  CHAR_CODE_UPPER_Z = 90;
const CODE_MODE = 0,
  TEMPLATE_MODE = 1;

interface PatternDelimiterIndex {
  readonly matchingEnds: Int32Array;
  readonly skippedEnds: Int32Array;
}
const isIdentifierPart = (charCode: number): boolean =>
  isIdentifierStart(charCode) ||
  (charCode >= CHAR_CODE_DIGIT_ZERO && charCode <= CHAR_CODE_DIGIT_NINE);

const isIdentifierStart = (charCode: number): boolean =>
  (charCode >= CHAR_CODE_UPPER_A && charCode <= CHAR_CODE_UPPER_Z) ||
  (charCode >= CHAR_CODE_LOWER_A && charCode <= CHAR_CODE_LOWER_Z) ||
  charCode === CHAR_CODE_DOLLAR ||
  charCode === CHAR_CODE_UNDERSCORE;
const isOpeningDelimiter = (charCode: number): boolean =>
  charCode === CHAR_CODE_BRACE_OPEN ||
  charCode === CHAR_CODE_BRACKET_OPEN ||
  charCode === CHAR_CODE_PAREN_OPEN;

const openingDelimiterFor = (charCode: number): number => {
  if (charCode === CHAR_CODE_BRACE_CLOSE) {
    return CHAR_CODE_BRACE_OPEN;
  }
  if (charCode === CHAR_CODE_BRACKET_CLOSE) {
    return CHAR_CODE_BRACKET_OPEN;
  }
  return CHAR_CODE_PAREN_OPEN;
};
const isLineBreak = (charCode: number): boolean =>
  charCode === CHAR_CODE_LINE_FEED || charCode === CHAR_CODE_CARRIAGE_RETURN;

const nextNonWhitespaceIndex = (code: string, startIndex: number): number => {
  let index = startIndex;
  while (index < code.length && code.charCodeAt(index) <= CHAR_CODE_SPACE) {
    index += 1;
  }
  return index;
};
const nextQuotedIndex = (index: number, charCode: number): number => {
  if (charCode === CHAR_CODE_BACKSLASH) {
    return index + 2;
  }
  return index + 1;
};
const quotedLiteralEnd = (code: string, startIndex: number, endIndex: number): number => {
  const quoteCode = code.charCodeAt(startIndex);
  let index = startIndex + 1;
  while (index < endIndex) {
    const charCode = code.charCodeAt(index);
    if (charCode === quoteCode) {
      return index + 1;
    }
    if (charCode !== CHAR_CODE_BACKSLASH && isLineBreak(charCode)) {
      return index;
    }
    index = nextQuotedIndex(index, charCode);
  }
  return endIndex;
};
const lineCommentEnd = (code: string, startIndex: number, endIndex: number): number => {
  let index = startIndex + 2;
  while (index < endIndex && !isLineBreak(code.charCodeAt(index))) {
    index += 1;
  }
  return index;
};
const blockCommentEnd = (code: string, startIndex: number, endIndex: number): number => {
  let index = startIndex + 2;
  while (index + 1 < endIndex) {
    const isTerminator =
      code.charCodeAt(index) === CHAR_CODE_ASTERISK &&
      code.charCodeAt(index + 1) === CHAR_CODE_SLASH;
    if (isTerminator) {
      return index + 2;
    }
    index += 1;
  }
  return endIndex;
};
const commentEnd = (code: string, startIndex: number, endIndex: number): number => {
  const nextCode = code.charCodeAt(startIndex + 1);
  if (nextCode === CHAR_CODE_SLASH) {
    return lineCommentEnd(code, startIndex, endIndex);
  }
  if (nextCode === CHAR_CODE_ASTERISK) {
    return blockCommentEnd(code, startIndex, endIndex);
  }
  return startIndex;
};
interface TemplateDelimiter {
  readonly isInterpolation: boolean;
  readonly openingCode: number;
}
type TemplateStep = readonly [number, number, boolean];

const templateCloseStep = (index: number, returnModes: number[]): TemplateStep => {
  if (returnModes.length === 0) {
    return [index + 1, TEMPLATE_MODE, true];
  }
  return [index + 1, returnModes.pop() ?? CODE_MODE, false];
};

const matchingTemplateDelimiterIndex = (
  stack: readonly TemplateDelimiter[],
  closingCode: number,
): number => {
  const expectedOpeningCode = openingDelimiterFor(closingCode);
  let index = stack.length - 1;
  while (index >= 0 && stack[index]?.openingCode !== expectedOpeningCode) {
    index -= 1;
  }
  return index;
};

const closeTemplateDelimiter = (stack: TemplateDelimiter[], closingCode: number): boolean => {
  const matchingIndex = matchingTemplateDelimiterIndex(stack, closingCode);
  if (matchingIndex < 0) {
    return false;
  }
  let isClosingInterpolation = false;
  while (stack.length > matchingIndex) {
    const frame = stack.pop();
    isClosingInterpolation ||= frame?.isInterpolation === true;
  }
  return isClosingInterpolation;
};

const templateTextStep = (
  code: string,
  index: number,
  returnModes: number[],
  delimiterStack: TemplateDelimiter[],
): TemplateStep => {
  const charCode = code.charCodeAt(index);
  if (charCode === CHAR_CODE_BACKSLASH) {
    return [index + 2, TEMPLATE_MODE, false];
  }
  if (charCode === CHAR_CODE_BACKTICK) {
    return templateCloseStep(index, returnModes);
  }
  if (charCode === CHAR_CODE_DOLLAR && code.charCodeAt(index + 1) === CHAR_CODE_BRACE_OPEN) {
    delimiterStack.push({ isInterpolation: true, openingCode: CHAR_CODE_BRACE_OPEN });
    return [index + 2, CODE_MODE, false];
  }
  return [index + 1, TEMPLATE_MODE, false];
};

const templateClosingStep = (
  index: number,
  charCode: number,
  delimiterStack: TemplateDelimiter[],
): TemplateStep => {
  const isClosingInterpolation = closeTemplateDelimiter(delimiterStack, charCode);
  if (isClosingInterpolation) {
    return [index + 1, TEMPLATE_MODE, false];
  }
  return [index + 1, CODE_MODE, false];
};

const templateDelimiterStep = (
  index: number,
  charCode: number,
  returnModes: number[],
  delimiterStack: TemplateDelimiter[],
): TemplateStep => {
  if (charCode === CHAR_CODE_BACKTICK) {
    returnModes.push(CODE_MODE);
    return [index + 1, TEMPLATE_MODE, false];
  }
  if (isOpeningDelimiter(charCode)) {
    delimiterStack.push({ isInterpolation: false, openingCode: charCode });
    return [index + 1, CODE_MODE, false];
  }
  if (isClosingDelimiter(charCode)) {
    return templateClosingStep(index, charCode, delimiterStack);
  }
  return [index + 1, CODE_MODE, false];
};

const templateCodeStep = (
  code: string,
  index: number,
  endIndex: number,
  returnModes: number[],
  delimiterStack: TemplateDelimiter[],
): TemplateStep => {
  const charCode = code.charCodeAt(index);
  if (charCode === CHAR_CODE_SINGLE_QUOTE || charCode === CHAR_CODE_DOUBLE_QUOTE) {
    return [quotedLiteralEnd(code, index, endIndex), CODE_MODE, false];
  }
  const skippedEnd = commentEnd(code, index, endIndex);
  if (skippedEnd > index) {
    return [skippedEnd, CODE_MODE, false];
  }
  return templateDelimiterStep(index, charCode, returnModes, delimiterStack);
};

interface TemplateState {
  readonly code: string;
  readonly delimiterStack: TemplateDelimiter[];
  readonly endIndex: number;
  readonly returnModes: number[];
}

const templateStep = (state: TemplateState, index: number, mode: number): TemplateStep => {
  if (mode === TEMPLATE_MODE) {
    return templateTextStep(state.code, index, state.returnModes, state.delimiterStack);
  }
  return templateCodeStep(
    state.code,
    index,
    state.endIndex,
    state.returnModes,
    state.delimiterStack,
  );
};

const templateLiteralEnd = (code: string, startIndex: number, endIndex: number): number => {
  const state: TemplateState = {
    code,
    delimiterStack: [],
    endIndex,
    returnModes: [],
  };
  let index = startIndex + 1;
  let mode = TEMPLATE_MODE;
  while (index < endIndex) {
    const [nextIndex, nextMode, isComplete] = templateStep(state, index, mode);
    if (isComplete) {
      return nextIndex;
    }
    index = nextIndex;
    mode = nextMode;
  }
  return endIndex;
};

const lexicalEnd = (code: string, startIndex: number, endIndex: number): number => {
  const charCode = code.charCodeAt(startIndex);
  if (charCode === CHAR_CODE_SINGLE_QUOTE || charCode === CHAR_CODE_DOUBLE_QUOTE) {
    return quotedLiteralEnd(code, startIndex, endIndex);
  }
  if (charCode === CHAR_CODE_BACKTICK) {
    return templateLiteralEnd(code, startIndex, endIndex);
  }
  if (charCode === CHAR_CODE_SLASH) {
    return commentEnd(code, startIndex, endIndex);
  }
  return startIndex;
};

const nextPatternTokenIndex = (code: string, startIndex: number, endIndex: number): number => {
  let index = nextNonWhitespaceIndex(code, startIndex);
  while (index < endIndex) {
    const skippedEnd = commentEnd(code, index, endIndex);
    if (skippedEnd <= index) {
      return index;
    }
    index = nextNonWhitespaceIndex(code, skippedEnd);
  }
  return index;
};

const identifierEnd = (code: string, startIndex: number): number => {
  let index = startIndex;
  while (index < code.length && isIdentifierPart(code.charCodeAt(index))) {
    index += 1;
  }
  return index;
};

interface DelimiterFrame {
  readonly openingCode: number;
  readonly startIndex: number;
}

const matchingDelimiterIndex = (stack: readonly DelimiterFrame[], closingCode: number): number => {
  const expectedOpeningCode = openingDelimiterFor(closingCode);
  let index = stack.length - 1;
  while (index >= 0 && stack[index]?.openingCode !== expectedOpeningCode) {
    index -= 1;
  }
  return index;
};

const closeDelimiterStack = (stack: DelimiterFrame[], closingCode: number): boolean => {
  const matchingIndex = matchingDelimiterIndex(stack, closingCode);
  if (matchingIndex < 0) {
    return false;
  }
  while (stack.length > matchingIndex) {
    stack.pop();
  }
  return stack.length === 0;
};

const isClosingDelimiter = (charCode: number): boolean =>
  charCode === CHAR_CODE_BRACE_CLOSE ||
  charCode === CHAR_CODE_BRACKET_CLOSE ||
  charCode === CHAR_CODE_PAREN_CLOSE;

const PATTERN_CLOSED = -1;

const delimitedPatternStep = (
  code: string,
  index: number,
  delimiterStack: DelimiterFrame[],
): number => {
  const skippedEnd = lexicalEnd(code, index, code.length);
  if (skippedEnd > index) {
    return skippedEnd;
  }
  const charCode = code.charCodeAt(index);
  if (isOpeningDelimiter(charCode)) {
    delimiterStack.push({ openingCode: charCode, startIndex: index });
  } else if (isClosingDelimiter(charCode) && closeDelimiterStack(delimiterStack, charCode)) {
    return PATTERN_CLOSED;
  }
  return index + 1;
};

const delimitedPatternEnd = (code: string, startIndex: number, openingCode: number): number => {
  const delimiterStack: DelimiterFrame[] = [{ openingCode, startIndex }];
  let index = startIndex + 1;
  while (index < code.length) {
    const nextIndex = delimitedPatternStep(code, index, delimiterStack);
    if (nextIndex === PATTERN_CLOSED) {
      return index + 1;
    }
    index = nextIndex;
  }
  return code.length;
};

const bindingPatternEnd = (code: string, startIndex: number): number => {
  const patternStart = nextPatternTokenIndex(code, startIndex, code.length);
  const firstCode = code.charCodeAt(patternStart);
  if (firstCode === CHAR_CODE_BRACE_OPEN || firstCode === CHAR_CODE_BRACKET_OPEN) {
    return delimitedPatternEnd(code, patternStart, firstCode);
  }
  return identifierEnd(code, patternStart);
};

const closeIndexedDelimiter = (
  stack: DelimiterFrame[],
  matchingEnds: Int32Array,
  closingCode: number,
  closeIndex: number,
): void => {
  const matchingIndex = matchingDelimiterIndex(stack, closingCode);
  if (matchingIndex < 0) {
    return;
  }
  const ends = matchingEnds;
  while (stack.length > matchingIndex) {
    const frame = stack.pop();
    if (frame !== undefined) {
      ends[frame.startIndex] = closeIndex + 1;
    }
  }
};

interface PatternScanState {
  readonly code: string;
  readonly endIndex: number;
  readonly matchingEnds: Int32Array;
  readonly skippedEnds: Int32Array;
  readonly delimiterStack: DelimiterFrame[];
}

const scanDelimiterIndexStep = (state: PatternScanState, index: number): number => {
  const { code, delimiterStack, endIndex, matchingEnds, skippedEnds } = state;
  const charCode = code.charCodeAt(index);
  const skippedEnd = lexicalEnd(code, index, endIndex);
  if (skippedEnd > index) {
    skippedEnds[index] = skippedEnd;
    return skippedEnd;
  }
  if (isOpeningDelimiter(charCode)) {
    delimiterStack.push({ openingCode: charCode, startIndex: index });
  } else if (isClosingDelimiter(charCode)) {
    closeIndexedDelimiter(delimiterStack, matchingEnds, charCode, index);
  }
  return index + 1;
};

const createPatternDelimiterIndex = (
  code: string,
  startIndex: number,
  endIndex: number,
): PatternDelimiterIndex => {
  const state: PatternScanState = {
    code,
    delimiterStack: [],
    endIndex,
    matchingEnds: new Int32Array(code.length),
    skippedEnds: new Int32Array(code.length),
  };
  let index = startIndex;
  while (index < endIndex) {
    index = scanDelimiterIndexStep(state, index);
  }
  for (const frame of state.delimiterStack) {
    state.matchingEnds[frame.startIndex] = endIndex;
  }
  return { matchingEnds: state.matchingEnds, skippedEnds: state.skippedEnds };
};

const indexedPatternEnd = (
  delimiterIndex: PatternDelimiterIndex,
  startIndex: number,
  endIndex: number,
): number => {
  const indexedEnd = delimiterIndex.matchingEnds[startIndex] ?? 0;
  if (indexedEnd > startIndex) {
    return Math.min(indexedEnd, endIndex);
  }
  return endIndex;
};

const nextIndexedPatternIndex = (
  delimiterIndex: PatternDelimiterIndex,
  index: number,
  endIndex: number,
): number => {
  const skippedEnd = delimiterIndex.skippedEnds[index] ?? 0;
  if (skippedEnd > index) {
    return Math.min(skippedEnd, endIndex);
  }
  const nestedEnd = delimiterIndex.matchingEnds[index] ?? 0;
  if (nestedEnd > index) {
    return Math.min(nestedEnd, endIndex);
  }
  return index + 1;
};

const patternEntryEnd = (
  code: string,
  delimiterIndex: PatternDelimiterIndex,
  startIndex: number,
  endIndex: number,
): number => {
  let index = startIndex;
  while (index < endIndex) {
    if (code.charCodeAt(index) === CHAR_CODE_COMMA) {
      return index;
    }
    index = nextIndexedPatternIndex(delimiterIndex, index, endIndex);
  }
  return endIndex;
};

export const bindingPatternIndex = {
  bindingPatternEnd,
  createPatternDelimiterIndex,
  identifierEnd,
  indexedPatternEnd,
  isIdentifierStart,
  nextIndexedPatternIndex,
  nextPatternTokenIndex,
  patternEntryEnd,
} as const;
