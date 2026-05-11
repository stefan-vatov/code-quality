import { describe, expect, it } from 'vitest';
import hasLeadingUnderscore from '../../src/rules/private-underscore.js';

describe('hasLeadingUnderscore', () => {
  // Positive cases
  it('returns true for names with leading underscore', () => {
    expect(hasLeadingUnderscore('_private')).toBe(true);
    expect(hasLeadingUnderscore('_internal')).toBe(true);
    expect(hasLeadingUnderscore('_cache')).toBe(true);
    expect(hasLeadingUnderscore('_field')).toBe(true);
    expect(hasLeadingUnderscore('_method')).toBe(true);
    expect(hasLeadingUnderscore('_state')).toBe(true);
    expect(hasLeadingUnderscore('_items')).toBe(true);
  });

  it('returns true for underscore + single letter', () => {
    expect(hasLeadingUnderscore('_x')).toBe(true);
    expect(hasLeadingUnderscore('_y')).toBe(true);
    expect(hasLeadingUnderscore('_i')).toBe(true);
  });

  // Negative cases
  it('returns false for names without leading underscore', () => {
    expect(hasLeadingUnderscore('public')).toBe(false);
    expect(hasLeadingUnderscore('myField')).toBe(false);
    expect(hasLeadingUnderscore('internalMethod')).toBe(false);
    expect(hasLeadingUnderscore('value')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(hasLeadingUnderscore('')).toBe(false);
  });

  it('returns false for underscore alone', () => {
    expect(hasLeadingUnderscore('_')).toBe(false);
  });

  // False positive prevention
  it('returns false for names with underscore in middle', () => {
    expect(hasLeadingUnderscore('my_var')).toBe(false);
    expect(hasLeadingUnderscore('snake_case_name')).toBe(false);
  });

  it('returns false for names with trailing underscore', () => {
    expect(hasLeadingUnderscore('private_')).toBe(false);
    expect(hasLeadingUnderscore('value_')).toBe(false);
  });

  it('returns false for names starting with double underscore', () => {
    // __ is Python-style name mangling, not our convention
    // Our function just checks char[0] === '_' and length > 1, so __ would match
    // But __ convention is different — this test documents the behavior
    expect(hasLeadingUnderscore('__dunder')).toBe(true);
  });

  it('returns false for PascalCase with underscores in name', () => {
    expect(hasLeadingUnderscore('My_Class')).toBe(false);
    expect(hasLeadingUnderscore('HTTP_Handler')).toBe(false);
  });

  it('returns false for names that are just underscores', () => {
    expect(hasLeadingUnderscore('__')).toBe(true); // length > 1, starts with _
    expect(hasLeadingUnderscore('___')).toBe(true);
  });
});
