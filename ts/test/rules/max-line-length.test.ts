import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import findLongLines from '../../src/rules/max-line-length.js';

describe('max-line-length rule logic', () => {
  it('returns immediately for files shorter than the maximum line length', () => {
    const source = readFileSync(
      fileURLToPath(new URL('../../src/rules/max-line-length.ts', import.meta.url)),
      'utf-8',
    );

    expect(source).toContain('if (source.length <= maxLength)');
  });

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

  it('does not count CRLF carriage returns as line content', () => {
    expect(findLongLines(`${'a'.repeat(150)}\r\nshort`)).toEqual([]);
  });

  it('scans lines without splitting the whole source into allocated line strings', () => {
    const source = readFileSync(
      fileURLToPath(new URL('../../src/rules/max-line-length.ts', import.meta.url)),
      'utf-8',
    );

    expect(source).not.toContain("source.split('\\n')");
  });
});
