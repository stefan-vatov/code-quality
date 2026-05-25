import { describe, expect, it } from 'vitest';
import findLongLines from '../../src/rules/max-line-length';

describe('max-line-length rule logic', (): void => {
  it('returns no violations for files shorter than the maximum line length', (): void => {
    expect(findLongLines('short file', 20)).toEqual([]);
  });

  it('returns no violations for lines at the configured limit', (): void => {
    expect(findLongLines('a'.repeat(150))).toEqual([]);
  });

  it('returns one-based line numbers for long lines', (): void => {
    expect(findLongLines(['short', 'b'.repeat(151), 'also short'].join('\n'))).toEqual([
      { line: 2, length: 151 },
    ]);
  });

  it('ignores long URLs', (): void => {
    expect(findLongLines(`const url = "https://${'a'.repeat(160)}.example.com";`)).toEqual([]);
  });

  it('does not count CRLF carriage returns as line content', (): void => {
    expect(findLongLines(`${'a'.repeat(150)}\r\nshort`)).toEqual([]);
  });

  it('reports a long final line without requiring a trailing newline', (): void => {
    expect(findLongLines(['short', 'b'.repeat(151)].join('\n'))).toEqual([
      { line: 2, length: 151 },
    ]);
  });
});
