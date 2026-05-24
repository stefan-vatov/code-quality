/** @internal Maximum source line length helper used by the custom Oxlint plugin. */
interface LineLengthViolation {
  line: number;
  length: number;
}

interface LineCheck {
  lineEnd: number;
  lineNumber: number;
  lineStart: number;
  maxLength: number;
  source: string;
}

interface LineCursor {
  lineNumber: number;
  lineStart: number;
}

const DEFAULT_MAX_LENGTH = 150;
const CHAR_CODE_CARRIAGE_RETURN = 13;

const lineContainsURL = (source: string, start: number, end: number): boolean => {
  const httpIndex = source.indexOf('http://', start);
  if (httpIndex !== -1 && httpIndex < end) {
    return true;
  }

  const httpsIndex = source.indexOf('https://', start);
  return httpsIndex !== -1 && httpsIndex < end;
};

const nextLineEnd = (source: string, lineStart: number): number => {
  const newlineIndex = source.indexOf('\n', lineStart);
  if (newlineIndex === -1) {
    return source.length;
  }
  return newlineIndex;
};

const contentEndForLine = (source: string, lineStart: number, lineEnd: number): number => {
  if (lineEnd > lineStart && source.charCodeAt(lineEnd - 1) === CHAR_CODE_CARRIAGE_RETURN) {
    return lineEnd - 1;
  }
  return lineEnd;
};

const addLineViolation = (violations: LineLengthViolation[], check: LineCheck): void => {
  const { lineEnd, lineNumber, lineStart, maxLength, source } = check;
  const contentEnd = contentEndForLine(source, lineStart, lineEnd);
  const length = contentEnd - lineStart;
  if (length > maxLength && !lineContainsURL(source, lineStart, contentEnd)) {
    violations.push({ length, line: lineNumber });
  }
};

const nextLineStart = (lineEnd: number): number => lineEnd + 1;

const nextLineCursor = (cursor: LineCursor, lineEnd: number): LineCursor => ({
  lineNumber: cursor.lineNumber + 1,
  lineStart: nextLineStart(lineEnd),
});

const addCursorViolation = (
  violations: LineLengthViolation[],
  source: string,
  maxLength: number,
  cursor: LineCursor,
): number => {
  const lineEnd = nextLineEnd(source, cursor.lineStart);
  addLineViolation(violations, {
    lineEnd,
    lineNumber: cursor.lineNumber,
    lineStart: cursor.lineStart,
    maxLength,
    source,
  });
  return lineEnd;
};

/**
 * Finds source lines that exceed the configured maximum width.
 *
 * @param source - Source text to scan.
 * @param maxLength - Maximum allowed line width.
 * @returns Line-length violations with one-based line numbers.
 */
export default function findLongLines(
  source: string,
  maxLength = DEFAULT_MAX_LENGTH,
): LineLengthViolation[] {
  if (source.length <= maxLength) {
    return [];
  }

  const violations: LineLengthViolation[] = [];
  let cursor = { lineNumber: 1, lineStart: 0 };

  while (cursor.lineStart <= source.length) {
    const lineEnd = addCursorViolation(violations, source, maxLength, cursor);

    if (lineEnd === source.length) {
      break;
    }

    cursor = nextLineCursor(cursor, lineEnd);
  }

  return violations;
}
