/* -------------------------------------------------------------------------- */
/*           Allocation-free ECMAScript line-terminator primitives.           */
/* -------------------------------------------------------------------------- */

const CHAR_CODE_CARRIAGE_RETURN = 13;
const CHAR_CODE_LINE_FEED = 10;
const CHAR_CODE_LINE_SEPARATOR = 8232;
const CHAR_CODE_PARAGRAPH_SEPARATOR = 8233;

/**
 * Check whether a code unit is an ECMAScript line terminator.
 *
 * @param charCode - UTF-16 code unit to inspect.
 * @returns Whether the code unit terminates a source line.
 * @throws Does not throw.
 * @internal
 */
export const isLineTerminatorCode = (charCode: number): boolean =>
  charCode === CHAR_CODE_LINE_FEED ||
  charCode === CHAR_CODE_CARRIAGE_RETURN ||
  charCode === CHAR_CODE_LINE_SEPARATOR ||
  charCode === CHAR_CODE_PARAGRAPH_SEPARATOR;

/**
 * Find the first line-terminator code unit at or after an offset.
 *
 * @param source - Complete source text.
 * @param startIndex - Offset from which to scan.
 * @returns The first terminator offset, or the source length at EOF.
 * @throws Does not throw.
 * @internal
 */
export const findLineTerminatorIndex = (source: string, startIndex: number): number => {
  for (let index = startIndex; index < source.length; index += 1) {
    if (isLineTerminatorCode(source.charCodeAt(index))) {
      return index;
    }
  }
  return source.length;
};

/**
 * Advance past one line terminator, treating CRLF as one boundary.
 *
 * @param source - Complete source text.
 * @param index - Offset at the first terminator code unit.
 * @returns The first offset after the boundary, or the unchanged offset.
 * @throws Does not throw.
 * @internal
 */
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
