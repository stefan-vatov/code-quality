const CHAR_CODE_CARRIAGE_RETURN = 13;
const CHAR_CODE_LINE_FEED = 10;
const CHAR_CODE_LINE_SEPARATOR = 8232;
const CHAR_CODE_PARAGRAPH_SEPARATOR = 8233;

export const isLineTerminatorCode = (charCode: number): boolean =>
  charCode === CHAR_CODE_LINE_FEED ||
  charCode === CHAR_CODE_CARRIAGE_RETURN ||
  charCode === CHAR_CODE_LINE_SEPARATOR ||
  charCode === CHAR_CODE_PARAGRAPH_SEPARATOR;

export const findLineTerminatorIndex = (source: string, startIndex: number): number => {
  for (let index = startIndex; index < source.length; index += 1) {
    if (isLineTerminatorCode(source.charCodeAt(index))) {
      return index;
    }
  }
  return source.length;
};

export const indexAfterLineTerminator = (source: string, index: number): number => {
  if (source.charCodeAt(index) === CHAR_CODE_CARRIAGE_RETURN) {
    if (source.charCodeAt(index + 1) === CHAR_CODE_LINE_FEED) {
      return index + 2;
    }
    return index + 1;
  }
  if (isLineTerminatorCode(source.charCodeAt(index))) {
    return index + 1;
  }
  return index;
};
