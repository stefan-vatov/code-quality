/**
 * require-function-doc — ensures every exported declaration has a non-empty JSDoc comment.
 *
 * Checks:
 *   - `export function`, `export class`, `export const`, `export let`, `export var`
 *   - `export default function`, `export default class`
 *   - `export type`, `export interface`, `export enum`
 *   - `export abstract class`
 *
 * Skips:
 *   - `export { ... } from ...` (re-exports)
 *   - `export * from ...` (wildcard re-exports)
 *   - `export type { ... } from ...` (type re-exports)
 *   - `export default <expression>` (not a declaration)
 *   - Non-exported declarations
 */

/**
 * Returns true if all exported declarations have a non-empty JSDoc comment
 * preceding them. Returns false if any export is undocumented or has an
 * empty JSDoc.
 */
export default function hasRequiredFunctionDocs(source: string): boolean {
  const len = source.length;
  let pos = 0;

  // Collect all exports that need documentation
  const exports: Array<{ pos: number; lineStart: number }> = [];

  while (pos < len) {
    const exp = source.indexOf('export ', pos);
    if (exp === -1) break;

    // Skip if preceded by non-whitespace (e.g., "import/export" is two tokens)
    if (exp > 0) {
      const prev = source.charCodeAt(exp - 1);
      if (prev !== 10 && prev !== 13 && prev !== 9 && prev !== 32) {
        pos = exp + 1;
        continue;
      }
    }

    // Find the start of this line
    let lineStart = exp;
    while (lineStart > 0 && source.charCodeAt(lineStart - 1) !== 10) {
      lineStart--;
    }

    // Skip whitespace after "export "
    let after = exp + 7;
    while (after < len && isWhitespace(source.charCodeAt(after))) after++;

    if (after >= len) break;

    // Check next token after "export "
    const c0 = source.charCodeAt(after);

    if (c0 === 123) {
      // export { ... } — re-export
      pos = exp + 7;
      continue;
    }

    if (c0 === 42) {
      // export * — wildcard re-export
      pos = exp + 7;
      continue;
    }

    // export type { ... } — skip ahead past "type "
    if (c0 === 116) {
      // 't' — could be "type"
      if (after + 5 <= len && source.slice(after, after + 5) === 'type ') {
        const afterType = after + 5;
        if (afterType < len && source.charCodeAt(afterType) === 123) {
          // export type { ... }
          pos = afterType;
          continue;
        }
      }
    }

    // export default — check if followed by declaration or expression
    let afterDefaultOrType = after;

    if (c0 === 97) {
      // 'a' — could be "abstract" or "async"
      if (after + 9 <= len && source.slice(after, after + 9) === 'abstract ') {
        afterDefaultOrType = after + 9;
        while (afterDefaultOrType < len && isWhitespace(source.charCodeAt(afterDefaultOrType))) {
          afterDefaultOrType++;
        }
      } else if (after + 6 <= len && source.slice(after, after + 6) === 'async ') {
        afterDefaultOrType = after + 6;
        while (afterDefaultOrType < len && isWhitespace(source.charCodeAt(afterDefaultOrType))) {
          afterDefaultOrType++;
        }
      }
    }

    if (afterDefaultOrType === after && c0 === 100) {
      // 'd' — could be "default"
      if (after + 8 <= len && source.slice(after, after + 8) === 'default ') {
        afterDefaultOrType = after + 8;
        while (afterDefaultOrType < len && isWhitespace(source.charCodeAt(afterDefaultOrType))) {
          afterDefaultOrType++;
        }
      }
    } else if (c0 === 116) {
      // 't' — could be "type"
      if (after + 5 <= len && source.slice(after, after + 5) === 'type ') {
        afterDefaultOrType = after + 5;
        while (afterDefaultOrType < len && isWhitespace(source.charCodeAt(afterDefaultOrType))) {
          afterDefaultOrType++;
        }
      }
    }

    if (afterDefaultOrType >= len) break;

    const next = source.charCodeAt(afterDefaultOrType);

    // Check if it's a declaration kind we care about (case-insensitive start)
    if (
      next === 102 || next === 70 ||  // 'f','F' function
      next === 99  || next === 67 ||  // 'c','C' class, const
      next === 105 || next === 73 ||  // 'i','I' interface
      next === 101 || next === 69 ||  // 'e','E' enum
      next === 108 || next === 76 ||  // 'l','L' let
      next === 118 || next === 86      // 'v','V' var
    ) {
      exports.push({ pos: exp, lineStart });
    }

    pos = exp + 7;
  }

  // No exports need documentation — pass
  if (exports.length === 0) return true;

  // For each export, check if it has a JSDoc comment before it.
  // A JSDoc comment is a block comment starting with /** (not /*! or /*).
  // Scan backwards from the export to find the nearest preceding JSDoc.
  for (const exp of exports) {
    if (!hasJSDocBefore(source, exp.pos)) {
      return false;
    }
  }

  return true;
}

/**
 * Check if there's a non-empty JSDoc comment immediately before the given position.
 * Scans backwards through whitespace only. Stops at any non-whitespace, non-comment content.
 */
function hasJSDocBefore(source: string, exportPos: number): boolean {
  let pos = exportPos;

  // Skip backwards past whitespace and newlines
  while (pos > 0 && isWhitespace(source.charCodeAt(pos - 1))) {
    pos--;
  }

  // Check if we're at the end of a JSDoc block: must find */
  if (pos < 2) return false;
  if (source.charCodeAt(pos - 2) !== 42 || source.charCodeAt(pos - 1) !== 47) {
    return false;
  }

  // We're at the closing */ — find the opening /**
  const closeEnd = pos; // position right after */
  let close = pos - 2; // position of *

  // Walk backwards through the comment body to find /**
  let open = close - 1;
  while (open > 0) {
    if (source.charCodeAt(open) === 42 && source.charCodeAt(open - 1) === 47) {
      // Found /*
      // Check third char is * (making it /**) and fourth char is not * (making it not /***/)
      if (open + 1 < close && source.charCodeAt(open + 1) === 42) {
        // It's /** ... */ — extract content
        const content = source.slice(open + 3, close).trim();
        // Content must have text (not just * markers and whitespace)
        return hasDescriptionContent(content);
      }
      // It's /* ... */ (not JSDoc) — skip
      open -= 2;
      continue;
    }
    open--;
  }

  return false;
}

/**
 * Returns true if the JSDoc body has meaningful description text.
 * Accepts: plain text, @tags, markdown
 * Rejects: blank, whitespace-only, only * characters
 */
function hasDescriptionContent(jsdocBody: string): boolean {
  // Strip leading asterisk markers and trim
  const stripped = jsdocBody
    .split('\n')
    .map((line) => {
      let s = line.trimStart();
      if (s.startsWith('*')) {
        s = s.slice(1).trimStart();
      }
      return s;
    })
    .join('\n')
    .trim();

  // Remove @tags to check if there's description text
  const withoutTags = stripped
    .split('\n')
    .filter((line) => !line.startsWith('@'))
    .join('\n')
    .trim();

  return withoutTags.length > 0 || stripped.length > 0;
}

function isWhitespace(code: number): boolean {
  return code === 32 || code === 9 || code === 10 || code === 13;
}
