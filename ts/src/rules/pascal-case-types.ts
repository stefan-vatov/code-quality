/**
 * Check if a name follows PascalCase convention.
 *
 * PascalCase: starts with an uppercase letter, contains no underscores
 * between words. Consecutive capitals (for acronyms like HTTPS, URL) are
 * permitted as they're standard PascalCase practice.
 *
 * Entirely uppercase multi-character names (e.g., URLPARSER, HTTPSCONNECTION)
 * are rejected — they're the constant convention, not PascalCase. Single
 * uppercase letters (e.g., `T`, `K`) are accepted as valid type parameter names.
 *
 * Leading underscores (e.g. `_Foo`) are not PascalCase — they indicate
 * a private/internal convention, not a type name.
 */
export default function isPascalCase(name: string): boolean {
  const len = name.length;
  if (len === 0) {
    return false;
  }

  // First char must be uppercase letter
  const first = name.charCodeAt(0);
  if (first < 65 || first > 90) {
    return false;
  }

  // Reject underscores
  if (name.indexOf('_') !== -1) {
    return false;
  }

  // Must not be entirely uppercase (that's the constant convention).
  // But digits are fine — only check alphabetic characters.
  let alphaCount = 0;
  let allUpper = true;
  for (let idx = 0; idx < len; idx++) {
    const code = name.charCodeAt(idx);
    if ((code >= 65 && code <= 90) || (code >= 97 && code <= 122)) {
      alphaCount++;
      if (code >= 97) {
        allUpper = false;
      }
    }
  }
  if (allUpper && alphaCount > 1) {
    return false;
  }
  return true;
}

/**
 * Convert a name to PascalCase.
 *
 * snake_case → PascalCase: user_account → UserAccount
 * camelCase → PascalCase: userAccount → UserAccount
 * SCREAMING_SNAKE → PascalCase: USER_ACCOUNT → UserAccount
 */
export function toPascalCase(name: string): string {
  if (name.length === 0) {
    return '';
  }

  if (name.indexOf('_') !== -1) {
    let start = 0;
    while (start < name.length && name.charCodeAt(start) === 95) {
      start++;
    }
    if (start >= name.length) {
      return '';
    }

    let end = start;
    while (end < name.length && name.charCodeAt(end) !== 95) {
      end++;
    }
    let result = name.charAt(start).toUpperCase() + name.slice(start + 1, end).toLowerCase();

    let segStart = end + 1;
    while (segStart < name.length) {
      while (segStart < name.length && name.charCodeAt(segStart) === 95) {
        segStart++;
      }
      if (segStart >= name.length) {
        break;
      }
      let segEnd = segStart;
      while (segEnd < name.length && name.charCodeAt(segEnd) !== 95) {
        segEnd++;
      }
      result +=
        name.charAt(segStart).toUpperCase() + name.slice(segStart + 1, segEnd).toLowerCase();
      segStart = segEnd + 1;
    }
    return result;
  }

  return name.charAt(0).toUpperCase() + name.slice(1);
}
