import { describe, expect, it, vi } from 'vitest';
import { readCachedSource } from '../../src/rules/source-cache';

describe('source cache hot path', () => {
  it('does not call sourceCode.getText more than once for the same source object', () => {
    const getText = vi.fn(() => 'const value = 1;\n');
    const sourceCode = { getText };
    const context = { sourceCode };

    expect(readCachedSource(context)).toBe('const value = 1;\n');
    expect(readCachedSource(context)).toBe('const value = 1;\n');
    expect(readCachedSource(context)).toBe('const value = 1;\n');

    expect(getText).toHaveBeenCalledTimes(1);
  });
});
