import { describe, expect, it } from 'vitest';
import { createWeightedCache } from '../../src/rules/source-cache';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const sourceText = (path: string): string => readFileSync(path, 'utf8');

const sourcePath = (filename: string): string =>
  fileURLToPath(new URL(`../../src/rules/${filename}`, import.meta.url));

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const makeCache = (
  maxEntries = 3,
  maxWeight = 10,
): ReturnType<typeof createWeightedCache<string, string>> =>
  createWeightedCache<string, string>({ maxEntries, maxWeight });

interface CacheIntegration {
  cacheName: string;
  isSourceCacheModule?: boolean;
  label: string;
  path: string;
}

const cacheIntegrations: readonly CacheIntegration[] = [
  {
    cacheName: 'fileSourceCache',
    isSourceCacheModule: true,
    label: 'file source',
    path: sourcePath('source-cache.ts'),
  },
  {
    cacheName: 'lineStartCache',
    label: 'line-start',
    path: sourcePath('effect-rule-core.ts'),
  },
  {
    cacheName: 'sourceTokenPresenceCache',
    label: 'source-token',
    path: sourcePath('effect-rule-core.ts'),
  },
  {
    cacheName: 'cache',
    label: 'navigation',
    path: sourcePath('effect-source-navigation-index.ts'),
  },
  {
    cacheName: 'regexIndexCache',
    label: 'regex',
    path: sourcePath('effect-source-regex-scan.ts'),
  },
  {
    cacheName: 'commentCache',
    label: 'comments',
    path: sourcePath('effect-source-comments.ts'),
  },
  {
    cacheName: 'codeOnlyCache',
    label: 'code projection',
    path: sourcePath('effect-source-scan.ts'),
  },
  {
    cacheName: 'sourceScopeCache',
    label: 'promise-scope',
    path: sourcePath('effect-sync-promise-scope-index.ts'),
  },
  {
    cacheName: 'effectAliasCache',
    label: 'Effect alias',
    path: sourcePath('effect-rule-aliases.ts'),
  },
  {
    cacheName: 'runtimeFunctionAliasCache',
    label: 'runtime function alias',
    path: sourcePath('effect-rule-aliases.ts'),
  },
  {
    cacheName: 'canonicalSourceCache',
    label: 'canonical source',
    path: sourcePath('effect-rule-aliases.ts'),
  },
  {
    cacheName: 'effectSignalCache',
    label: 'Effect signal',
    path: sourcePath('effect-rule-aliases.ts'),
  },
  {
    cacheName: 'runtimeCallCache',
    label: 'runtime call',
    path: sourcePath('effect-rule-aliases.ts'),
  },
  {
    cacheName: 'effectAliasesPatternCache',
    label: 'Effect alias pattern',
    path: sourcePath('effect-default-scan-helpers.ts'),
  },
  {
    cacheName: 'effectCallPatternCache',
    label: 'Effect call pattern',
    path: sourcePath('effect-default-scan-helpers.ts'),
  },
  {
    cacheName: 'exportedDeclarationCache',
    label: 'exported declaration',
    path: sourcePath('effect-exported-declarations.ts'),
  },
  {
    cacheName: 'exportedDeclarationSegmentCache',
    label: 'exported declaration segment',
    path: sourcePath('effect-exported-declarations.ts'),
  },
  {
    cacheName: 'exportedCallableDeclarationSegmentCache',
    label: 'exported callable declaration segment',
    path: sourcePath('effect-exported-declarations.ts'),
  },
  {
    cacheName: 'exportedDeclarationProjectionCache',
    label: 'exported declaration projection',
    path: sourcePath('effect-exported-declarations.ts'),
  },
  {
    cacheName: 'floatingEffectPatternCache',
    label: 'floating Effect pattern',
    path: sourcePath('effect-default-floating-helpers.ts'),
  },
  {
    cacheName: 'localEffectCallSegmentCache',
    label: 'local Effect call segment',
    path: sourcePath('effect-strict-segment-helpers.ts'),
  },
  {
    cacheName: 'enclosingEffectWrapperSegmentCache',
    label: 'enclosing Effect wrapper segment',
    path: sourcePath('effect-strict-segment-helpers.ts'),
  },
  {
    cacheName: 'globCache',
    label: 'glob',
    path: sourcePath('effect-path-options.ts'),
  },
  {
    cacheName: 'violationCache',
    label: 'acronym violation',
    path: sourcePath('acronym-case.ts'),
  },
];

describe('weighted source cache contract', (): void => {
  it('evicts the oldest entry when the maximum entry count is reached', (): void => {
    const cache = makeCache(2, 100);

    expect(cache.set('first', 'first', 1)).toBe('first');
    expect(cache.set('second', 'second', 1)).toBe('second');
    expect(cache.set('third', 'third', 1)).toBe('third');

    expect(cache.get('first')).toBeUndefined();
    expect(cache.get('second')).toBe('second');
    expect(cache.get('third')).toBe('third');
    expect(cache.size).toBe(2);
  });

  it('evicts enough oldest entries to satisfy the aggregate weight budget', (): void => {
    const cache = makeCache(4, 10);

    cache.set('first', 'first', 4);
    cache.set('second', 'second', 4);
    cache.set('third', 'third', 4);

    expect(cache.get('first')).toBeUndefined();
    expect(cache.get('second')).toBe('second');
    expect(cache.get('third')).toBe('third');
  });

  it('returns an oversized value without retaining it', (): void => {
    const cache = makeCache(3, 10);
    const value = 'oversized';

    expect(cache.set('oversized', value, 11)).toBe(value);

    expect(cache.get('oversized')).toBeUndefined();
    expect(cache.size).toBe(0);
  });

  it('adjusts aggregate weight when replacing an existing entry', (): void => {
    const cache = makeCache(3, 10);

    cache.set('first', 'first', 6);
    cache.set('second', 'second', 3);
    expect(cache.set('first', 'replacement', 2)).toBe('replacement');
    cache.set('third', 'third', 5);

    expect(cache.get('first')).toBe('replacement');
    expect(cache.get('second')).toBe('second');
    expect(cache.get('third')).toBe('third');
    expect(cache.size).toBe(3);
  });

  it('uses deterministic FIFO or LRU semantics when a hot entry is touched', (): void => {
    const survivors = (): readonly string[] => {
      const cache = makeCache(2, 100);

      cache.set('first', 'first', 1);
      cache.set('second', 'second', 1);
      expect(cache.get('first')).toBe('first');
      cache.set('third', 'third', 1);

      return ['first', 'second', 'third'].filter((key): boolean => cache.get(key) !== undefined);
    };

    const firstRun = survivors();
    const secondRun = survivors();

    expect([
      ['first', 'third'],
      ['second', 'third'],
    ]).toContainEqual(firstRun);
    expect(secondRun).toEqual(firstRun);
  });

  it.each([
    { label: 'zero', weight: 0 },
    { label: 'negative', weight: -4 },
    { label: 'NaN', weight: Number.NaN },
    { label: 'positive infinity', weight: Number.POSITIVE_INFINITY },
  ])('keeps %s weight from poisoning aggregate accounting', ({ weight }): void => {
    const cache = makeCache(4, 5);

    expect(cache.set('invalid', 'invalid', weight)).toBe('invalid');
    expect(cache.set('fits', 'fits', 5)).toBe('fits');
    expect(cache.set('overflow', 'overflow', 1)).toBe('overflow');

    expect(cache.get('fits')).toBeUndefined();
    expect(cache.get('overflow')).toBe('overflow');
    expect(cache.size).toBeLessThanOrEqual(4);
  });
});

describe('weighted source cache integrations', (): void => {
  it.each(cacheIntegrations)(
    'constructs the $label cache with both count and aggregate weight bounds',
    ({ cacheName, isSourceCacheModule, path }): void => {
      const source = sourceText(path);
      const cacheDeclaration = new RegExp(
        `\\b(?:const|let)\\s+${escapeRegExp(cacheName)}(?:\\s*:\\s*[^=;\\n]+)?\\s*=\\s*createWeightedCache\\s*\\(`,
      );

      if (!isSourceCacheModule) {
        expect(source).toMatch(/from ['"]\.\/source-cache['"]/);
      }
      expect(source).toMatch(cacheDeclaration);
      expect(source).toMatch(/\bmaxEntries\b/);
      expect(source).toMatch(/\b(?:maxWeight|maxBytes)\b/);
      expect(source).not.toMatch(new RegExp(`\\b${escapeRegExp(cacheName)}\\s*=\\s*new\\s+Map`));
    },
  );
});

describe('source token cache retention', (): void => {
  it('removes the redundant token-gate cache and source-keyed inner maps', (): void => {
    const source = sourceText(sourcePath('effect-rule-core.ts'));

    expect(source).not.toMatch(/\btokenGateCache\b/);
    expect(source).not.toMatch(/\bnewSourceCache\s*=\s*new\s+Map<string,\s*boolean>\s*\(\)/);
  });
});
