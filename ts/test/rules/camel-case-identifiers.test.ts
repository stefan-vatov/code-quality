import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isCamelCase, isUpperCase, toCamelCase } from '../../src/rules/camel-case-identifiers';

const fixturesDir = join(import.meta.dirname, 'fixtures', 'camel-case-identifiers');

describe('isCamelCase', () => {
  it('returns false for empty string', () => {
    expect(isCamelCase('')).toBe(false);
  });

  it('returns true for camelCase', () => {
    expect(isCamelCase('foo')).toBe(true);
    expect(isCamelCase('userName')).toBe(true);
    expect(isCamelCase('getUserData')).toBe(true);
  });

  it('returns true for single lowercase letter', () => {
    expect(isCamelCase('h')).toBe(true);
    expect(isCamelCase('x')).toBe(true);
    expect(isCamelCase('a')).toBe(true);
    expect(isCamelCase('z')).toBe(true);
  });

  it('returns true for camelCase with numbers', () => {
    expect(isCamelCase('count123')).toBe(true);
    expect(isCamelCase('item2')).toBe(true);
    expect(isCamelCase('user2name')).toBe(true); // number in middle
  });

  it('returns false for PascalCase', () => {
    expect(isCamelCase('UserName')).toBe(false);
    expect(isCamelCase('GetUserData')).toBe(false);
    expect(isCamelCase('FooBar')).toBe(false);
  });

  it('returns false for snake_case', () => {
    expect(isCamelCase('user_name')).toBe(false);
    expect(isCamelCase('get_user_data')).toBe(false);
    expect(isCamelCase('a_b')).toBe(false);
  });

  it('returns false for SCREAMING_SNAKE_CASE', () => {
    expect(isCamelCase('MAX_RETRIES')).toBe(false);
    expect(isCamelCase('API_KEY')).toBe(false);
    expect(isCamelCase('UPPER')).toBe(false);
  });

  it('returns false for names starting with underscore', () => {
    expect(isCamelCase('_private')).toBe(false);
    expect(isCamelCase('_internal')).toBe(false);
  });

  it('returns false for names starting with digit', () => {
    expect(isCamelCase('1foo')).toBe(false);
    expect(isCamelCase('0index')).toBe(false);
  });

  // False positive prevention
  it('returns false for empty-like inputs', () => {
    expect(isCamelCase('')).toBe(false);
  });
});

describe('isUpperCase', () => {
  it('returns false for empty string', () => {
    expect(isUpperCase('')).toBe(false);
  });

  it('returns true for SCREAMING_SNAKE_CASE', () => {
    expect(isUpperCase('MAX_RETRIES')).toBe(true);
    expect(isUpperCase('API_KEY')).toBe(true);
    expect(isUpperCase('DEFAULT_TIMEOUT')).toBe(true);
    expect(isUpperCase('MIN')).toBe(true);
  });

  it('returns true for all caps without underscores', () => {
    expect(isUpperCase('URLPARSER')).toBe(true);
    expect(isUpperCase('FOO')).toBe(true);
    expect(isUpperCase('ABC')).toBe(true);
  });

  it('returns true for all caps with numbers', () => {
    expect(isUpperCase('TIMEOUT2')).toBe(true);
    expect(isUpperCase('STATUS_404')).toBe(true);
    expect(isUpperCase('CODE200')).toBe(true);
  });

  it('returns false for camelCase', () => {
    expect(isUpperCase('userName')).toBe(false);
    expect(isUpperCase('getData')).toBe(false);
  });

  it('returns false for PascalCase', () => {
    expect(isUpperCase('UserName')).toBe(false);
    expect(isUpperCase('MyClass')).toBe(false);
  });

  it('returns false for snake_case', () => {
    expect(isUpperCase('api_key')).toBe(false);
    expect(isUpperCase('user_name')).toBe(false);
  });

  it('returns false for single lowercase letter', () => {
    expect(isUpperCase('a')).toBe(false);
    expect(isUpperCase('x')).toBe(false);
  });

  it('returns false for mixed case with single uppercase', () => {
    expect(isUpperCase('Abc')).toBe(false);
    expect(isUpperCase('aBC')).toBe(false);
  });

  it('returns false for strings with only underscores', () => {
    expect(isUpperCase('_')).toBe(false);
    expect(isUpperCase('__')).toBe(false);
  });
});

function extractNames(source: string): string[] {
  const clean = source.replace(/\/\/.*$/gm, '');
  const results: string[] = [];
  // let/var/const variable declarations
  const varRe = /(?:let|var|const)\s+(\w+)\s*[:=]/g;
  let m: RegExpExecArray | null = null;
  while ((m = varRe.exec(clean)) !== null) {
    if (m[1] !== 'true' && m[1] !== 'false') results.push(m[1]);
  }
  // function declarations
  const fnRe = /function\s+(\w+)/g;
  while ((m = fnRe.exec(clean)) !== null) results.push(m[1]);
  // parameter: (name: type) or (name)
  const paramRe = /\(\s*(\w+)\s*[:,)]/g;
  while ((m = paramRe.exec(clean)) !== null) {
    if (
      ![
        'string',
        'number',
        'boolean',
        'void',
        'true',
        'false',
        'function',
        'const',
        'let',
        'var',
      ].includes(m[1])
    ) {
      results.push(m[1]);
    }
  }
  return results;
}

describe('camel-case valid fixtures', () => {
  it('all identifiers in valid fixture are camelCase or UPPER_CASE', () => {
    const source = readFileSync(join(fixturesDir, 'valid.ts'), 'utf-8');
    const names = extractNames(source);
    const violations = names.filter((n) => !isCamelCase(n) && !isUpperCase(n));
    expect(violations).toEqual([]);
    expect(names.length).toBeGreaterThan(0);
  });
});

describe('camel-case invalid fixtures', () => {
  it('identifiers in invalid fixture violate camelCase', () => {
    const source = readFileSync(join(fixturesDir, 'invalid.ts'), 'utf-8');
    const names = extractNames(source);
    // Not EVERY name in the file is invalid — function names may be valid
    // but the parameters/classes inside are invalid. Check that at least
    // some violations are found.
    const violations = names.filter((n) => !isCamelCase(n) && !isUpperCase(n));
    expect(violations.length).toBeGreaterThan(0);
    expect(names.length).toBeGreaterThan(0);
  });
});

describe('toCamelCase', () => {
  it('converts snake_case to camelCase', () => {
    expect(toCamelCase('user_name')).toBe('userName');
    expect(toCamelCase('get_user_data')).toBe('getUserData');
  });

  it('converts SCREAMING_SNAKE to camelCase', () => {
    expect(toCamelCase('USER_NAME')).toBe('userName');
    expect(toCamelCase('API_KEY')).toBe('apiKey');
  });

  it('converts PascalCase to camelCase', () => {
    expect(toCamelCase('UserName')).toBe('userName');
    expect(toCamelCase('GetUserData')).toBe('getUserData');
  });

  it('handles empty string', () => {
    expect(toCamelCase('')).toBe('');
  });

  it('preserves digits', () => {
    expect(toCamelCase('foo2')).toBe('foo2');
    expect(toCamelCase('my_var_3')).toBe('myVar3');
  });
});
