import { createWeightedCache } from './source-cache';
import { sourceNavigationIndex } from './effect-source-navigation-index';

const EFFECT_WRAPPER_PATTERN = /\bEffect\.(?:promise|tryPromise)\s*\(/g;
const EFFECT_RETRY_PATTERN = /\bEffect\.retry\s*\(/g;
const CACHE_MAX_ENTRIES = 256;
const CACHE_MAX_WEIGHT = 5_242_880;
const UTF16_BYTES_PER_CODE_UNIT = 2;
const CACHE_ENTRY_BYTES = 128;
const RANGE_BYTES = 64;
const INDEX_NUMBER_BYTES = 8;

interface EffectWrapperRange {
  readonly endIndex: number;
  readonly matchIndex: number;
  readonly openParenIndex: number;
  readonly segmentEndIndex: number;
}

interface EffectWrapperIndex {
  readonly prefixEndIndexes: readonly number[];
  readonly ranges: readonly EffectWrapperRange[];
}

interface EffectRetryIndex {
  readonly prefixEndIndexes: readonly number[];
  readonly ranges: readonly { endIndex: number; openParenIndex: number }[];
}

const effectWrapperIndexCache = createWeightedCache<string, EffectWrapperIndex>({
  maxEntries: CACHE_MAX_ENTRIES,
  maxWeight: CACHE_MAX_WEIGHT,
});
const effectRetryIndexCache = createWeightedCache<string, EffectRetryIndex>({
  maxEntries: CACHE_MAX_ENTRIES,
  maxWeight: CACHE_MAX_WEIGHT,
});

const effectWrapperIndexWeight = (sourceLength: number, rangeCount: number): number =>
  sourceLength * UTF16_BYTES_PER_CODE_UNIT +
  CACHE_ENTRY_BYTES +
  rangeCount * RANGE_BYTES +
  rangeCount * INDEX_NUMBER_BYTES;

const appendRangeEnd = (prefixEndIndexes: number[], endIndex: number): void => {
  prefixEndIndexes.push(Math.max(prefixEndIndexes.at(-1) ?? -1, endIndex));
};

const segmentEndIndexFor = (
  source: string,
  callEndIndex: number,
  navigationIndex: ReturnType<typeof sourceNavigationIndex>,
): number => {
  const pipeMatch = /^\s*\.pipe\s*\(/.exec(source.slice(callEndIndex));
  if (pipeMatch === null) {
    return callEndIndex;
  }
  const pipeOpenIndex = callEndIndex + pipeMatch[0].lastIndexOf('(');
  return navigationIndex.matchingCall(pipeOpenIndex) + 1;
};

const effectWrapperRangeFor = (
  source: string,
  matchIndex: number,
  navigationIndex: ReturnType<typeof sourceNavigationIndex>,
): EffectWrapperRange | undefined => {
  const openParenIndex = source.indexOf('(', matchIndex);
  if (openParenIndex === -1) {
    return undefined;
  }
  const endIndex = navigationIndex.matchingCall(openParenIndex);
  return {
    endIndex,
    matchIndex,
    openParenIndex,
    segmentEndIndex: segmentEndIndexFor(source, endIndex + 1, navigationIndex),
  };
};

const buildEffectWrapperIndex = (source: string): EffectWrapperIndex => {
  const ranges: EffectWrapperRange[] = [];
  const prefixEndIndexes: number[] = [];
  const navigationIndex = sourceNavigationIndex(source);
  for (const match of source.matchAll(EFFECT_WRAPPER_PATTERN)) {
    const range = effectWrapperRangeFor(source, match.index, navigationIndex);
    if (range !== undefined) {
      ranges.push(range);
      appendRangeEnd(prefixEndIndexes, range.endIndex);
    }
  }
  return { prefixEndIndexes, ranges };
};

const effectWrapperIndexFor = (source: string): EffectWrapperIndex => {
  const cachedIndex = effectWrapperIndexCache.get(source);
  if (cachedIndex !== undefined) {
    return cachedIndex;
  }
  const index = buildEffectWrapperIndex(source);
  return effectWrapperIndexCache.set(
    source,
    index,
    effectWrapperIndexWeight(source.length, index.ranges.length),
  );
};

const upperBound = (
  ranges: readonly { readonly openParenIndex: number }[],
  targetIndex: number,
): number => {
  let low = 0;
  let high = ranges.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    const range = ranges[middle];
    if (range !== undefined && range.openParenIndex <= targetIndex) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return low;
};

const firstPrefixEndAtLeast = (
  prefixEndIndexes: readonly number[],
  rangeCount: number,
  targetIndex: number,
): number => {
  let low = 0;
  let high = rangeCount;
  while (low < high) {
    const middle = (low + high) >> 1;
    const prefixEndIndex = prefixEndIndexes[middle] ?? -1;
    if (prefixEndIndex >= targetIndex) {
      high = middle;
    } else {
      low = middle + 1;
    }
  }
  return low;
};

const firstEnclosingRange = (
  index: EffectWrapperIndex,
  targetIndex: number,
): EffectWrapperRange | undefined => {
  const eligibleRangeCount = upperBound(index.ranges, targetIndex);
  const rangeIndex = firstPrefixEndAtLeast(index.prefixEndIndexes, eligibleRangeCount, targetIndex);
  if (rangeIndex >= eligibleRangeCount) {
    return undefined;
  }
  return index.ranges[rangeIndex];
};

const effectRetryRangeFor = (
  source: string,
  matchIndex: number,
  navigationIndex: ReturnType<typeof sourceNavigationIndex>,
): { endIndex: number; openParenIndex: number } | undefined => {
  const openParenIndex = source.indexOf('(', matchIndex);
  if (openParenIndex === -1) {
    return undefined;
  }
  return { endIndex: navigationIndex.matchingCall(openParenIndex), openParenIndex };
};

const buildEffectRetryIndex = (source: string): EffectRetryIndex => {
  const ranges: { endIndex: number; openParenIndex: number }[] = [];
  const prefixEndIndexes: number[] = [];
  const navigationIndex = sourceNavigationIndex(source);
  for (const match of source.matchAll(EFFECT_RETRY_PATTERN)) {
    const range = effectRetryRangeFor(source, match.index, navigationIndex);
    if (range !== undefined) {
      ranges.push(range);
      appendRangeEnd(prefixEndIndexes, range.endIndex);
    }
  }
  return { prefixEndIndexes, ranges };
};

const effectRetryIndexFor = (source: string): EffectRetryIndex => {
  const cachedIndex = effectRetryIndexCache.get(source);
  if (cachedIndex !== undefined) {
    return cachedIndex;
  }
  const index = buildEffectRetryIndex(source);
  return effectRetryIndexCache.set(
    source,
    index,
    effectWrapperIndexWeight(source.length, index.ranges.length),
  );
};

export const isInsideEffectRetryCall = (source: string, targetIndex: number): boolean => {
  const index = effectRetryIndexFor(source);
  const eligibleRangeCount = upperBound(index.ranges, targetIndex);
  const rangeIndex = firstPrefixEndAtLeast(index.prefixEndIndexes, eligibleRangeCount, targetIndex);
  return rangeIndex < eligibleRangeCount;
};

export const enclosingEffectWrapperBounds = (
  source: string,
  targetIndex: number,
): { matchIndex: number; segmentEndIndex: number } | undefined => {
  const range = firstEnclosingRange(effectWrapperIndexFor(source), targetIndex);
  if (range === undefined) {
    return undefined;
  }
  return { matchIndex: range.matchIndex, segmentEndIndex: range.segmentEndIndex };
};
