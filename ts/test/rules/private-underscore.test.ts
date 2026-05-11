import { describe, expect, it } from 'vitest';
import hasLeadingUnderscore from '../../src/rules/private-underscore.js';

describe('hasLeadingUnderscore', () => {
  it('returns true for names with leading underscore', () => {
    expect(hasLeadingUnderscore('_private')).toBe(true);
    expect(hasLeadingUnderscore('_internal')).toBe(true);
    expect(hasLeadingUnderscore('_cache')).toBe(true);
  });

  it('returns false for names without leading underscore', () => {
    expect(hasLeadingUnderscore('public')).toBe(false);
    expect(hasLeadingUnderscore('myField')).toBe(false);
    expect(hasLeadingUnderscore('internalMethod')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(hasLeadingUnderscore('')).toBe(false);
  });

  it('returns false for underscore alone', () => {
    expect(hasLeadingUnderscore('_')).toBe(false);
  });
});
