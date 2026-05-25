/* -------------------------------------------------------------------------- */
/*    File-level documentation requirement helper for custom Oxlint rules.    */
/* -------------------------------------------------------------------------- */
import { Array, Match, Option, pipe } from 'effect';

// Character code constants
const CH_HASH = 35;
const CH_SLASH = 47;
const CH_SPACE = 32;
const CH_NEWLINE = 10;
const CH_RETURN = 13;
const CH_TAB = 9;
const CH_ASTERISK = 42;
const JSDOC_PREFIX_LENGTH = 3;
const LINE_MARKER_LOOKAHEAD = 20;
const BLOCK_MARKER_LOOKAHEAD = 15;

// Pre-computed search strings
const JSDOC_END = '*/';
const DIVIDER_PREFIX = '/* ';
const DIVIDER_SUFFIX = ' */';
const DIVIDER_LENGTH = 80;
const DIVIDER_RULE =
  '/* -------------------------------------------------------------------------- */';

const isWhitespace = (code: number): boolean =>
  code === CH_SPACE || code === CH_NEWLINE || code === CH_RETURN || code === CH_TAB;

const skipShebangLinesFrom = (source: string, emptyResult: number, pos: number): number =>
  Match.value(pos < source.length && source.charCodeAt(pos) === CH_HASH).pipe(
    Match.when(false, (): number => pos),
    Match.orElse((): number => {
      const nextLine = source.indexOf('\n', pos);
      return Match.value(nextLine).pipe(
        Match.when(-1, (): number => emptyResult),
        Match.orElse((lineEnd): number => skipShebangLinesFrom(source, emptyResult, lineEnd + 1)),
      );
    }),
  );

const skipShebangLines = (source: string, emptyResult: number): number =>
  skipShebangLinesFrom(source, emptyResult, 0);

const skipLeadingWhitespace = (source: string, start: number): number =>
  Match.value(start).pipe(
    Match.when(
      (pos): boolean => pos >= source.length || !isWhitespace(source.charCodeAt(pos)),
      (pos): number => pos,
    ),
    Match.orElse((pos): number => skipLeadingWhitespace(source, pos + 1)),
  );

const leadingContentPosition = (source: string, emptyResult: number): number =>
  skipLeadingWhitespace(source, skipShebangLines(source, emptyResult));

const hasJSDocStartAt = (source: string, pos: number): boolean =>
  pos + 2 < source.length &&
  source.charCodeAt(pos) === CH_SLASH &&
  source.charCodeAt(pos + 1) === CH_ASTERISK &&
  source.charCodeAt(pos + 2) === CH_ASTERISK;

const lineEndAt = (source: string, start: number): number =>
  Match.value(source.indexOf('\n', start)).pipe(
    Match.when(-1, (): number => source.length),
    Match.orElse((newline): number => newline),
  );

const nextLineStartAt = (source: string, start: number): number =>
  Match.value(source.indexOf('\n', start)).pipe(
    Match.when(-1, (): number => source.length),
    Match.orElse((newline): number => newline + 1),
  );

const isDividerTextLine = (line: string): boolean =>
  line.length === DIVIDER_LENGTH &&
  line.startsWith(DIVIDER_PREFIX) &&
  line.endsWith(DIVIDER_SUFFIX);

const isDividerRuleLine = (line: string): boolean => line === DIVIDER_RULE;

const nextDividerEndFrom = (source: string, cursor: number): number | undefined =>
  Match.value(cursor).pipe(
    Match.when(
      (position): boolean => position >= source.length,
      (): undefined => undefined,
    ),
    Match.orElse((position): number | undefined => {
      const end = lineEndAt(source, position);
      return Match.value(isDividerRuleLine(source.slice(position, end))).pipe(
        Match.when(true, (): number => end),
        Match.orElse((): number | undefined =>
          nextDividerEndFrom(source, nextLineStartAt(source, position)),
        ),
      );
    }),
  );

const nextDividerEnd = (source: string, start: number): number | undefined =>
  nextDividerEndFrom(source, nextLineStartAt(source, start));

const dividerHeaderEnd = (source: string, pos: number): number | undefined => {
  const firstEnd = lineEndAt(source, pos);
  return Match.value(isDividerRuleLine(source.slice(pos, firstEnd))).pipe(
    Match.when(false, (): undefined => undefined),
    Match.orElse((): number | undefined =>
      pipe(
        Option.fromNullable(nextDividerEnd(source, firstEnd)),
        Option.filter((closingDividerEnd): boolean => {
          const body = source.slice(nextLineStartAt(source, firstEnd), closingDividerEnd);
          return pipe(body.split('\n'), Array.every(isDividerTextLine));
        }),
        Option.getOrUndefined,
      ),
    ),
  );
};

const boundedEnd = (source: string, pos: number, lookahead: number): number =>
  Match.value(pos + lookahead).pipe(
    Match.when(
      (end): boolean => end < source.length,
      (end): number => end,
    ),
    Match.orElse((): number => source.length),
  );

const hasLineOptOutMarker = (source: string, pos: number): boolean => {
  const end = boundedEnd(source, pos, LINE_MARKER_LOOKAHEAD);
  const frag = source.slice(pos, end);
  return frag.startsWith('// @internal') || frag.startsWith('// @generated');
};

const hasBlockOptOutMarker = (source: string, pos: number): boolean =>
  pos + 2 < source.length &&
  source.charCodeAt(pos + 2) !== CH_ASTERISK &&
  source.slice(pos, boundedEnd(source, pos, BLOCK_MARKER_LOOKAHEAD)).startsWith('/* @internal');

const hasOptOutMarker = (source: string, pos: number): boolean =>
  Match.value(source.charCodeAt(pos) === CH_SLASH && pos + 1 < source.length).pipe(
    Match.when(false, (): boolean => false),
    Match.orElse((): boolean =>
      Match.value(source.charCodeAt(pos + 1)).pipe(
        Match.when(CH_SLASH, (): boolean => hasLineOptOutMarker(source, pos)),
        Match.when(CH_ASTERISK, (): boolean => hasBlockOptOutMarker(source, pos)),
        Match.orElse((): boolean => false),
      ),
    ),
  );

/**
 * Extract the JSDoc file header comment from source text. Skips leading shebang lines and whitespace.
 * Returns the full JSDoc block or undefined.
 */
export const extractDocHeader = (source: string): string | undefined => {
  const pos = leadingContentPosition(source, source.length);
  return Match.value(pos).pipe(
    Match.when(
      (position): boolean => position >= source.length,
      (): undefined => undefined,
    ),
    Match.orElse((position): string | undefined => extractDocHeaderAt(source, position)),
  );
};

const extractDocHeaderAt = (source: string, pos: number): string | undefined => {
  const dividerEnd = dividerHeaderEnd(source, pos);
  return pipe(
    Option.fromNullable(dividerEnd),
    Option.match({
      onNone: (): string | undefined =>
        Match.value(hasJSDocStartAt(source, pos)).pipe(
          Match.when(false, (): undefined => undefined),
          Match.orElse((): string | undefined => {
            const closePOS = source.indexOf(JSDOC_END, pos + JSDOC_PREFIX_LENGTH);
            return Match.value(closePOS).pipe(
              Match.when(-1, (): undefined => undefined),
              Match.orElse((closePosition): string => source.slice(pos, closePosition + 2)),
            );
          }),
        ),
      onSome: (end): string => source.slice(pos, end),
    }),
  );
};

/**
 * Returns true if the source file satisfies the file doc requirement. Requires: divider header,
 * opt-out marker, or empty/whitespace-only.
 */
export default function hasRequiredFileDoc(source: string): boolean {
  const pos = leadingContentPosition(source, source.length);
  return Match.value(pos).pipe(
    Match.when(
      (position): boolean => position >= source.length,
      (): boolean => true,
    ),
    Match.when(
      (position): boolean => hasOptOutMarker(source, position),
      (): boolean => true,
    ),
    Match.orElse((position): boolean => dividerHeaderEnd(source, position) !== undefined),
  );
}
