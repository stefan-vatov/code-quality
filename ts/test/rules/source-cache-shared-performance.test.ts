import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const effectCorePath = fileURLToPath(
  new URL('../../src/rules/effect-rule-core.ts', import.meta.url),
);
const sourceCachePath = fileURLToPath(new URL('../../src/rules/source-cache.ts', import.meta.url));

describe('first-party rule source cache sharing', () => {
  it('uses the cached source reader for Effect Program rules', () => {
    const effectCoreSource = readFileSync(effectCorePath, 'utf-8');

    expect(effectCoreSource).toContain("from './source-cache'");
  });

  it('does not mutate the file-source LRU map on hot cache hits', () => {
    const sourceCache = readFileSync(sourceCachePath, 'utf-8');

    expect(sourceCache).not.toContain('fileSourceCache.delete(context.filename)');
  });
});
