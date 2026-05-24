import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const sourceScanPath = fileURLToPath(
  new URL('../../src/rules/effect-source-scan.ts', import.meta.url),
);
const defaultHelpersPath = fileURLToPath(
  new URL('../../src/rules/effect-default-helpers.ts', import.meta.url),
);
const sourceHelpersPath = fileURLToPath(
  new URL('../../src/rules/effect-source-helpers.ts', import.meta.url),
);

describe('Effect source scanner performance invariants', () => {
  it('uses character classification helpers instead of regex tests in scanner loops', () => {
    const source = readFileSync(sourceScanPath, 'utf-8');

    expect(source).not.toMatch(/\/\\s\/\.test\(/);
    expect(source).not.toMatch(/\/\\\[\\w\$]\/\.test\(/);
    expect(source).not.toMatch(/\/\[a-z]\/i\.test\(/);
  });

  it('does not mutate bounded strip caches on hot cache hits', () => {
    const source = readFileSync(sourceScanPath, 'utf-8');

    expect(source).not.toContain('cache.delete(source)');
  });

  it('uses rolling previous-line state instead of per-line slice/reverse allocation', () => {
    const source = readFileSync(defaultHelpersPath, 'utf-8');

    expect(source).not.toContain('lines.slice(0, index)');
    expect(source).not.toContain('.reverse().find(');
  });

  it('reuses stripped source inside floating Effect detection', () => {
    const source = readFileSync(defaultHelpersPath, 'utf-8');

    expect(source).toContain('const code = stripCommentsAndStrings(source);');
    expect(source).toContain("const newlineIndex = code.indexOf('\\n', lineStart);");
    expect(source).not.toContain(".split('\\n')");
    expect(source).not.toContain("stripCommentsAndStrings(source).split('\\n')");
  });

  it('prefilters floating Effect lines before running regex bundles', () => {
    const source = readFileSync(defaultHelpersPath, 'utf-8');

    expect(source).toContain('function hasFloatingEffectCandidateLine');
    expect(source).toContain('if (!hasFloatingEffectCandidateLine(line, aliasNeedles))');
    expect(source).toContain('patterns ??= floatingEffectPatterns(aliases)');
  });

  it('short-circuits Effect workflow body scans without allocating body arrays', () => {
    const source = readFileSync(defaultHelpersPath, 'utf-8');

    expect(source).toContain('function someEffectWorkflowBody');
    expect(source).not.toContain('return effectWorkflowBodies(source).some');
  });

  it('does not mutate or copy exported-declaration cache hits', () => {
    const source = readFileSync(sourceHelpersPath, 'utf-8');

    expect(source).not.toContain('exportedDeclarationCache.delete(source)');
    expect(source).not.toContain('return [...cachedValue]');
    expect(source).not.toContain('return [...declarations]');
  });

  it('caches exported declaration segment projections separately from raw declarations', () => {
    const source = readFileSync(sourceHelpersPath, 'utf-8');

    expect(source).toContain('exportedDeclarationSegmentCache');
    expect(source).toContain('exportedCallableDeclarationSegmentCache');
    expect(source).toContain('cacheExportedDeclarationSegments');
    expect(source).toContain('cacheExportedCallableDeclarationSegments');
  });
});
