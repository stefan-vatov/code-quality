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
export default function hasBooleanPrefix(name: string): boolean {
  const match = /^(is|has|should)(.)/i.exec(name);
  if (!match) {
    return false;
  }
  const [, , next] = match;
  return next === '_' || (next >= 'A' && next <= 'Z') || (next >= '0' && next <= '9');
}

/**
 * Suggest a boolean-prefixed name by prepending `is_`.
 *
 * camelCase: visible → isVisible
 * snake_case: visible_flag → is_visible_flag
 * SCREAMING: VISIBLE → IS_VISIBLE
 * PascalCase: Visible → isVisible
 */
export function suggestBooleanName(name: string): string {
  if (name.length === 0) {
    return 'isEnabled';
  }
  // All-caps (with or without underscores): IS_ prefix
  if (name === name.toUpperCase() && /[A-Z]/.test(name)) {
    return `IS_${name}`;
  }
  // Snake_case (lowercase): is_ prefix
  if (name.includes('_')) {
    return `is_${name}`;
  }
  // PascalCase: is + Name
  if (name[0] >= 'A' && name[0] <= 'Z') {
    return `is${name}`;
  }
  // CamelCase: is + Capitalized
  return `is${name.charAt(0).toUpperCase()}${name.slice(1)}`;
}
