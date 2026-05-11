/**
 * Check if a variable name has a boolean prefix (is_, has_, should_).
 *
 * Boolean variables should signal their intent clearly with a prefix.
 * Accepted prefixes: `is_` (isEnabled), `has_` (hasPermission), `should_` (shouldUpdate).
 *
 * In camelCase: `isEnabled`, `hasAccess`, `shouldReload`.
 * In snake_case: `is_enabled`, `has_access`, `should_reload`.
 * In SCREAMING_SNAKE: `IS_ENABLED`, `HAS_ACCESS`.
 */

/** Check if char at pos is the given lowercase letter (case-insensitive). */
function isCharCI(str: string, pos: number, lowerCode: number): boolean {
  const ch = str.charCodeAt(pos);
  return ch === lowerCode || ch === lowerCode - 32;
}

/** Check if string consists only of uppercase letters (and optionally digits/underscores). */
function isAllCaps(name: string): boolean {
  for (let idx = 0; idx < name.length; idx++) {
    const ch = name.charCodeAt(idx);
    // Allow A-Z, 0-9, _
    if (!((ch >= 65 && ch <= 90) || (ch >= 48 && ch <= 57) || ch === 95)) {
      return false;
    }
  }
  // Must have at least one letter
  return /[A-Z]/.test(name);
}

export default function hasBooleanPrefix(name: string): boolean {
  const len = name.length;
  if (len < 3) {
    return false;
  }

  const c0 = name.charCodeAt(0);
  // 'i' (105) or 'I' (73) → "is" prefix
  if (c0 === 105 || c0 === 73) {
    const c1 = name.charCodeAt(1);
    if (c1 !== 115 && c1 !== 83) {
      return false;
    } // 's'/'S'
    const next = name.charCodeAt(2);
    return next === 95 || (next >= 65 && next <= 90) || (next >= 48 && next <= 57);
  }
  // 'h' (104) or 'H' (72) → "has" prefix
  if (c0 === 104 || c0 === 72) {
    if (len < 4) {
      return false;
    }
    const c1 = name.charCodeAt(1);
    if (c1 !== 97 && c1 !== 65) {
      return false;
    } // 'a'/'A'
    const c2 = name.charCodeAt(2);
    if (c2 !== 115 && c2 !== 83) {
      return false;
    } // 's'/'S'
    const next = name.charCodeAt(3);
    return next === 95 || (next >= 65 && next <= 90) || (next >= 48 && next <= 57);
  }
  // 's' (115) or 'S' (83) → "should" prefix
  if (c0 === 115 || c0 === 83) {
    if (len < 7) {
      return false;
    }
    if (!isCharCI(name, 1, 104)) {
      return false;
    } // 'h'
    if (!isCharCI(name, 2, 111)) {
      return false;
    } // 'o'
    if (!isCharCI(name, 3, 117)) {
      return false;
    } // 'u'
    if (!isCharCI(name, 4, 108)) {
      return false;
    } // 'l'
    if (!isCharCI(name, 5, 100)) {
      return false;
    } // 'd'
    const next = name.charCodeAt(6);
    return next === 95 || (next >= 65 && next <= 90) || (next >= 48 && next <= 57);
  }
  return false;
}

/**
 * Suggest a boolean-prefixed name by prepending `is`.
 */
export function suggestBooleanName(name: string): string {
  if (name.length === 0) {
    return 'isEnabled';
  }

  // All-caps (with or without underscores): IS_ prefix
  if (isAllCaps(name)) {
    return `IS_${name}`;
  }
  // Snake_case (lowercase): is_ prefix
  if (name.indexOf('_') !== -1) {
    return `is_${name}`;
  }
  // PascalCase: is + Name
  if (name.charCodeAt(0) >= 65 && name.charCodeAt(0) <= 90) {
    return `is${name}`;
  }
  // CamelCase: is + Capitalized
  return `is${name.charAt(0).toUpperCase()}${name.slice(1)}`;
}
