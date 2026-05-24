import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const pluginPath = fileURLToPath(new URL('../../src/rules/plugin.ts', import.meta.url));
const acronymCasePath = fileURLToPath(new URL('../../src/rules/acronym-case.ts', import.meta.url));

describe('The Thracian plugin source cache performance invariant', () => {
  it('shares source text across Program rules instead of reading each file per rule', () => {
    const source = readFileSync(pluginPath, 'utf-8');

    expect(source).toContain('function readSource(context: Context)');
    expect(source.match(/readFileSync\(context\.filename/g) ?? []).toHaveLength(0);
  });

  it('scans comment markers directly without splitting every source file into lines', () => {
    const source = readFileSync(pluginPath, 'utf-8');

    expect(source).not.toContain("source.split('\\n')");
    expect(source).toContain('function reportCommentedOutCode');
  });

  it('does not mutate acronym LRU cache entries on hot hits', () => {
    const source = readFileSync(acronymCasePath, 'utf-8');

    expect(source).not.toContain('violationCache.delete(name)');
  });
});
