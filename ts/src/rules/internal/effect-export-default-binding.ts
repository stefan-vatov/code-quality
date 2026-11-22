import { CHAR_CLASS, CLS_DIGIT, CLS_LOWER, CLS_UNDER, CLS_UPPER } from './char-class';

const ASCII_CHARACTER_COUNT = 128;
const CHAR_CODE_ANGLE_CLOSE = 62;
const CHAR_CODE_ANGLE_OPEN = 60;
const CHAR_CODE_BRACE_CLOSE = 125;
const CHAR_CODE_BRACE_OPEN = 123;
const CHAR_CODE_BRACKET_CLOSE = 93;
const CHAR_CODE_BRACKET_OPEN = 91;
const CHAR_CODE_COMMA = 44;
const CHAR_CODE_DOLLAR = 36;
const CHAR_CODE_EQUALS = 61;
const CHAR_CODE_EXCLAMATION = 33;
const CHAR_CODE_PERCENT = 37;
const CHAR_CODE_PAREN_CLOSE = 41;
const CHAR_CODE_PAREN_OPEN = 40;
const CHAR_CODE_PIPE = 124;
const CHAR_CODE_QUESTION = 63;
const CHAR_CODE_SEMICOLON = 59;
const CHAR_CODE_SLASH = 47;
const CHAR_CODE_SPACE = 32;
const CHAR_CODE_STAR = 42;
const CHAR_CODE_AMPERSAND = 38;
const CHAR_CODE_PLUS = 43;
const IDENTIFIER_PART_MASK = CLS_UPPER | CLS_LOWER | CLS_DIGIT | CLS_UNDER;
const IDENTIFIER_START_MASK = CLS_UPPER | CLS_LOWER | CLS_UNDER;
const AS_TOKEN = 'as';
const SATISFIES_TOKEN = 'satisfies';
const delimiterDepthDeltas = new Int32Array(ASCII_CHARACTER_COUNT);
const valueOperatorCodes = new Uint8Array(ASCII_CHARACTER_COUNT);
delimiterDepthDeltas[CHAR_CODE_BRACE_OPEN] = 1;
delimiterDepthDeltas[CHAR_CODE_BRACE_CLOSE] = -1;
delimiterDepthDeltas[CHAR_CODE_BRACKET_OPEN] = 1;
delimiterDepthDeltas[CHAR_CODE_BRACKET_CLOSE] = -1;
delimiterDepthDeltas[CHAR_CODE_PAREN_OPEN] = 1;
delimiterDepthDeltas[CHAR_CODE_PAREN_CLOSE] = -1;
valueOperatorCodes[CHAR_CODE_COMMA] = 1;
valueOperatorCodes[CHAR_CODE_SEMICOLON] = 1;
valueOperatorCodes[CHAR_CODE_PLUS] = 1;
valueOperatorCodes[CHAR_CODE_STAR] = 1;
valueOperatorCodes[CHAR_CODE_SLASH] = 1;
valueOperatorCodes[CHAR_CODE_PERCENT] = 1;
valueOperatorCodes[CHAR_CODE_EXCLAMATION] = 1;

interface SourceRange {
  readonly end: number;
  readonly start: number;
}

interface WrapperParser {
  readonly matchingDelimiters: Int32Array;
  readonly source: string;
}

const isIdentifierStart = (charCode: number): boolean =>
  charCode === CHAR_CODE_DOLLAR || ((CHAR_CLASS[charCode] ?? 0) & IDENTIFIER_START_MASK) !== 0;

const isIdentifierPart = (charCode: number): boolean =>
  charCode === CHAR_CODE_DOLLAR || ((CHAR_CLASS[charCode] ?? 0) & IDENTIFIER_PART_MASK) !== 0;

const trimStart = (source: string, start: number, end: number): number => {
  let index = start;
  while (index < end && source.charCodeAt(index) <= CHAR_CODE_SPACE) {
    index += 1;
  }
  return index;
};

const trimEnd = (source: string, start: number, end: number): number => {
  let index = end;
  while (index > start && source.charCodeAt(index - 1) <= CHAR_CODE_SPACE) {
    index -= 1;
  }
  return index;
};

const trimmedRange = (source: string, range: SourceRange): SourceRange => {
  const start = trimStart(source, range.start, range.end);
  return { end: trimEnd(source, start, range.end), start };
};

const isDelimiterStart = (charCode: number): boolean =>
  charCode === CHAR_CODE_PAREN_OPEN ||
  charCode === CHAR_CODE_BRACKET_OPEN ||
  charCode === CHAR_CODE_BRACE_OPEN;

const delimiterEndCode = (charCode: number): number => {
  if (charCode === CHAR_CODE_PAREN_OPEN) {
    return CHAR_CODE_PAREN_CLOSE;
  }
  if (charCode === CHAR_CODE_BRACKET_OPEN) {
    return CHAR_CODE_BRACKET_CLOSE;
  }
  return CHAR_CODE_BRACE_CLOSE;
};

interface DelimiterStacks {
  readonly codes: number[];
  readonly indices: number[];
}

interface DelimiterPair {
  readonly end: number;
  readonly start: number;
}

const addDelimiterStart = (stacks: DelimiterStacks, charCode: number, index: number): boolean => {
  if (!isDelimiterStart(charCode)) {
    return false;
  }
  stacks.codes.push(charCode);
  stacks.indices.push(index);
  return true;
};

const takeDelimiterPair = (
  stacks: DelimiterStacks,
  charCode: number,
  index: number,
): DelimiterPair | undefined => {
  const delimiterCode = stacks.codes.at(-1);
  if (delimiterCode === undefined || charCode !== delimiterEndCode(delimiterCode)) {
    return undefined;
  }
  const delimiterIndex = stacks.indices.pop();
  stacks.codes.pop();
  if (delimiterIndex === undefined) {
    return undefined;
  }
  return { end: index, start: delimiterIndex };
};

const registerDelimiter = (
  stacks: DelimiterStacks,
  charCode: number,
  index: number,
): DelimiterPair | undefined => {
  if (addDelimiterStart(stacks, charCode, index)) {
    return undefined;
  }
  return takeDelimiterPair(stacks, charCode, index);
};

const matchingDelimiterIndex = (source: string): Int32Array => {
  const matchingDelimiters = new Int32Array(source.length);
  matchingDelimiters.fill(-1);
  const stacks: DelimiterStacks = { codes: [], indices: [] };
  for (let index = 0; index < source.length; index += 1) {
    const pair = registerDelimiter(stacks, source.charCodeAt(index), index);
    if (pair !== undefined) {
      matchingDelimiters[pair.start] = pair.end;
      matchingDelimiters[pair.end] = pair.start;
    }
  }
  return matchingDelimiters;
};

const stripTerminalSemicolon = (parser: WrapperParser, range: SourceRange): SourceRange => {
  const trimmed = trimmedRange(parser.source, range);
  if (parser.source.charCodeAt(trimmed.end - 1) !== CHAR_CODE_SEMICOLON) {
    return trimmed;
  }
  return trimmedRange(parser.source, { end: trimmed.end - 1, start: trimmed.start });
};

const unwrapOuterParentheses = (parser: WrapperParser, range: SourceRange): SourceRange => {
  let current = trimmedRange(parser.source, range);
  while (
    parser.source.charCodeAt(current.start) === CHAR_CODE_PAREN_OPEN &&
    parser.matchingDelimiters[current.start] === current.end - 1
  ) {
    current = trimmedRange(parser.source, {
      end: current.end - 1,
      start: current.start + 1,
    });
  }
  return current;
};

const stripNonNullAssertions = (parser: WrapperParser, range: SourceRange): SourceRange => {
  let current = trimmedRange(parser.source, range);
  while (parser.source.charCodeAt(current.end - 1) === CHAR_CODE_EXCLAMATION) {
    current = trimmedRange(parser.source, { end: current.end - 1, start: current.start });
  }
  return current;
};

const tokenAt = (source: string, range: SourceRange, index: number, token: string): boolean =>
  index + token.length <= range.end &&
  source.startsWith(token, index) &&
  !isIdentifierPart(source.charCodeAt(index - 1)) &&
  !isIdentifierPart(source.charCodeAt(index + token.length));

const topLevelAssertionIndex = (parser: WrapperParser, range: SourceRange): number => {
  let depths = 0;
  for (let index = range.start; index < range.end; index += 1) {
    if (
      depths === 0 &&
      (tokenAt(parser.source, range, index, AS_TOKEN) ||
        tokenAt(parser.source, range, index, SATISFIES_TOKEN))
    ) {
      return index;
    }
    depths += delimiterDepthDeltas[parser.source.charCodeAt(index)] ?? 0;
  }
  return -1;
};

const assertionTokenLength = (parser: WrapperParser, range: SourceRange, index: number): number => {
  if (tokenAt(parser.source, range, index, SATISFIES_TOKEN)) {
    return SATISFIES_TOKEN.length;
  }
  if (tokenAt(parser.source, range, index, AS_TOKEN)) {
    return AS_TOKEN.length;
  }
  return 0;
};

const tokenBefore = (source: string, index: number, token: string): boolean => {
  const tokenStart = index - token.length + 1;
  return (
    tokenStart >= 0 &&
    source.startsWith(token, tokenStart) &&
    !isIdentifierPart(source.charCodeAt(tokenStart - 1))
  );
};

const canPrecedeTypeParentheses = (source: string, index: number): boolean =>
  tokenBefore(source, index, 'import') ||
  tokenBefore(source, index, 'keyof') ||
  tokenBefore(source, index, 'new') ||
  tokenBefore(source, index, 'readonly') ||
  tokenBefore(source, index, 'typeof') ||
  tokenBefore(source, index, 'unique');

const isValueCallStart = (source: string, index: number, hasTypeContent: boolean): boolean => {
  if (!hasTypeContent || source.charCodeAt(index) !== CHAR_CODE_PAREN_OPEN) {
    return false;
  }
  const previousIndex = trimEnd(source, 0, index);
  if (previousIndex === 0) {
    return false;
  }
  const previousCode = source.charCodeAt(previousIndex - 1);
  return (
    (isIdentifierPart(previousCode) && !canPrecedeTypeParentheses(source, previousIndex - 1)) ||
    previousCode === CHAR_CODE_ANGLE_CLOSE ||
    previousCode === CHAR_CODE_PAREN_CLOSE
  );
};

const isArrowClose = (source: string, index: number): boolean =>
  source.charCodeAt(index - 1) === CHAR_CODE_EQUALS;

const TYPE_ASSERTION_DEPTH_UNIT = 65_536;
const TYPE_ASSERTION_DELIMITER_MASK = TYPE_ASSERTION_DEPTH_UNIT - 1;

const advanceTypeAssertionDepths = (
  parser: WrapperParser,
  index: number,
  depths: number,
): number => {
  const charCode = parser.source.charCodeAt(index);
  const delimiterDepth = depths & TYPE_ASSERTION_DELIMITER_MASK;
  if (delimiterDepth === 0 && charCode === CHAR_CODE_ANGLE_OPEN) {
    return depths + TYPE_ASSERTION_DEPTH_UNIT;
  }
  if (
    delimiterDepth === 0 &&
    charCode === CHAR_CODE_ANGLE_CLOSE &&
    !isArrowClose(parser.source, index)
  ) {
    return depths - TYPE_ASSERTION_DEPTH_UNIT;
  }
  return depths + (delimiterDepthDeltas[charCode] ?? 0);
};

const isTopLevelValueOperator = (
  source: string,
  index: number,
  hasConditionalExtends: boolean,
): boolean => {
  const charCode = source.charCodeAt(index);
  if (valueOperatorCodes[charCode] === 1) {
    return true;
  }
  if (charCode === CHAR_CODE_EQUALS) {
    return source.charCodeAt(index + 1) !== CHAR_CODE_ANGLE_CLOSE;
  }
  if (charCode === CHAR_CODE_QUESTION) {
    return !hasConditionalExtends;
  }
  const nextCode = source.charCodeAt(index + 1);
  return (
    (charCode === CHAR_CODE_PIPE && nextCode === CHAR_CODE_PIPE) ||
    (charCode === CHAR_CODE_AMPERSAND && nextCode === CHAR_CODE_AMPERSAND)
  );
};

const isExtendsToken = (parser: WrapperParser, range: SourceRange, index: number): boolean =>
  tokenAt(parser.source, range, index, 'extends');

interface AssertionSuffixState {
  readonly depths: number;
  readonly hasConditionalExtends: boolean;
  readonly hasTypeContent: boolean;
  readonly index: number;
}

const isAssertionOperatorPosition = (state: AssertionSuffixState, tokenLength: number): boolean =>
  state.depths === 0 && tokenLength > 0;

const canStartAssertionType = (state: AssertionSuffixState, range: SourceRange): boolean =>
  state.hasTypeContent || state.index === range.start;

const invalidAssertionSuffixToken = (parser: WrapperParser, state: AssertionSuffixState): boolean =>
  state.depths === 0 &&
  (isTopLevelValueOperator(parser.source, state.index, state.hasConditionalExtends) ||
    isValueCallStart(parser.source, state.index, state.hasTypeContent));

const advanceAssertionSuffix = (
  parser: WrapperParser,
  range: SourceRange,
  state: AssertionSuffixState,
): AssertionSuffixState | undefined => {
  const tokenLength = assertionTokenLength(parser, range, state.index);
  if (isAssertionOperatorPosition(state, tokenLength)) {
    if (canStartAssertionType(state, range)) {
      return {
        depths: 0,
        hasConditionalExtends: false,
        hasTypeContent: false,
        index: state.index + tokenLength,
      };
    }
    return undefined;
  }
  const charCode = parser.source.charCodeAt(state.index);
  const isWhitespace = charCode <= CHAR_CODE_SPACE;
  if (invalidAssertionSuffixToken(parser, state)) {
    return undefined;
  }
  return {
    depths: advanceTypeAssertionDepths(parser, state.index, state.depths),
    hasConditionalExtends:
      state.hasConditionalExtends ||
      (state.depths === 0 && isExtendsToken(parser, range, state.index)),
    hasTypeContent: state.hasTypeContent || !isWhitespace,
    index: state.index + 1,
  };
};

const hasTransparentAssertionSuffix = (
  parser: WrapperParser,
  assertionIndex: number,
  rangeEnd: number,
): boolean => {
  const range = { end: rangeEnd, start: assertionIndex };
  let state: AssertionSuffixState | undefined = {
    depths: 0,
    hasConditionalExtends: false,
    hasTypeContent: false,
    index: assertionIndex,
  };
  while (state !== undefined && state.index < rangeEnd) {
    state = advanceAssertionSuffix(parser, range, state);
  }
  return state !== undefined && state.depths === 0 && state.hasTypeContent;
};

const stripAssertion = (parser: WrapperParser, range: SourceRange): SourceRange | undefined => {
  const assertionIndex = topLevelAssertionIndex(parser, range);
  if (assertionIndex === -1) {
    return undefined;
  }
  if (!hasTransparentAssertionSuffix(parser, assertionIndex, range.end)) {
    return { end: range.start, start: range.start };
  }
  return trimmedRange(parser.source, { end: assertionIndex, start: range.start });
};

const typeAssertionEnd = (parser: WrapperParser, range: SourceRange): number => {
  let depths = 0;
  for (let index = range.start; index < range.end; index += 1) {
    depths = advanceTypeAssertionDepths(parser, index, depths);
    if (depths === 0) {
      return index;
    }
  }
  return -1;
};

const stripTypeAssertion = (parser: WrapperParser, range: SourceRange): SourceRange | undefined => {
  if (parser.source.charCodeAt(range.start) !== CHAR_CODE_ANGLE_OPEN) {
    return undefined;
  }
  const assertionEnd = typeAssertionEnd(parser, range);
  if (
    assertionEnd === -1 ||
    trimStart(parser.source, range.start + 1, assertionEnd) === assertionEnd
  ) {
    return { end: range.start, start: range.start };
  }
  return trimmedRange(parser.source, { end: range.end, start: assertionEnd + 1 });
};

const identifierName = (source: string, range: SourceRange): string | undefined => {
  if (range.start >= range.end || !isIdentifierStart(source.charCodeAt(range.start))) {
    return undefined;
  }
  let index = range.start + 1;
  while (index < range.end && isIdentifierPart(source.charCodeAt(index))) {
    index += 1;
  }
  if (index !== range.end) {
    return undefined;
  }
  return source.slice(range.start, range.end);
};

const nextTransparentRange = (
  parser: WrapperParser,
  range: SourceRange,
): SourceRange | undefined => {
  const parenthesesRange = unwrapOuterParentheses(parser, range);
  if (parenthesesRange.start !== range.start || parenthesesRange.end !== range.end) {
    return parenthesesRange;
  }
  const nonNullRange = stripNonNullAssertions(parser, range);
  if (nonNullRange.end !== range.end) {
    return nonNullRange;
  }
  const assertionRange = stripAssertion(parser, range);
  if (assertionRange !== undefined) {
    return assertionRange;
  }
  return stripTypeAssertion(parser, range);
};

const transparentBindingRange = (parser: WrapperParser, initialRange: SourceRange): SourceRange => {
  let range = initialRange;
  let nextRange = nextTransparentRange(parser, range);
  while (nextRange !== undefined && nextRange.start < nextRange.end) {
    range = nextRange;
    nextRange = nextTransparentRange(parser, range);
  }
  if (nextRange !== undefined) {
    return nextRange;
  }
  return range;
};

export const defaultExportBindingName = (expression: string): string | undefined => {
  const parser: WrapperParser = {
    matchingDelimiters: matchingDelimiterIndex(expression),
    source: expression,
  };
  const range = transparentBindingRange(
    parser,
    stripTerminalSemicolon(parser, { end: expression.length, start: 0 }),
  );
  return identifierName(expression, range);
};
