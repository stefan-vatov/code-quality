/* -------------------------------------------------------------------------- */
/*    File-level documentation requirement helper for custom Oxlint rules.    */
/* -------------------------------------------------------------------------- */
import { Match, Option, pipe } from 'effect';

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
const DIVIDER_PREFIX = '/*';
const DIVIDER_SUFFIX = '*/';
const MIN_DIVIDER_DASHES = 3;

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

const trimLineEnd = (line: string): string => line.replace(/\r$/u, '');

const lineTextAt = (source: string, start: number): string =>
  trimLineEnd(source.slice(start, lineEndAt(source, start)));

const isSkippableToolDirectiveLine = (line: string): boolean => {
  const trimmed = line.trim();
  return (
    trimmed.startsWith('/* eslint-') ||
    trimmed.startsWith('// eslint-') ||
    trimmed.startsWith('// @ts-') ||
    trimmed.startsWith('/// <reference') ||
    trimmed === "'use strict';" ||
    trimmed === '"use strict";'
  );
};

const skipToolDirectiveLines = (source: string, start: number): number => {
  const pos = skipLeadingWhitespace(source, start);
  if (pos >= source.length) {
    return pos;
  }

  const line = lineTextAt(source, pos);
  if (!isSkippableToolDirectiveLine(line)) {
    return pos;
  }

  return skipToolDirectiveLines(source, nextLineStartAt(source, pos));
};

const leadingContentPosition = (source: string, emptyResult: number): number =>
  skipToolDirectiveLines(source, skipShebangLines(source, emptyResult));

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

const dividerLineInnerText = (line: string): string | undefined => {
  const normalizedLine = trimLineEnd(line);
  if (!normalizedLine.startsWith(DIVIDER_PREFIX) || !normalizedLine.endsWith(DIVIDER_SUFFIX)) {
    return undefined;
  }
  return normalizedLine.slice(DIVIDER_PREFIX.length, -DIVIDER_SUFFIX.length).trim();
};

const hasMeaningfulDividerText = (text: string): boolean => text.length > 0 && !/^-+$/u.test(text);

const isDividerTextLine = (line: string): boolean =>
  pipe(Option.fromNullable(dividerLineInnerText(line)), Option.exists(hasMeaningfulDividerText));

const isDividerRuleLine = (line: string): boolean =>
  pipe(
    Option.fromNullable(dividerLineInnerText(line)),
    Option.exists((text): boolean => /^-+$/u.test(text) && text.length >= MIN_DIVIDER_DASHES),
  );

const dividerHeaderBodyEndFrom = (
  source: string,
  cursor: number,
  hasMeaningfulBody: boolean,
): number | undefined => {
  if (cursor >= source.length) {
    return undefined;
  }

  const line = lineTextAt(source, cursor);
  const end = lineEndAt(source, cursor);

  if (isDividerRuleLine(line)) {
    return Match.value(hasMeaningfulBody).pipe(
      Match.when(true, (): number => end),
      Match.orElse((): undefined => undefined),
    );
  }

  if (!isDividerTextLine(line)) {
    return undefined;
  }

  return dividerHeaderBodyEndFrom(source, nextLineStartAt(source, cursor), true);
};

const dividerHeaderEnd = (source: string, pos: number): number | undefined => {
  if (!isDividerRuleLine(lineTextAt(source, pos))) {
    return undefined;
  }

  return dividerHeaderBodyEndFrom(source, nextLineStartAt(source, pos), false);
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
