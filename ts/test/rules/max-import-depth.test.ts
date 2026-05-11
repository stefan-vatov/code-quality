import { describe, it, expect } from 'vitest';
import countImportDepth from '../../src/rules/max-import-depth.js';

describe('max-import-depth rule logic', () => {
  it('returns 0 for non-relative import', () => {
    expect(countImportDepth('react')).toBe(0);
    expect(countImportDepth('lodash/map')).toBe(0);
    expect(countImportDepth('@scope/pkg/foo')).toBe(0);
  });

  it('returns 0 for same-directory import', () => {
    expect(countImportDepth('./foo')).toBe(0);
    expect(countImportDepth('./utils/bar')).toBe(0);
    expect(countImportDepth('./deep/nested/path')).toBe(0);
  });

  it('returns 1 for single parent import', () => {
    expect(countImportDepth('../foo')).toBe(1);
    expect(countImportDepth('../utils/bar')).toBe(1);
  });

  it('returns correct depth for multi-parent import', () => {
    expect(countImportDepth('../../foo')).toBe(2);
    expect(countImportDepth('../../../foo')).toBe(3);
    expect(countImportDepth('../../../../foo')).toBe(4);
    expect(countImportDepth('../../../../../foo')).toBe(5);
  });

  it('returns correct depth with nested paths after ../', () => {
    expect(countImportDepth('../../utils/bar')).toBe(2);
    expect(countImportDepth('../../../deep/nested/path')).toBe(3);
    expect(countImportDepth('../../../../some/very/deep/path')).toBe(4);
  });

  it('returns correct depth at max boundary', () => {
    expect(countImportDepth('../foo')).toBe(1);
    expect(countImportDepth('../../../foo')).toBe(3);
    expect(countImportDepth('../../../../foo')).toBe(4);
  });

  it('handles edge case empty string', () => {
    expect(countImportDepth('')).toBe(0);
  });

  it('handles ../ at end of path correctly', () => {
    expect(countImportDepth('../')).toBe(1);
  });

  it('does not confuse .../ with ../', () => {
    expect(countImportDepth('.../foo')).toBe(0);
  });

  it('handles ./../ correctly (0 since does not start with ../)', () => {
    expect(countImportDepth('./../foo')).toBe(0);
  });
});
