import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import isPascalCase, { toPascalCase } from '../../src/rules/pascal-case-types.js';

const fixturesDir = join(import.meta.dirname, 'fixtures', 'pascal-case-types');

describe('isPascalCase', () => {
  it('returns false for empty string', () => {
    expect(isPascalCase('')).toBe(false);
  });

  it('returns false for lowercase start', () => {
    expect(isPascalCase('foo')).toBe(false);
    expect(isPascalCase('userAccount')).toBe(false);
    expect(isPascalCase('someName')).toBe(false);
  });

  it('returns true for PascalCase', () => {
    expect(isPascalCase('UserAccount')).toBe(true);
    expect(isPascalCase('Foo')).toBe(true);
    expect(isPascalCase('MyComponent')).toBe(true);
    expect(isPascalCase('DataService')).toBe(true);
  });

  it('returns true for single uppercase letter', () => {
    expect(isPascalCase('H')).toBe(true);
    expect(isPascalCase('T')).toBe(true);
    expect(isPascalCase('K')).toBe(true);
  });

  it('returns true for PascalCase with consecutive capitals (acronyms)', () => {
    expect(isPascalCase('HTTPSConnection')).toBe(true);
    expect(isPascalCase('URLParser')).toBe(true);
    expect(isPascalCase('XMLParser')).toBe(true);
    expect(isPascalCase('JSONSchema')).toBe(true);
    expect(isPascalCase('APIClient')).toBe(true);
    expect(isPascalCase('I18nHelper')).toBe(true); // I + 18n
  });

  it('returns false for snake_case', () => {
    expect(isPascalCase('my_class')).toBe(false);
    expect(isPascalCase('User_Account')).toBe(false);
    expect(isPascalCase('My_Type')).toBe(false);
  });

  it('returns false for SCREAMING_SNAKE_CASE', () => {
    expect(isPascalCase('HTTP_STATUS_CODE')).toBe(false);
    expect(isPascalCase('MAX_SIZE')).toBe(false);
  });

  it('returns false for all caps multi-character', () => {
    expect(isPascalCase('URLPARSER')).toBe(false);
    expect(isPascalCase('HTTPSCONNECTION')).toBe(false);
    expect(isPascalCase('FOOBAR')).toBe(false);
  });

  it('returns false for names starting with digit', () => {
    expect(isPascalCase('1Foo')).toBe(false);
    expect(isPascalCase('0Bar')).toBe(false);
  });

  it('returns false for names starting with underscore', () => {
    expect(isPascalCase('_Foo')).toBe(false);
    expect(isPascalCase('_MyClass')).toBe(false);
  });

  it('returns false for names with underscores in body', () => {
    expect(isPascalCase('Foo_Bar')).toBe(false);
    expect(isPascalCase('My_Component')).toBe(false);
  });

  it('returns false for camelCase', () => {
    expect(isPascalCase('userName')).toBe(false);
    expect(isPascalCase('getUserData')).toBe(false);
  });

  // False positive prevention
  it('returns true for single uppercase letters (type parameters)', () => {
    expect(isPascalCase('T')).toBe(true);
    expect(isPascalCase('K')).toBe(true);
    expect(isPascalCase('V')).toBe(true);
  });

  it('returns false for all-lowercase (not PascalCase just because no underscore)', () => {
    expect(isPascalCase('myclass')).toBe(false);
    expect(isPascalCase('foobar')).toBe(false);
  });

  it('handles mixed case with numbers correctly', () => {
    expect(isPascalCase('Foo123Bar')).toBe(true);
    expect(isPascalCase('F123')).toBe(true);
    expect(isPascalCase('f123')).toBe(false); // starts lowercase
  });
});

function extractTypeNames(source: string): string[] {
  const clean = source.replace(/\/\/.*$/gm, '');
  const classRe = /(?:export\s+)?(?:abstract\s+)?class\s+(\w+)/g;
  const ifaceRe = /(?:export\s+)?interface\s+(\w+)/g;
  const typeRe = /(?:export\s+)?type\s+(\w+)/g;
  const enumRe = /(?:export\s+)?enum\s+(\w+)/g;

  const names: string[] = [];
  let m: RegExpExecArray | null = null;
  while ((m = classRe.exec(clean)) !== null) {
    names.push(m[1]);
  }
  while ((m = ifaceRe.exec(clean)) !== null) {
    names.push(m[1]);
  }
  while ((m = typeRe.exec(clean)) !== null) {
    names.push(m[1]);
  }
  while ((m = enumRe.exec(clean)) !== null) {
    names.push(m[1]);
  }
  return names;
}

describe('pascal-case-types valid fixtures', () => {
  it('all types in valid fixture are PascalCase', () => {
    const source = readFileSync(join(fixturesDir, 'valid.ts'), 'utf-8');
    const names = extractTypeNames(source);
    const violations = names.filter((n) => !isPascalCase(n));
    expect(violations).toEqual([]);
    expect(names.length).toBeGreaterThan(0);
  });
});

describe('pascal-case-types invalid fixtures', () => {
  it('all types in invalid fixture violate PascalCase', () => {
    const source = readFileSync(join(fixturesDir, 'invalid.ts'), 'utf-8');
    const names = extractTypeNames(source);
    const passing = names.filter((n) => isPascalCase(n));
    expect(passing).toEqual([]);
    expect(names.length).toBeGreaterThan(0);
  });
});

describe('toPascalCase', () => {
  it('converts snake_case to PascalCase', () => {
    expect(toPascalCase('user_account')).toBe('UserAccount');
    expect(toPascalCase('my_class')).toBe('MyClass');
  });

  it('converts SCREAMING_SNAKE to PascalCase', () => {
    expect(toPascalCase('USER_ACCOUNT')).toBe('UserAccount');
    expect(toPascalCase('API_KEY')).toBe('ApiKey');
  });

  it('converts camelCase to PascalCase', () => {
    expect(toPascalCase('userAccount')).toBe('UserAccount');
    expect(toPascalCase('getUserData')).toBe('GetUserData');
  });

  it('handles empty string', () => {
    expect(toPascalCase('')).toBe('');
  });

  it('preserves trailing digits', () => {
    expect(toPascalCase('foo2')).toBe('Foo2');
    expect(toPascalCase('my_var_3')).toBe('MyVar3');
  });
});
