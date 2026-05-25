import { afterEach, describe, expect, it, vi } from 'vitest';

describe('source cache hot path', () => {
  afterEach(() => {
    vi.doUnmock('node:fs');
    vi.resetModules();
  });

  it('does not call sourceCode.getText more than once for the same source object', async () => {
    vi.doMock('node:fs', () => ({
      readFileSync: vi.fn(),
      statSync: vi.fn(),
    }));

    const { readCachedSource } = await import('../../src/rules/source-cache');
    const getText = vi.fn(() => 'const value = 1;\n');
    const sourceCode = { getText };
    const context = { sourceCode };

    expect(readCachedSource(context)).toBe('const value = 1;\n');
    expect(readCachedSource(context)).toBe('const value = 1;\n');
    expect(readCachedSource(context)).toBe('const value = 1;\n');

    expect(getText).toHaveBeenCalledTimes(1);
  });
});
