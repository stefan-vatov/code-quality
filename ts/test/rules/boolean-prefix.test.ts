import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import hasBooleanPrefix, { suggestBooleanName } from '../../src/rules/boolean-prefix';

const fixturesDir = join(import.meta.dirname, 'fixtures', 'boolean-prefix');

describe('hasBooleanPrefix', () => {
  // Positive cases
  it('returns true for is_ prefix (camelCase)', () => {
    expect(hasBooleanPrefix('isEnabled')).toBe(true);
    expect(hasBooleanPrefix('isActive')).toBe(true);
    expect(hasBooleanPrefix('isLoading')).toBe(true);
    expect(hasBooleanPrefix('isReady')).toBe(true);
    expect(hasBooleanPrefix('isOpen')).toBe(true);
    expect(hasBooleanPrefix('isVisible')).toBe(true);
    expect(hasBooleanPrefix('isPending')).toBe(true);
    expect(hasBooleanPrefix('isConnected')).toBe(true);
    expect(hasBooleanPrefix('isValid')).toBe(true);
  });

  it('returns true for has_ prefix', () => {
    expect(hasBooleanPrefix('hasAccess')).toBe(true);
    expect(hasBooleanPrefix('hasPermission')).toBe(true);
    expect(hasBooleanPrefix('hasChildren')).toBe(true);
    expect(hasBooleanPrefix('hasError')).toBe(true);
    expect(hasBooleanPrefix('hasFocus')).toBe(true);
  });

  it('returns true for should_ prefix', () => {
    expect(hasBooleanPrefix('shouldUpdate')).toBe(true);
    expect(hasBooleanPrefix('shouldRender')).toBe(true);
    expect(hasBooleanPrefix('shouldRetry')).toBe(true);
    expect(hasBooleanPrefix('shouldRefresh')).toBe(true);
    expect(hasBooleanPrefix('shouldAnimate')).toBe(true);
  });

  it('returns true for boolean prefixes in snake_case', () => {
    expect(hasBooleanPrefix('is_enabled')).toBe(true);
    expect(hasBooleanPrefix('has_access')).toBe(true);
    expect(hasBooleanPrefix('should_update')).toBe(true);
  });

  it('returns true for SCREAMING_SNAKE_CASE booleans', () => {
    expect(hasBooleanPrefix('IS_ENABLED')).toBe(true);
    expect(hasBooleanPrefix('HAS_ACCESS')).toBe(true);
    expect(hasBooleanPrefix('SHOULD_RETRY')).toBe(true);
  });

  it('returns true for PascalCase booleans', () => {
    expect(hasBooleanPrefix('IsEnabled')).toBe(true);
    expect(hasBooleanPrefix('HasAccess')).toBe(true);
    expect(hasBooleanPrefix('ShouldUpdate')).toBe(true);
  });

  // Negative cases (non-boolean names)
  it('returns false for non-boolean names', () => {
    expect(hasBooleanPrefix('userName')).toBe(false);
    expect(hasBooleanPrefix('getData')).toBe(false);
    expect(hasBooleanPrefix('count')).toBe(false);
    expect(hasBooleanPrefix('')).toBe(false);
    expect(hasBooleanPrefix('name')).toBe(false);
    expect(hasBooleanPrefix('email')).toBe(false);
    expect(hasBooleanPrefix('age')).toBe(false);
  });

  // False positive prevention
  it('returns false for words starting with is but are not boolean prefixes', () => {
    expect(hasBooleanPrefix('island')).toBe(false);
    expect(hasBooleanPrefix('isolation')).toBe(false);
    expect(hasBooleanPrefix('isotope')).toBe(false);
    expect(hasBooleanPrefix('isometric')).toBe(false);
    expect(hasBooleanPrefix('is')).toBe(false); // just 'is'
  });

  it('returns false for words starting with has but are not boolean prefixes', () => {
    expect(hasBooleanPrefix('hasten')).toBe(false);
    expect(hasBooleanPrefix('hash')).toBe(false);
    expect(hasBooleanPrefix('haste')).toBe(false);
    expect(hasBooleanPrefix('hasp')).toBe(false);
    expect(hasBooleanPrefix('has')).toBe(false); // just 'has'
  });

  it('returns false for words starting with should but are not boolean prefixes', () => {
    expect(hasBooleanPrefix('shoulder')).toBe(false);
    expect(hasBooleanPrefix('should')).toBe(false); // just 'should'
  });

  it('returns false for issue/issuer (close but not is_ prefix)', () => {
    expect(hasBooleanPrefix('issue')).toBe(false);
    expect(hasBooleanPrefix('issuer')).toBe(false);
    expect(hasBooleanPrefix('issuance')).toBe(false);
  });

  it('returns false for undefined-like inputs', () => {
    // Empty string already tested above
    expect(hasBooleanPrefix('a')).toBe(false); // single letter
  });
});

describe('boolean-prefix valid fixtures', () => {
  it('all boolean vars in valid fixture have correct prefix', () => {
    const source = readFileSync(join(fixturesDir, 'valid.ts'), 'utf-8');
    const clean = source.replace(/\/\/.*$/gm, '');
    const varRe = /(?:let|var|const)\s+(\w+)\s*[:=]/g;
    const names: string[] = [];
    let m: RegExpExecArray | null = null;
    while ((m = varRe.exec(clean)) !== null) {
      if (!['true', 'false'].includes(m[1])) names.push(m[1]);
    }
    const violations = names.filter((n) => !hasBooleanPrefix(n));
    expect(violations).toEqual([]);
    expect(names.length).toBeGreaterThan(0);
  });
});

describe('boolean-prefix invalid fixtures', () => {
  it('all boolean vars in invalid fixture lack correct prefix', () => {
    const source = readFileSync(join(fixturesDir, 'invalid.ts'), 'utf-8');
    const clean = source.replace(/\/\/.*$/gm, '');
    const varRe = /(?:let|var|const)\s+(\w+)\s*[:=]/g;
    const names: string[] = [];
    let m: RegExpExecArray | null = null;
    while ((m = varRe.exec(clean)) !== null) {
      if (!['true', 'false'].includes(m[1])) names.push(m[1]);
    }
    const passing = names.filter((n) => hasBooleanPrefix(n));
    expect(passing).toEqual([]);
    expect(names.length).toBeGreaterThan(0);
  });
});

describe('suggestBooleanName', () => {
  it('prefixes camelCase with is', () => {
    expect(suggestBooleanName('visible')).toBe('isVisible');
    expect(suggestBooleanName('active')).toBe('isActive');
    expect(suggestBooleanName('loading')).toBe('isLoading');
  });

  it('prefixes PascalCase with is', () => {
    expect(suggestBooleanName('Visible')).toBe('isVisible');
    expect(suggestBooleanName('Active')).toBe('isActive');
  });

  it('prefixes snake_case with is_', () => {
    expect(suggestBooleanName('visible_flag')).toBe('is_visible_flag');
  });

  it('prefixes SCREAMING_SNAKE with IS_', () => {
    expect(suggestBooleanName('VISIBLE')).toBe('IS_VISIBLE');
    expect(suggestBooleanName('ACTIVE_STATE')).toBe('IS_ACTIVE_STATE');
  });

  it('handles empty string', () => {
    expect(suggestBooleanName('')).toBe('isEnabled');
  });
});
