/* -------------------------------------------------------------------------- */
/*    Maximum source line length helper used by the custom Oxlint plugin.     */
/* -------------------------------------------------------------------------- */
import { Array, Match, Option, pipe } from 'effect';

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

const lineContainsURL = (source: string, start: number, end: number): boolean =>
  pipe(
    ['http://', 'https://'],
    Array.some((protocol): boolean => {
      const protocolIndex = source.indexOf(protocol, start);
      return protocolIndex !== -1 && protocolIndex < end;
    }),
  );

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
  violations: readonly LineLengthViolation[],
  source: string,
  maxLength: number,
  cursor: LineCursor,
): readonly LineLengthViolation[] => {
  const lineEnd = nextLineEnd(source, cursor.lineStart);
  return pipe(
    lineViolationForCheck({
      lineEnd,
      lineNumber: cursor.lineNumber,
      lineStart: cursor.lineStart,
      maxLength,
      source,
    }),
    Option.match({
      onNone: (): readonly LineLengthViolation[] => violations,
      onSome: (violation): readonly LineLengthViolation[] =>
        pipe(violations, Array.append(violation)),
    }),
  );
};

const collectLongLines = (
  source: string,
  maxLength: number,
  cursor: LineCursor,
  violations: readonly LineLengthViolation[],
): readonly LineLengthViolation[] => {
  const lineEnd = nextLineEnd(source, cursor.lineStart);
  const nextViolations = appendCursorViolation(violations, source, maxLength, cursor);
  return Match.value(lineEnd).pipe(
    Match.when(
      (end): boolean => end === source.length,
      (): readonly LineLengthViolation[] => nextViolations,
    ),
    Match.orElse((end): readonly LineLengthViolation[] =>
      collectLongLines(source, maxLength, nextLineCursor(cursor, end), nextViolations),
    ),
  );
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
    Match.orElse((): LineLengthViolation[] => [
      ...collectLongLines(source, maxLength, { lineNumber: 1, lineStart: 0 }, []),
    ]),
  );
}
