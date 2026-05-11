/**
 * Check if a name follows camelCase convention.
 *
 * camelCase: starts with a lowercase letter, contains no underscores.
 * Leading underscores are not camelCase (private member convention).
 */
function isCamelCase(name: string): boolean {
  if (name.length === 0) {
    return false;
  }
  if (name[0] < 'a' || name[0] > 'z') {
    return false;
  }
  if (name.includes('_')) {
    return false;
  }
  return true;
}

/**
 * Check if a name follows UPPER_CASE (SCREAMING_SNAKE_CASE) convention.
 * Used for constants: `MAX_RETRIES`, `API_KEY`, `DEFAULT_TIMEOUT`.
 */
function isUpperCase(name: string): boolean {
  if (name.length === 0) {
    return false;
  }
  return /^[A-Z][A-Z0-9_]*$/.test(name);
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
  if (name.includes('_')) {
    const parts = name.split('_').filter(Boolean);
    return (
      parts[0].toLowerCase() +
      parts
        .slice(1)
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join('')
    );
  }
  return name.charAt(0).toLowerCase() + name.slice(1);
}

export { isCamelCase, isUpperCase, toCamelCase };
