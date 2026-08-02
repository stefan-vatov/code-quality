/* -------------------------------------------------------------------------- */
/*    Maximum source line length helper used by the custom Oxlint plugin.     */
/* -------------------------------------------------------------------------- */
import { Match, Option } from 'effect';

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
const URL_PROTOCOL_PATTERN = /https?:\/\//;

const lineContainsURL = (source: string, start: number, end: number): boolean => {
  const line = source.slice(start, end);
  return URL_PROTOCOL_PATTERN.test(line);
};

const nextLineEnd = (source: string, lineStart: number): number => {
  const newlineIndex = source.indexOf('\n', lineStart);
  return Match.value(newlineIndex).pipe(
    Match.when(
      (index): boolean => index === -1,
      (): number => source.length,
    ),
    Match.orElse((index): number => index),
  );
};

const contentEndForLine = (source: string, lineStart: number, lineEnd: number): number =>
  Match.value(lineEnd).pipe(
    Match.when(
      (end): boolean => end > lineStart && source.charCodeAt(end - 1) === CHAR_CODE_CARRIAGE_RETURN,
      (end): number => end - 1,
    ),
    Match.orElse((end): number => end),
  );

const lineViolationForCheck = (check: LineCheck): Option.Option<LineLengthViolation> => {
  const { lineEnd, lineNumber, lineStart, maxLength, source } = check;
  const contentEnd = contentEndForLine(source, lineStart, lineEnd);
  const length = contentEnd - lineStart;
  return Match.value(length).pipe(
    Match.when(
      (lineLength): boolean =>
        lineLength > maxLength && !lineContainsURL(source, lineStart, contentEnd),
      (lineLength): Option.Option<LineLengthViolation> =>
        Option.some({ length: lineLength, line: lineNumber }),
    ),
    Match.orElse((): Option.Option<LineLengthViolation> => Option.none()),
  );
};

const nextLineStart = (lineEnd: number): number => lineEnd + 1;

const nextLineCursor = (cursor: LineCursor, lineEnd: number): LineCursor => ({
  lineNumber: cursor.lineNumber + 1,
  lineStart: nextLineStart(lineEnd),
});

const appendCursorViolation = (
  violations: LineLengthViolation[],
  source: string,
  maxLength: number,
  cursor: LineCursor,
  lineEnd: number,
): void => {
  const violation = lineViolationForCheck({
    lineEnd,
    lineNumber: cursor.lineNumber,
    lineStart: cursor.lineStart,
    maxLength,
    source,
  });
  if (Option.isSome(violation)) {
    violations.push(violation.value);
  }
};

const collectLongLines = (
  source: string,
  maxLength: number,
  cursor: LineCursor,
  violations: LineLengthViolation[],
): void => {
  let currentCursor = cursor;

  while (true) {
    const lineEnd = nextLineEnd(source, currentCursor.lineStart);
    appendCursorViolation(violations, source, maxLength, currentCursor, lineEnd);

    if (lineEnd === source.length) {
      return;
    }
    currentCursor = nextLineCursor(currentCursor, lineEnd);
  }
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
  return Match.value(source.length).pipe(
    Match.when(
      (length): boolean => length <= maxLength,
      (): LineLengthViolation[] => [],
    ),
    Match.orElse((): LineLengthViolation[] => {
      const violations: LineLengthViolation[] = [];
      collectLongLines(source, maxLength, { lineNumber: 1, lineStart: 0 }, violations);
      return violations;
    }),
  );
}
