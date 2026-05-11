import { describe, expect, it } from 'vitest';
import hasBooleanPrefix from '../../src/rules/boolean-prefix.js';

describe('hasBooleanPrefix', () => {
  it('returns true for is_ prefix (camelCase)', () => {
    expect(hasBooleanPrefix('isEnabled')).toBe(true);
    expect(hasBooleanPrefix('isActive')).toBe(true);
    expect(hasBooleanPrefix('isLoading')).toBe(true);
  });

  it('returns true for has_ prefix', () => {
    expect(hasBooleanPrefix('hasAccess')).toBe(true);
    expect(hasBooleanPrefix('hasPermission')).toBe(true);
    expect(hasBooleanPrefix('hasChildren')).toBe(true);
  });

  it('returns true for should_ prefix', () => {
    expect(hasBooleanPrefix('shouldUpdate')).toBe(true);
    expect(hasBooleanPrefix('shouldRender')).toBe(true);
    expect(hasBooleanPrefix('shouldRetry')).toBe(true);
  });

  it('returns true for boolean prefixes in snake_case', () => {
    expect(hasBooleanPrefix('is_enabled')).toBe(true);
    expect(hasBooleanPrefix('has_access')).toBe(true);
    expect(hasBooleanPrefix('should_update')).toBe(true);
  });

  it('returns true for SCREAMING_SNAKE_CASE booleans', () => {
    expect(hasBooleanPrefix('IS_ENABLED')).toBe(true);
    expect(hasBooleanPrefix('HAS_ACCESS')).toBe(true);
  });

  it('returns false for non-boolean names', () => {
    expect(hasBooleanPrefix('userName')).toBe(false);
    expect(hasBooleanPrefix('getData')).toBe(false);
    expect(hasBooleanPrefix('count')).toBe(false);
    expect(hasBooleanPrefix('')).toBe(false);
  });

  it('returns false for words that start with is/has/should but are not prefixes', () => {
    expect(hasBooleanPrefix('island')).toBe(false); // no camelCase boundary after
    expect(hasBooleanPrefix('hastily')).toBe(false);
    expect(hasBooleanPrefix('issue')).toBe(false);
    expect(hasBooleanPrefix('is')).toBe(false);
  });
});
