import { describe, expect, it } from 'vitest';
import findLongLines from '../../src/rules/max-line-length.js';

describe('max-line-length rule logic', () => {
  it('returns no violations for lines at the configured limit', () => {
    expect(findLongLines('a'.repeat(150))).toEqual([]);
  });

  it('returns one-based line numbers for long lines', () => {
    expect(findLongLines(['short', 'b'.repeat(151), 'also short'].join('\n'))).toEqual([
      { line: 2, length: 151 },
    ]);
  });

  it('ignores long URLs', () => {
    expect(findLongLines(`const url = "https://${'a'.repeat(160)}.example.com";`)).toEqual([]);
  });
});
