/* -------------------------------------------------------------------------- */
/*            Regex literal scanning primitives for source rules.             */
/* -------------------------------------------------------------------------- */
import { CHAR_CLASS, CLS_LOWER, CLS_UPPER } from './char-class';

const CHAR_CODE_BACKSLASH = 92;
const CHAR_CODE_BRACKET_CLOSE = 93;
const CHAR_CODE_BRACKET_OPEN = 91;
const CHAR_CODE_CARRIAGE_RETURN = 13;
const CHAR_CODE_LINE_FEED = 10;
const CHAR_CODE_SLASH = 47;
const CHAR_CODE_UNICODE_LINE_SEPARATOR = '\u2028'.charCodeAt(0);
const CHAR_CODE_UNICODE_PARAGRAPH_SEPARATOR = '\u2029'.charCodeAt(0);
const SINGLE_CHARACTER_LENGTH = 1;

type REGEXScanStep = 'close-class' | 'continue' | 'end' | 'escape' | 'line' | 'open-class';

const isASCIILetter = (source: string, index: number): boolean => {
  const code = source.charCodeAt(index);
  return code < CHAR_CLASS.length && (CHAR_CLASS[code] & (CLS_UPPER | CLS_LOWER)) !== 0;
};

const isLineTerminator = (charCode: number): boolean =>
  charCode === CHAR_CODE_LINE_FEED ||
  charCode === CHAR_CODE_CARRIAGE_RETURN ||
  charCode === CHAR_CODE_UNICODE_LINE_SEPARATOR ||
  charCode === CHAR_CODE_UNICODE_PARAGRAPH_SEPARATOR;

const regexFlagsEndIndex = (source: string, index: number): number => {
  let flagsEndIndex = index;
  while (isASCIILetter(source, flagsEndIndex + SINGLE_CHARACTER_LENGTH)) {
    flagsEndIndex += SINGLE_CHARACTER_LENGTH;
  }
  return flagsEndIndex;
};

const scanREGEXBoundary = (
  charCode: number,
  isEscaped: boolean,
  isCharacterClass: boolean,
): REGEXScanStep | undefined => {
  if (isLineTerminator(charCode)) {
    return 'line';
  }
  if (!isEscaped && charCode === CHAR_CODE_SLASH && !isCharacterClass) {
    return 'end';
  }
  return undefined;
};

const scanREGEXClassCharacter = (charCode: number): REGEXScanStep => {
  if (charCode === CHAR_CODE_BACKSLASH) {
    return 'escape';
  }
  if (charCode === CHAR_CODE_BRACKET_OPEN) {
    return 'open-class';
  }
  if (charCode === CHAR_CODE_BRACKET_CLOSE) {
    return 'close-class';
  }
  return 'continue';
};

const scanREGEXCharacter = (
  charCode: number,
  isEscaped: boolean,
  isCharacterClass: boolean,
): REGEXScanStep => {
  const boundary = scanREGEXBoundary(charCode, isEscaped, isCharacterClass);
  if (boundary !== undefined) {
    return boundary;
  }
  if (isEscaped) {
    return 'continue';
  }
  return scanREGEXClassCharacter(charCode);
};

const nextREGEXCharacterClass = (step: REGEXScanStep, isCharacterClass: boolean): boolean => {
  if (step === 'open-class') {
    return true;
  }
  if (step === 'close-class') {
    return false;
  }
  return isCharacterClass;
};

const regexEndForStep = (
  source: string,
  startIndex: number,
  index: number,
  step: REGEXScanStep,
): number | undefined => {
  if (step === 'line') {
    return startIndex;
  }
  if (step === 'end') {
    return regexFlagsEndIndex(source, index);
  }
  return undefined;
};

/**
 * Find the closing slash and flags for a regex literal without inspecting source twice.
 *
 * @param source - Complete source text.
 * @param startIndex - Offset of the opening slash.
 * @returns The final flag offset, or `startIndex` when no literal closes on the line.
 * @throws Does not throw.
 * @internal
 */
export const scanREGEXLiteralEnd = (source: string, startIndex: number): number => {
  let isCharacterClass = false;
  let isEscaped = false;
  for (
    let index = startIndex + SINGLE_CHARACTER_LENGTH;
    index < source.length;
    index += SINGLE_CHARACTER_LENGTH
  ) {
    const step = scanREGEXCharacter(source.charCodeAt(index), isEscaped, isCharacterClass);
    const endIndex = regexEndForStep(source, startIndex, index, step);
    if (endIndex !== undefined) {
      return endIndex;
    }
    isEscaped = step === 'escape';
    isCharacterClass = nextREGEXCharacterClass(step, isCharacterClass);
  }
  return startIndex;
};
