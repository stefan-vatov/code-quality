/**
 * File-level documentation requirement helper for custom Oxlint rules.
 *
 * @internal
 */
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
const MAX_HEADER_SEARCH_DISTANCE = 50;

// Pre-computed search strings
const JSDOC_START = '/**';
const JSDOC_END = '*/';

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

  if (!hasJSDocStartAt(source, pos)) {
    return undefined;
  }

  // Find closing */
  const closePOS = source.indexOf(JSDOC_END, pos + JSDOC_PREFIX_LENGTH);
  if (closePOS === -1) {
    return undefined;
  }

  return source.slice(pos, closePOS + 2);
};

/**
 * Returns true if the source file satisfies the file doc requirement. Requires: JSDoc header, opt-out
 * marker, or empty/whitespace-only.
 */
export default function hasRequiredFileDoc(source: string): boolean {
  const pos = leadingContentPosition(source, source.length);
  if (pos >= source.length) {
    return true;
  }

  if (hasOptOutMarker(source, pos)) {
    return true;
  }

  // JSDoc header must be at or near file start
  const jsdocPosition = source.indexOf(JSDOC_START, pos);
  if (jsdocPosition === -1 || jsdocPosition > pos + MAX_HEADER_SEARCH_DISTANCE) {
    return false;
  }

  // Must close
  return source.includes(JSDOC_END, jsdocPosition + JSDOC_PREFIX_LENGTH);
}
