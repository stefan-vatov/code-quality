/* -------------------------------------------------------------------------- */
/*    File-level documentation requirement helper for custom Oxlint rules.    */
/* -------------------------------------------------------------------------- */
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

const skipShebangLines = (source: string, emptyResult: number): number => {
  let pos = 0;
  while (pos < source.length && source.charCodeAt(pos) === CH_HASH) {
    const nextLine = source.indexOf('\n', pos);
    if (nextLine === -1) {
      return emptyResult;
    }
    pos = nextLine + 1;
  }
  return pos;
};

const skipLeadingWhitespace = (source: string, start: number): number => {
  let pos = start;
  while (pos < source.length && isWhitespace(source.charCodeAt(pos))) {
    pos++;
  }
  return pos;
};

const leadingContentPosition = (source: string, emptyResult: number): number =>
  skipLeadingWhitespace(source, skipShebangLines(source, emptyResult));

const hasJSDocStartAt = (source: string, pos: number): boolean =>
  pos + 2 < source.length &&
  source.charCodeAt(pos) === CH_SLASH &&
  source.charCodeAt(pos + 1) === CH_ASTERISK &&
  source.charCodeAt(pos + 2) === CH_ASTERISK;

const lineEndAt = (source: string, start: number): number => {
  const newline = source.indexOf('\n', start);
  if (newline === -1) {
    return source.length;
  }
  return newline;
};

const nextLineStartAt = (source: string, start: number): number => {
  const newline = source.indexOf('\n', start);
  if (newline === -1) {
    return source.length;
  }
  return newline + 1;
};

const isDividerTextLine = (line: string): boolean =>
  line.length === DIVIDER_LENGTH &&
  line.startsWith(DIVIDER_PREFIX) &&
  line.endsWith(DIVIDER_SUFFIX);

const isDividerRuleLine = (line: string): boolean => line === DIVIDER_RULE;

const nextDividerEnd = (source: string, start: number): number | undefined => {
  let cursor = nextLineStartAt(source, start);
  while (cursor < source.length) {
    const end = lineEndAt(source, cursor);
    if (isDividerRuleLine(source.slice(cursor, end))) {
      return end;
    }
    cursor = nextLineStartAt(source, cursor);
  }
  return undefined;
};

const dividerHeaderEnd = (source: string, pos: number): number | undefined => {
  const firstEnd = lineEndAt(source, pos);
  if (!isDividerRuleLine(source.slice(pos, firstEnd))) {
    return undefined;
  }
  const closingDividerEnd = nextDividerEnd(source, firstEnd);
  if (closingDividerEnd !== undefined) {
    const body = source.slice(nextLineStartAt(source, firstEnd), closingDividerEnd);
    if (body.split('\n').every(isDividerTextLine)) {
      return closingDividerEnd;
    }
  }
  return undefined;
};

const boundedEnd = (source: string, pos: number, lookahead: number): number => {
  if (pos + lookahead < source.length) {
    return pos + lookahead;
  }
  return source.length;
};

const hasLineOptOutMarker = (source: string, pos: number): boolean => {
  const end = boundedEnd(source, pos, LINE_MARKER_LOOKAHEAD);
  const frag = source.slice(pos, end);
  return frag.startsWith('// @internal') || frag.startsWith('// @generated');
};

const hasBlockOptOutMarker = (source: string, pos: number): boolean =>
  pos + 2 < source.length &&
  source.charCodeAt(pos + 2) !== CH_ASTERISK &&
  source.slice(pos, boundedEnd(source, pos, BLOCK_MARKER_LOOKAHEAD)).startsWith('/* @internal');

const hasOptOutMarker = (source: string, pos: number): boolean => {
  if (source.charCodeAt(pos) !== CH_SLASH || pos + 1 >= source.length) {
    return false;
  }

  const next = source.charCodeAt(pos + 1);
  if (next === CH_SLASH) {
    return hasLineOptOutMarker(source, pos);
  }
  if (next === CH_ASTERISK) {
    return hasBlockOptOutMarker(source, pos);
  }
  return false;
};

/**
 * Extract the JSDoc file header comment from source text. Skips leading shebang lines and whitespace.
 * Returns the full JSDoc block or undefined.
 */
export const extractDocHeader = (source: string): string | undefined => {
  const pos = leadingContentPosition(source, source.length);
  if (pos >= source.length) {
    return undefined;
  }

  return extractDocHeaderAt(source, pos);
};

const extractDocHeaderAt = (source: string, pos: number): string | undefined => {
  const dividerEnd = dividerHeaderEnd(source, pos);
  if (dividerEnd !== undefined) {
    return source.slice(pos, dividerEnd);
  }
  if (!hasJSDocStartAt(source, pos)) {
    return undefined;
  }
  const closePOS = source.indexOf(JSDOC_END, pos + JSDOC_PREFIX_LENGTH);
  if (closePOS === -1) {
    return undefined;
  }
  return source.slice(pos, closePOS + 2);
};

/**
 * Returns true if the source file satisfies the file doc requirement. Requires: divider header,
 * opt-out marker, or empty/whitespace-only.
 */
export default function hasRequiredFileDoc(source: string): boolean {
  const pos = leadingContentPosition(source, source.length);
  if (pos >= source.length) {
    return true;
  }

  if (hasOptOutMarker(source, pos)) {
    return true;
  }

  return dividerHeaderEnd(source, pos) !== undefined;
}
