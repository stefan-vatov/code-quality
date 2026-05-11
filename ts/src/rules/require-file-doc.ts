// Character code constants
const CH_HASH = 35;
const CH_SLASH = 47;
const CH_SPACE = 32;
const CH_NEWLINE = 10;
const CH_RETURN = 13;
const CH_TAB = 9;

// Pre-computed search strings
const JSDOC_START = '/**';
const JSDOC_END = '*/';

/**
 * Extract the JSDoc file header comment from source text.
 * Skips leading shebang lines and whitespace.
 * Returns the full JSDoc block or null.
 */
export function extractDocHeader(source: string): string | null {
  const len = source.length;
  let pos = 0;

  // Skip shebang lines
  while (pos < len && source.charCodeAt(pos) === CH_HASH) {
    pos = source.indexOf('\n', pos);
    if (pos === -1) return null;
    pos++;
  }

  // Skip leading whitespace
  while (pos < len) {
    const ch = source.charCodeAt(pos);
    if (ch !== CH_SPACE && ch !== CH_NEWLINE && ch !== CH_RETURN && ch !== CH_TAB) break;
    pos++;
  }

  if (pos >= len) return null;

  // Must be a JSDoc block comment
  if (
    pos + 2 >= len ||
    source.charCodeAt(pos) !== CH_SLASH ||
    source.charCodeAt(pos + 1) !== 42 ||
    source.charCodeAt(pos + 2) !== 42
  ) {
    return null;
  }

  // Find closing */
  const closePos = source.indexOf(JSDOC_END, pos + 3);
  if (closePos === -1) return null;

  return source.slice(pos, closePos + 2);
}

/**
 * Returns true if the source file satisfies the file doc requirement.
 * Requires: JSDoc header, opt-out marker, or empty/whitespace-only.
 */
export default function hasRequiredFileDoc(source: string): boolean {
  const len = source.length;
  let pos = 0;

  // Skip shebang lines
  while (pos < len && source.charCodeAt(pos) === CH_HASH) {
    pos = source.indexOf('\n', pos);
    if (pos === -1) return true;
    pos++;
  }

  // Skip leading whitespace
  while (pos < len) {
    const ch = source.charCodeAt(pos);
    if (ch !== CH_SPACE && ch !== CH_NEWLINE && ch !== CH_RETURN && ch !== CH_TAB) break;
    pos++;
  }

  if (pos >= len) return true;

  // Opt-out markers
  if (source.charCodeAt(pos) === CH_SLASH && pos + 1 < len) {
    const n = source.charCodeAt(pos + 1);

    if (n === CH_SLASH) {
      // Line comment: check @internal or @generated
      const end = pos + 20 < len ? pos + 20 : len;
      const frag = source.slice(pos, end);
      if (
        frag.indexOf('// @internal') === 0 ||
        frag.indexOf('// @generated') === 0
      ) {
        return true;
      }
    } else if (n === 42 && pos + 2 < len && source.charCodeAt(pos + 2) !== 42) {
      // Block comment (not JSDoc): check @internal at start
      const end = pos + 15 < len ? pos + 15 : len;
      if (source.slice(pos, end).indexOf('/* @internal') === 0) return true;
    }
  }

  // JSDoc header must be at or near file start
  const jsdocPos = source.indexOf(JSDOC_START, pos);
  if (jsdocPos === -1 || jsdocPos > pos + 50) return false;

  // Must close
  return source.indexOf(JSDOC_END, jsdocPos + 3) !== -1;
}
