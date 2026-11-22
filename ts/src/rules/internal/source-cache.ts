import { Either, Match, Option, pipe } from 'effect';
import { readFileSync, statSync } from 'node:fs';

export interface SourceContext {
  filename?: string;
  sourceCode?: {
    getText?: () => string;
    text?: string;
  };
}

interface CachedFileSource {
  mtimeMs: number;
  size: number;
  source: string;
}

const CACHE_MEBIBYTE_BYTES = 1_048_576;
const UTF16_CODE_UNIT_BYTES = 2;
const FILE_SOURCE_CACHE_MAX_ENTRIES = 32;
const FILE_SOURCE_CACHE_MAX_MEBIBYTES = 10;
const FILE_SOURCE_CACHE_MAX_WEIGHT = FILE_SOURCE_CACHE_MAX_MEBIBYTES * CACHE_MEBIBYTE_BYTES;
const FILE_SOURCE_CACHE_METADATA_AND_OBJECT_OVERHEAD_BYTES = 128;

interface WeightedCacheConfig {
  maxEntries: number;
  maxWeight: number;
}

interface WeightedCacheEntry<Value> {
  value: Value;
  weight: number;
}

interface WeightedCache<Key, Value> {
  readonly size: number;
  get: (key: Key) => Value | undefined;
  set: (key: Key, value: Value, explicitWeight?: number) => Value;
}

export const createWeightedCache = <Key, Value>(
  config: WeightedCacheConfig,
): WeightedCache<Key, Value> => {
  const entries = new Map<Key, WeightedCacheEntry<Value>>();
  let totalWeight = 0;

  const isRetainableWeight = (weight: number): boolean =>
    Number.isFinite(weight) && weight > 0 && weight <= config.maxWeight;

  const evictToBounds = (): void => {
    while (entries.size > config.maxEntries || totalWeight > config.maxWeight) {
      const oldest = entries.entries().next();
      if (oldest.done) {
        return;
      }
      entries.delete(oldest.value[0]);
      totalWeight -= oldest.value[1].weight;
    }
  };

  const removeEntry = (key: Key): void => {
    const existingEntry = entries.get(key);
    if (existingEntry === undefined) {
      return;
    }
    entries.delete(key);
    totalWeight -= existingEntry.weight;
  };

  const replaceEntry = (key: Key, value: Value, weight: number): void => {
    const existingEntry = entries.get(key);
    if (existingEntry !== undefined) {
      totalWeight -= existingEntry.weight;
    }
    totalWeight += weight;
    entries.set(key, { value, weight });
  };

  return {
    get: (key: Key): Value | undefined => entries.get(key)?.value,
    set: (key: Key, value: Value, explicitWeight = 1): Value => {
      if (!isRetainableWeight(explicitWeight)) {
        removeEntry(key);
        return value;
      }

      replaceEntry(key, value, explicitWeight);
      evictToBounds();
      return value;
    },
    get size(): number {
      return entries.size;
    },
  };
};

const fileSourceCache: WeightedCache<string, CachedFileSource> = createWeightedCache({
  maxEntries: FILE_SOURCE_CACHE_MAX_ENTRIES,
  maxWeight: FILE_SOURCE_CACHE_MAX_WEIGHT,
});
const sourceCodeTextCache = new WeakMap<NonNullable<SourceContext['sourceCode']>, string>();

const fileSourceCacheWeight = (filename: string, cachedFileSource: CachedFileSource): number =>
  filename.length * UTF16_CODE_UNIT_BYTES +
  cachedFileSource.source.length * UTF16_CODE_UNIT_BYTES +
  FILE_SOURCE_CACHE_METADATA_AND_OBJECT_OVERHEAD_BYTES;

const cacheFileSource = (filename: string, cachedFileSource: CachedFileSource): string =>
  fileSourceCache.set(filename, cachedFileSource, fileSourceCacheWeight(filename, cachedFileSource))
    .source;

const uncachedSourceCodeText = (sourceCode: NonNullable<SourceContext['sourceCode']>): string => {
  const source = pipe(
    Option.fromNullable(sourceCode.getText),
    Option.match({
      onNone: (): string => '',
      onSome: (getText) => getText(),
    }),
  );
  sourceCodeTextCache.set(sourceCode, source);
  return source;
};

const readSourceCodeText = (sourceCode: NonNullable<SourceContext['sourceCode']>): string =>
  pipe(
    Option.fromNullable(sourceCode.text),
    Option.match({
      onNone: () =>
        pipe(
          Option.fromNullable(sourceCodeTextCache.get(sourceCode)),
          Option.match({
            onNone: () => uncachedSourceCodeText(sourceCode),
            onSome: (cachedSource) => cachedSource,
          }),
        ),
      onSome: (source) => source,
    }),
  );

const isFreshCachedSource = (
  cachedSource: CachedFileSource,
  stats: { mtimeMs: number; size: number },
): boolean => cachedSource.size === stats.size && cachedSource.mtimeMs === stats.mtimeMs;

const readFreshFileSource = (filename: string): string => {
  const stats = statSync(filename);
  return pipe(
    Option.fromNullable(fileSourceCache.get(filename)),
    Option.filter((cachedSource): boolean => isFreshCachedSource(cachedSource, stats)),
    Option.match({
      onNone: () =>
        cacheFileSource(filename, {
          mtimeMs: stats.mtimeMs,
          size: stats.size,
          source: readFileSync(filename, 'utf8'),
        }),
      onSome: (cachedSource) => cachedSource.source,
    }),
  );
};

const readFileSource = (filename: string): string =>
  pipe(
    Either.try(() => readFreshFileSource(filename)),
    Either.getOrElse((): string => ''),
  );

export const readCachedSource = (context: SourceContext): string =>
  Match.value(context).pipe(
    Match.when({ sourceCode: Match.defined }, ({ sourceCode }) => readSourceCodeText(sourceCode)),
    Match.when({ filename: Match.defined }, ({ filename }) => readFileSource(filename)),
    Match.orElse((): string => ''),
  );
