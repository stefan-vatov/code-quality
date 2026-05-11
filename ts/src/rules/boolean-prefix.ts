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
 * PascalCase: Visible → IsVisible
 */
export function suggestBooleanName(name: string): string {
  if (name.length === 0) {
    return 'isEnabled';
  }
  // Snake/UPPER-case: add is_ prefix
  if (name.includes('_')) {
    const prefix = name === name.toUpperCase() ? 'IS_' : 'is_';
    return prefix + name;
  }
  // PascalCase: Is + Name
  if (name[0] >= 'A' && name[0] <= 'Z') {
    return `is${name}`;
  }
  // CamelCase: is + Capitalized
  return `is${name.charAt(0).toUpperCase()}${name.slice(1)}`;
}
