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
  // Next character must be underscore, uppercase, or digit (not lowercase,
  // Which would indicate a single word like "island")
  return next === '_' || (next >= 'A' && next <= 'Z') || (next >= '0' && next <= '9');
}
