// Opt-out markers that allow skipping the file doc requirement
const OPTOUT_MARKERS = ['// @internal', '/* @internal', '// @generated'];

/**
 * Extract the JSDoc file header comment from source text.
 * Skips leading shebang lines. Returns the full JSDoc block or null.
 */
export function extractDocHeader(source: string): string | null {
  let idx = 0;
  const len = source.length;

  // Skip shebang lines
  while (idx < len && source.charCodeAt(idx) === 35) {
    // Find newline
    while (idx < len && source.charCodeAt(idx) !== 10) {
      idx++;
    }
    if (idx < len && source.charCodeAt(idx) === 10) {
      idx++;
    }
  }

  // Skip whitespace
  while (
    idx < len &&
    (source.charCodeAt(idx) === 32 ||
      source.charCodeAt(idx) === 10 ||
      source.charCodeAt(idx) === 13 ||
      source.charCodeAt(idx) === 9)
  ) {
    idx++;
  }

  // Must start with /**
  if (idx + 2 >= len) {
    return null;
  }
  if (
    source.charCodeAt(idx) !== 47 ||
    source.charCodeAt(idx + 1) !== 42 ||
    source.charCodeAt(idx + 2) !== 42
  ) {
    return null;
  }

  // Find closing */
  let close = idx + 3;
  while (close < len - 1) {
    if (source.charCodeAt(close) === 42 && source.charCodeAt(close + 1) === 47) {
      return source.slice(idx, close + 2);
    }
    close++;
  }

  // Unclosed comment
  return null;
}

/**
 * Returns true if the source file satisfies the file documentation requirement.
 * A file must have either:
 *   - A JSDoc header comment ({@code /}{@code ** ... *}{@code /})
 *   - An opt-out marker ({@code // @internal} or {@code // @generated})
 *   - Be empty or whitespace-only
 */
export default function hasRequiredFileDoc(source: string): boolean {
  const trimmed = source.trim();
  if (trimmed.length === 0) {
    return true;
  }

  for (const marker of OPTOUT_MARKERS) {
    if (trimmed.startsWith(marker)) {
      return true;
    }
  }

  return extractDocHeader(source) !== null;
}
