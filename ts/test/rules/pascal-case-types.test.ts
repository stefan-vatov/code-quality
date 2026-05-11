import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import isPascalCase from '../../src/rules/pascal-case-types.js';

const fixturesDir = join(import.meta.dirname, 'fixtures', 'pascal-case-types');

describe('isPascalCase', () => {
  it('returns false for empty string', () => {
    expect(isPascalCase('')).toBe(false);
  });

  it('returns false for lowercase start', () => {
    expect(isPascalCase('foo')).toBe(false);
    expect(isPascalCase('userAccount')).toBe(false);
  });

  it('returns true for PascalCase', () => {
    expect(isPascalCase('UserAccount')).toBe(true);
    expect(isPascalCase('Foo')).toBe(true);
    expect(isPascalCase('H')).toBe(true);
  });

  it('returns true for PascalCase with consecutive capitals (acronyms)', () => {
    expect(isPascalCase('HTTPSConnection')).toBe(true);
    expect(isPascalCase('URLParser')).toBe(true);
    expect(isPascalCase('XMLParser')).toBe(true);
  });

  it('returns false for snake_case', () => {
    expect(isPascalCase('my_class')).toBe(false);
    expect(isPascalCase('User_Account')).toBe(false);
  });

  it('returns false for SCREAMING_SNAKE_CASE', () => {
    expect(isPascalCase('HTTP_STATUS_CODE')).toBe(false);
  });

  it('returns false for all caps with no underscores', () => {
    expect(isPascalCase('URLPARSER')).toBe(false);
    expect(isPascalCase('HTTPSCONNECTION')).toBe(false);
  });

  it('returns false for names starting with underscore', () => {
    expect(isPascalCase('_Foo')).toBe(false);
  });
});

function extractTypeNames(source: string): string[] {
  // Strip single-line comments so regexes don't match inside them
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
