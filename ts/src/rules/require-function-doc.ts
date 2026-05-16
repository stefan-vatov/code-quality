/**
 * Require-function-doc — ensures every exported declaration has a non-empty JSDoc comment.
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

function isWhitespace(code: number): boolean {
  return code === 32 || code === 9 || code === 10 || code === 13;
}

function hasDescriptionContent(jsdocBody: string): boolean {
  const stripped = jsdocBody
    .split('\n')
    .map((line) => {
      let strippedLine = line.trimStart();
      if (strippedLine.startsWith('*')) {
        strippedLine = strippedLine.slice(1).trimStart();
      }
      return strippedLine;
    })
    .join('\n')
    .trim();

  return stripped.length > 0;
}

function hasJSDocBefore(source: string, exportPos: number): boolean {
  let pos = exportPos;

  while (pos > 0 && isWhitespace(source.charCodeAt(pos - 1))) {
    pos--;
  }

  if (pos < 2) {
    return false;
  }
  if (source.charCodeAt(pos - 2) !== 42 || source.charCodeAt(pos - 1) !== 47) {
    return false;
  }

  const closeStar = pos - 2;

  let open = closeStar - 1;
  while (open > 0) {
    if (source.charCodeAt(open) === 42 && source.charCodeAt(open - 1) === 47) {
      if (open + 1 < closeStar && source.charCodeAt(open + 1) === 42) {
        const content = source.slice(open + 3, closeStar).trim();
        return hasDescriptionContent(content);
      }
      open -= 2;
      continue;
    }
    open--;
  }

  return false;
}

function endsWithWord(source: string, pos: number, word: string): boolean {
  const end = pos + word.length;
  if (end > source.length) {
    return false;
  }
  if (source.slice(pos, end) !== word) {
    return false;
  }
  if (end >= source.length) {
    return true;
  }
  const next = source.charCodeAt(end);
  return isWhitespace(next) || next === 40 || next === 123 || next === 59 || next === 60;
}

function isDefaultDeclaration(source: string, pos: number, _len: number): boolean {
  const ch = source.charCodeAt(pos);

  if (ch === 102) {
    return endsWithWord(source, pos, 'function');
  }
  if (ch === 99) {
    return endsWithWord(source, pos, 'class');
  }
  if (ch === 105) {
    return endsWithWord(source, pos, 'interface');
  }

  return false;
}

const AMBIENT_DECLARE_PREFIXES = ['declare module', 'declare namespace', 'declare global'];

function isAmbientDeclarationFile(source: string): boolean {
  let idx = 0;
  const len = source.length;

  while (idx < len && source.charCodeAt(idx) === 35) {
    idx = source.indexOf('\n', idx);
    if (idx === -1) {
      return false;
    }
    idx++;
  }

  while (idx < len) {
    const ch = source.charCodeAt(idx);
    if (isWhitespace(ch)) {
      idx++;
      continue;
    }
    if (ch === 47 && idx + 1 < len && source.charCodeAt(idx + 1) === 42) {
      const close = source.indexOf('*/', idx + 2);
      if (close !== -1) {
        idx = close + 2;
        continue;
      }
      return false;
    }
    if (ch === 47 && idx + 1 < len && source.charCodeAt(idx + 1) === 47) {
      const nl = source.indexOf('\n', idx);
      if (nl !== -1) {
        idx = nl + 1;
        continue;
      }
      return false;
    }
    break;
  }

  if (idx >= len) {
    return false;
  }

  for (const prefix of AMBIENT_DECLARE_PREFIXES) {
    if (idx + prefix.length <= len && source.slice(idx, idx + prefix.length) === prefix) {
      return true;
    }
  }

  return false;
}

/**
 * Returns true if all exported declarations have a non-empty JSDoc comment
 * preceding them. Returns false if any export is undocumented or has an
 * empty JSDoc.
 */
export default function hasRequiredFunctionDocs(source: string): boolean {
  const len = source.length;

  if (isAmbientDeclarationFile(source)) {
    return true;
  }

  let pos = 0;

  const exportPositions: number[] = [];

  while (pos < len) {
    const exp = source.indexOf('export ', pos);
    if (exp === -1) {
      break;
    }

    if (exp > 0) {
      const prev = source.charCodeAt(exp - 1);
      if (prev !== 10 && prev !== 13 && prev !== 9 && prev !== 32) {
        pos = exp + 1;
        continue;
      }

      if (exp >= 8 && source.slice(exp - 8, exp) === 'declare ') {
        pos = exp + 7;
        continue;
      }
    }

    let after = exp + 7;
    while (after < len && isWhitespace(source.charCodeAt(after))) {
      after++;
    }

    if (after >= len) {
      break;
    }

    const c0 = source.charCodeAt(after);

    // Re-export block: export { ... }
    if (c0 === 123) {
      pos = exp + 7;
      continue;
    }

    // Wildcard re-export: export *
    if (c0 === 42) {
      pos = exp + 7;
      continue;
    }

    // Type re-export: export type { ... }
    if (c0 === 116 && after + 5 <= len && source.slice(after, after + 5) === 'type ') {
      const afterType = after + 5;
      if (afterType < len && source.charCodeAt(afterType) === 123) {
        pos = afterType;
        continue;
      }
    }

    let afterMod = after;
    let changed = true;
    let sawDefault = false;
    while (changed && afterMod < len) {
      changed = false;
      const ch = source.charCodeAt(afterMod);

      if (
        ch === 100 &&
        afterMod + 8 <= len &&
        source.slice(afterMod, afterMod + 8) === 'default '
      ) {
        afterMod += 8;
        changed = true;
        sawDefault = true;
      } else if (
        ch === 97 &&
        afterMod + 6 <= len &&
        source.slice(afterMod, afterMod + 6) === 'async '
      ) {
        afterMod += 6;
        changed = true;
      } else if (
        ch === 97 &&
        afterMod + 9 <= len &&
        source.slice(afterMod, afterMod + 9) === 'abstract '
      ) {
        afterMod += 9;
        changed = true;
      } else if (
        ch === 116 &&
        afterMod + 5 <= len &&
        source.slice(afterMod, afterMod + 5) === 'type '
      ) {
        afterMod += 5;
        changed = true;
      } else if (
        ch === 110 &&
        afterMod + 10 <= len &&
        source.slice(afterMod, afterMod + 10) === 'namespace '
      ) {
        break;
      }

      if (changed) {
        while (afterMod < len && isWhitespace(source.charCodeAt(afterMod))) {
          afterMod++;
        }
      }
    }

    if (afterMod >= len) {
      break;
    }

    const next = source.charCodeAt(afterMod);

    // Declaration keyword check (case-insensitive first character):
    // First chars: f/F=function, c/C=class|const, i/I=interface, e/E=enum, l/L=let, v/V=var, n/N=namespace
    if (
      next === 102 ||
      next === 70 ||
      next === 99 ||
      next === 67 ||
      next === 105 ||
      next === 73 ||
      next === 101 ||
      next === 69 ||
      next === 108 ||
      next === 76 ||
      next === 118 ||
      next === 86 ||
      next === 110 ||
      next === 78
    ) {
      if (sawDefault) {
        if (!isDefaultDeclaration(source, afterMod, len)) {
          pos = exp + 7;
          continue;
        }
      }
      exportPositions.push(exp);
    }

    pos = exp + 7;
  }

  if (exportPositions.length === 0) {
    return true;
  }

  for (let idx = 0; idx < exportPositions.length; idx++) {
    if (!hasJSDocBefore(source, exportPositions[idx])) {
      return false;
    }
  }

  return true;
}
