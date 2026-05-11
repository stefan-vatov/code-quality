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
  if (name[0] !== name[0].toUpperCase() || name[0] < 'A' || name[0] > 'Z') {
    return false;
  }
  if (name.includes('_')) {
    return false;
  }
  // Entirely uppercase multi-character is not PascalCase (constant convention),
  // But single uppercase letters (T, K) are valid type parameter names.
  // Strip digits before checking — F123 is PascalCase, not a constant.
  const letters = name.replace(/[^A-Za-z]/g, '');
  if (letters.length > 1 && letters === letters.toUpperCase()) {
    return false;
  }
  return true;
}
