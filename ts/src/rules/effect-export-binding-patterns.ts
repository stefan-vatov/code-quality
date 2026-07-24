/* -------------------------------------------------------------------------- */
/*           TypeScript binding-pattern names for export indexing.            */
/* -------------------------------------------------------------------------- */

const ASCII_CHARACTER_COUNT = 128;
const BRACE_DEPTH_UNIT = 65_536;
const BRACKET_DEPTH_UNIT = 256;
const PAREN_DEPTH_UNIT = 1;
const CHAR_CODE_BRACE_CLOSE = 125;
const CHAR_CODE_BRACE_OPEN = 123;
const CHAR_CODE_BRACKET_CLOSE = 93;
const CHAR_CODE_BRACKET_OPEN = 91;
const CHAR_CODE_COLON = 58;
const CHAR_CODE_COMMA = 44;
const CHAR_CODE_DIGIT_NINE = 57;
const CHAR_CODE_DIGIT_ZERO = 48;
const CHAR_CODE_DOLLAR = 36;
const CHAR_CODE_DOT = 46;
const CHAR_CODE_LOWER_A = 97;
const CHAR_CODE_LOWER_Z = 122;
const CHAR_CODE_PAREN_CLOSE = 41;
const CHAR_CODE_PAREN_OPEN = 40;
const CHAR_CODE_SPACE = 32;
const CHAR_CODE_UNDERSCORE = 95;
const CHAR_CODE_UPPER_A = 65;
const CHAR_CODE_UPPER_Z = 90;
const REST_DOT_COUNT = 3;
const delimiterDepthDeltas = new Int32Array(ASCII_CHARACTER_COUNT);
delimiterDepthDeltas[CHAR_CODE_BRACE_OPEN] = BRACE_DEPTH_UNIT;
delimiterDepthDeltas[CHAR_CODE_BRACE_CLOSE] = -BRACE_DEPTH_UNIT;
delimiterDepthDeltas[CHAR_CODE_BRACKET_OPEN] = BRACKET_DEPTH_UNIT;
delimiterDepthDeltas[CHAR_CODE_BRACKET_CLOSE] = -BRACKET_DEPTH_UNIT;
delimiterDepthDeltas[CHAR_CODE_PAREN_OPEN] = PAREN_DEPTH_UNIT;
delimiterDepthDeltas[CHAR_CODE_PAREN_CLOSE] = -PAREN_DEPTH_UNIT;

const isIdentifierStart = (charCode: number): boolean =>
  (charCode >= CHAR_CODE_UPPER_A && charCode <= CHAR_CODE_UPPER_Z) ||
  (charCode >= CHAR_CODE_LOWER_A && charCode <= CHAR_CODE_LOWER_Z) ||
  charCode === CHAR_CODE_DOLLAR ||
  charCode === CHAR_CODE_UNDERSCORE;

const isIdentifierPart = (charCode: number): boolean =>
  isIdentifierStart(charCode) ||
  (charCode >= CHAR_CODE_DIGIT_ZERO && charCode <= CHAR_CODE_DIGIT_NINE);

const nextNonWhitespaceIndex = (code: string, startIndex: number): number => {
  let index = startIndex;
  while (index < code.length && code.charCodeAt(index) <= CHAR_CODE_SPACE) {
    index += 1;
  }
  return index;
};

const closingPatternCode = (openingCode: number): number => {
  if (openingCode === CHAR_CODE_BRACE_OPEN) {
    return CHAR_CODE_BRACE_CLOSE;
  }
  return CHAR_CODE_BRACKET_CLOSE;
};

const delimitedPatternEnd = (code: string, startIndex: number, openingCode: number): number => {
  const closingCode = closingPatternCode(openingCode);
  let depth = 1;
  for (let index = startIndex + 1; index < code.length; index += 1) {
    const charCode = code.charCodeAt(index);
    depth += Number(charCode === openingCode);
    depth -= Number(charCode === closingCode);
    if (depth === 0) {
      return index + 1;
    }
  }
  return code.length;
};

const identifierEnd = (code: string, startIndex: number): number => {
  let index = startIndex;
  while (index < code.length && isIdentifierPart(code.charCodeAt(index))) {
    index += 1;
  }
  return index;
};

/**
 * Finds the end-exclusive range of an identifier or destructuring binding pattern.
 */
export const bindingPatternEnd = (code: string, startIndex: number): number => {
  const firstCode = code.charCodeAt(startIndex);
  if (firstCode === CHAR_CODE_BRACE_OPEN || firstCode === CHAR_CODE_BRACKET_OPEN) {
    return delimitedPatternEnd(code, startIndex, firstCode);
  }
  return identifierEnd(code, startIndex);
};

const restBindingStart = (code: string, startIndex: number): number => {
  if (code.charCodeAt(startIndex) === CHAR_CODE_DOT) {
    return nextNonWhitespaceIndex(code, startIndex + REST_DOT_COUNT);
  }
  return startIndex;
};

const patternEntryEnd = (code: string, startIndex: number, endIndex: number): number => {
  let depths = 0;
  for (let index = startIndex; index < endIndex; index += 1) {
    const charCode = code.charCodeAt(index);
    if (charCode === CHAR_CODE_COMMA && depths === 0) {
      return index;
    }
    depths += delimiterDepthDeltas[charCode] ?? 0;
  }
  return endIndex;
};

const addDelimitedPatternBindings = (
  code: string,
  startIndex: number,
  endIndex: number,
  isObjectPattern: boolean,
  names: string[],
): void => {
  let index = startIndex + 1;
  while (index < endIndex - 1) {
    const entryEnd = patternEntryEnd(code, index, endIndex - 1);
    addPatternEntryBindings(code, index, entryEnd, isObjectPattern, names);
    index = entryEnd + 1;
  }
};

const addPatternBindings = (
  code: string,
  startIndex: number,
  endIndex: number,
  names: string[],
): void => {
  const firstCode = code.charCodeAt(startIndex);
  if (isIdentifierStart(firstCode)) {
    names.push(code.slice(startIndex, bindingPatternEnd(code, startIndex)));
    return;
  }
  if (firstCode !== CHAR_CODE_BRACE_OPEN && firstCode !== CHAR_CODE_BRACKET_OPEN) {
    return;
  }
  addDelimitedPatternBindings(
    code,
    startIndex,
    endIndex,
    firstCode === CHAR_CODE_BRACE_OPEN,
    names,
  );
};

const addObjectPatternEntry = (
  code: string,
  startIndex: number,
  endIndex: number,
  names: string[],
): void => {
  const identifierStart = restBindingStart(code, nextNonWhitespaceIndex(code, startIndex));
  if (!isIdentifierStart(code.charCodeAt(identifierStart))) {
    return;
  }
  const nameEnd = Math.min(identifierEnd(code, identifierStart), endIndex);
  const separatorIndex = nextNonWhitespaceIndex(code, nameEnd);
  if (code.charCodeAt(separatorIndex) === CHAR_CODE_COLON) {
    const valueStart = nextNonWhitespaceIndex(code, separatorIndex + 1);
    addPatternBindings(code, valueStart, bindingPatternEnd(code, valueStart), names);
    return;
  }
  names.push(code.slice(identifierStart, nameEnd));
};

const addPatternEntryBindings = (
  code: string,
  startIndex: number,
  endIndex: number,
  isObjectPattern: boolean,
  names: string[],
): void => {
  if (isObjectPattern) {
    addObjectPatternEntry(code, startIndex, endIndex, names);
    return;
  }
  const patternStart = restBindingStart(code, nextNonWhitespaceIndex(code, startIndex));
  addPatternBindings(code, patternStart, bindingPatternEnd(code, patternStart), names);
};

/**
 * Collects every local binding name owned by one binding pattern.
 */
export const bindingPatternNames = (
  code: string,
  startIndex: number,
  endIndex: number,
): readonly string[] => {
  const names: string[] = [];
  addPatternBindings(code, startIndex, endIndex, names);
  return names;
};
