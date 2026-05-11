import { describe, expect, it } from 'vitest';
import { isCamelCase } from '../../src/rules/camel-case-identifiers.js';

describe('isCamelCase', () => {
  it('returns false for empty string', () => {
    expect(isCamelCase('')).toBe(false);
  });

  it('returns true for camelCase', () => {
    expect(isCamelCase('foo')).toBe(true);
    expect(isCamelCase('userName')).toBe(true);
    expect(isCamelCase('getUserData')).toBe(true);
    expect(isCamelCase('h')).toBe(true); // single letter
    expect(isCamelCase('count123')).toBe(true);
  });

  it('returns false for PascalCase', () => {
    expect(isCamelCase('UserName')).toBe(false);
    expect(isCamelCase('GetUserData')).toBe(false);
  });

  it('returns false for snake_case', () => {
    expect(isCamelCase('user_name')).toBe(false);
    expect(isCamelCase('get_user_data')).toBe(false);
  });

  it('returns false for SCREAMING_SNAKE_CASE', () => {
    expect(isCamelCase('MAX_RETRIES')).toBe(false);
    expect(isCamelCase('API_KEY')).toBe(false);
  });

  it('returns false for names starting with underscore', () => {
    // Leading underscore is a separate convention (private members), not camelCase
    expect(isCamelCase('_private')).toBe(false);
  });
});
