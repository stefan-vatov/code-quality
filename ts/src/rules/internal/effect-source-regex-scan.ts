import { REGEX_INDEX_CACHE_MAX_WEIGHT, regexIndexCacheWeight } from './effect-source-cache-weights';
import type { SourceWeightedCache } from './effect-source-cache-weights';
import { buildREGEXIndex } from './effect-source-regex-lexer-state';
import { createWeightedCache } from './source-cache';
import { scanREGEXLiteralEnd } from './effect-source-regex-literal';

const REGEX_INDEX_CACHE_MAX_ENTRIES = 16;
const CHAR_CODE_ASTERISK = 42;
const CHAR_CODE_SLASH = 47;
const SINGLE_CHARACTER_LENGTH = 1;
const regexIndexCache: SourceWeightedCache<ReturnType<typeof buildREGEXIndex>> =
  createWeightedCache({
    maxEntries: REGEX_INDEX_CACHE_MAX_ENTRIES,
    maxWeight: REGEX_INDEX_CACHE_MAX_WEIGHT,
  });

const cacheREGEXIndex = (
  source: string,
  index: ReturnType<typeof buildREGEXIndex>,
): ReturnType<typeof buildREGEXIndex> =>
  regexIndexCache.set(
    source,
    index,
    regexIndexCacheWeight(source.length, {
      endCount: index.ends.size,
      startCount: index.starts.size,
    }),
  );

const regexIndexFor = (source: string): ReturnType<typeof buildREGEXIndex> => {
  const cached = regexIndexCache.get(source);
  if (cached !== undefined) {
    return cached;
  }
  return cacheREGEXIndex(source, buildREGEXIndex(source));
};

export const findREGEXLiteralEnd = (source: string, startIndex: number): number => {
  const cached = regexIndexCache.get(source);
  if (cached !== undefined) {
    const cachedEnd = cached.ends.get(startIndex);
    if (cachedEnd !== undefined) {
      return cachedEnd;
    }
  }
  return scanREGEXLiteralEnd(source, startIndex);
};

export const isREGEXLiteralStart = (source: string, index: number): boolean => {
  if (source.charCodeAt(index) !== CHAR_CODE_SLASH) {
    return false;
  }
  const nextCode = source.charCodeAt(index + SINGLE_CHARACTER_LENGTH);
  if (nextCode === CHAR_CODE_SLASH || nextCode === CHAR_CODE_ASTERISK) {
    return false;
  }
  return regexIndexFor(source).starts.has(index);
};
