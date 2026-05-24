import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const pluginPath = fileURLToPath(new URL('../../src/rules/plugin.ts', import.meta.url));
const effectCorePath = fileURLToPath(
  new URL('../../src/rules/effect-rule-core.ts', import.meta.url),
);
const sourceCachePath = fileURLToPath(new URL('../../src/rules/source-cache.ts', import.meta.url));

describe('first-party rule source cache sharing', () => {
  it('uses the same cached source reader for core and Effect Program rules', () => {
    const pluginSource = readFileSync(pluginPath, 'utf-8');
    const effectCoreSource = readFileSync(effectCorePath, 'utf-8');

    expect(pluginSource).toContain("from './source-cache.js'");
    expect(effectCoreSource).toContain("from './source-cache.js'");
  });

  it('does not mutate the file-source LRU map on hot cache hits', () => {
    const sourceCache = readFileSync(sourceCachePath, 'utf-8');

    expect(sourceCache).not.toContain('fileSourceCache.delete(context.filename)');
  });
});
