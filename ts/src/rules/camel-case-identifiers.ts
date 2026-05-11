/**
 * Check if a name follows camelCase convention.
 *
 * camelCase: starts with a lowercase letter, contains no underscores.
 * Leading underscores are not camelCase (private member convention).
 */
function isCamelCase(name: string): boolean {
  const len = name.length;
  if (len === 0) {
    return false;
  }

  // First char must be lowercase letter
  const first = name.charCodeAt(0);
  if (first < 97 || first > 122) {
    return false;
  }

  // Must not contain underscores
  return name.indexOf('_') === -1;
}

/**
 * Check if a name follows UPPER_CASE (SCREAMING_SNAKE_CASE) convention.
 * Used for constants: `MAX_RETRIES`, `API_KEY`, `DEFAULT_TIMEOUT`.
 */
function isUpperCase(name: string): boolean {
  const len = name.length;
  if (len === 0) {
    return false;
  }
  const first = name.charCodeAt(0);
  if (first < 65 || first > 90) {
    return false;
  }
  for (let idx = 1; idx < len; idx++) {
    const ch = name.charCodeAt(idx);
    if (!((ch >= 65 && ch <= 90) || (ch >= 48 && ch <= 57) || ch === 95)) {
      return false;
    }
  }
  return true;
}

/**
 * Convert a name to camelCase.
 *
 * snake_case → camelCase: user_name → userName
 * PascalCase → camelCase: UserName → userName
 * SCREAMING_SNAKE → camelCase: USER_NAME → userName
 */
function toCamelCase(name: string): string {
  if (name.length === 0) {
    return '';
  }

  if (name.indexOf('_') !== -1) {
    // Find first non-empty segment
    let start = 0;
    while (start < name.length && name.charCodeAt(start) === 95) {
      start++;
    }
    if (start >= name.length) {
      return '';
    }

    // Find end of first segment
    let end = start;
    while (end < name.length && name.charCodeAt(end) !== 95) {
      end++;
    }
    let result = name.slice(start, end).toLowerCase();

    // Process remaining segments
    let segStart = end + 1;
    while (segStart < name.length) {
      // Skip underscores
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
      const word = name.slice(segStart, segEnd);
      result += word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
      segStart = segEnd + 1;
    }
    return result;
  }

  return name.charAt(0).toLowerCase() + name.slice(1);
}

export { isCamelCase, isUpperCase, toCamelCase };
