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
  if (name.length === 0) {
    return false;
  }
  if (name[0] < 'A' || name[0] > 'Z') {
    return false;
  }
  if (name.includes('_')) {
    return false;
  }
  const letters = name.replace(/[^A-Za-z]/g, '');
  if (letters.length > 1 && letters === letters.toUpperCase()) {
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
  if (name.includes('_')) {
    return name
      .split('_')
      .filter(Boolean)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join('');
  }
  return name.charAt(0).toUpperCase() + name.slice(1);
}
