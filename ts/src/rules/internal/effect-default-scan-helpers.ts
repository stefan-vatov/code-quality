import { Array, Match, Option, pipe } from 'effect';
import {
  findBalancedCallEnd,
  findStatementEnd,
  stripComments,
  stripCommentsAndStrings,
} from './effect-source-helpers';
import { createWeightedCache } from './source-cache';
import { effectImportAliases } from './effect-rule-core';
import { sourceNavigationIndex } from './effect-source-navigation-index';

const EFFECT_PATTERN_CACHE_MAX = 256;
const BYTES_PER_KIBIBYTE = 1024;
const BYTES_PER_MEBIBYTE = BYTES_PER_KIBIBYTE * BYTES_PER_KIBIBYTE;
const EFFECT_CALL_PATTERN_CACHE_MEBIBYTES = 3;
const EFFECT_CALL_PATTERN_SOURCE_KIBIBYTES = 512;
const EFFECT_ALIASES_PATTERN_CACHE_MAX_WEIGHT = BYTES_PER_MEBIBYTE;
const EFFECT_CALL_PATTERN_CACHE_MAX_WEIGHT =
  EFFECT_CALL_PATTERN_CACHE_MEBIBYTES * BYTES_PER_MEBIBYTE;
const EFFECT_CALL_PATTERN_SOURCE_MAX_WEIGHT =
  EFFECT_CALL_PATTERN_SOURCE_KIBIBYTES * BYTES_PER_KIBIBYTE;
const UTF16_CODE_UNIT_BYTES = 2;
const CACHE_ENTRY_BYTES = 128;
const MAP_BASE_BYTES = 256;
const REGEXP_BYTES = 128;
type EffectCallPatternSourceCache = ReturnType<typeof createWeightedCache<string, RegExp>>;
type EffectAliasesPatternCache = ReturnType<typeof createWeightedCache<string, string>>;
type EffectCallPatternCache = ReturnType<
  typeof createWeightedCache<string, EffectCallPatternSourceCache>
>;
const effectAliasesPatternCache: EffectAliasesPatternCache = createWeightedCache({
  maxEntries: EFFECT_PATTERN_CACHE_MAX,
  maxWeight: EFFECT_ALIASES_PATTERN_CACHE_MAX_WEIGHT,
});
const effectCallPatternCache: EffectCallPatternCache = createWeightedCache({
  maxEntries: EFFECT_PATTERN_CACHE_MAX,
  maxWeight: EFFECT_CALL_PATTERN_CACHE_MAX_WEIGHT,
});

const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);

const UTF16Bytes = (value: string): number => value.length * UTF16_CODE_UNIT_BYTES;
const bytesForUTF16 = UTF16Bytes;

const effectAliasesPatternWeight = (source: string, pattern: string): number =>
  bytesForUTF16(source) + CACHE_ENTRY_BYTES + bytesForUTF16(pattern) + CACHE_ENTRY_BYTES;

const effectCallPatternWeight = (methods: string, pattern: RegExp): number =>
  bytesForUTF16(methods) + CACHE_ENTRY_BYTES + bytesForUTF16(pattern.source) + REGEXP_BYTES;

const effectCallPatternSourceWeight = (source: string): number =>
  bytesForUTF16(source) +
  CACHE_ENTRY_BYTES +
  MAP_BASE_BYTES +
  EFFECT_CALL_PATTERN_SOURCE_MAX_WEIGHT;

const createEffectCallPatternSourceCache = (): EffectCallPatternSourceCache =>
  createWeightedCache<string, RegExp>({
    maxEntries: 8,
    maxWeight: EFFECT_CALL_PATTERN_SOURCE_MAX_WEIGHT,
  });

export const effectAliasesPattern = (source: string): string => {
  const cachedPattern = effectAliasesPatternCache.get(source);
  if (cachedPattern !== undefined) {
    return cachedPattern;
  }
  const pattern = pipe(effectImportAliases(source), Array.map(escapeRegExp), Array.join('|'));
  return effectAliasesPatternCache.set(
    source,
    pattern,
    effectAliasesPatternWeight(source, pattern),
  );
};

export const effectCallPattern = (source: string, methods: string): RegExp => {
  const sourceCache =
    effectCallPatternCache.get(source) ??
    effectCallPatternCache.set(
      source,
      createEffectCallPatternSourceCache(),
      effectCallPatternSourceWeight(source),
    );
  const cachedPattern = sourceCache.get(methods);
  if (cachedPattern !== undefined) {
    return cachedPattern;
  }
  const pattern = new RegExp(
    `(?:^|[^\\w$])(?:${effectAliasesPattern(source)})\\.(?:${methods})\\s*\\(`,
    'g',
  );
  sourceCache.set(methods, pattern, effectCallPatternWeight(methods, pattern));
  return pattern;
};

const localCallSegment = (source: string, targetIndex: number): string => {
  const openParenIndex = source.indexOf('(', targetIndex);
  return Match.value(openParenIndex).pipe(
    Match.when(
      (index): boolean => index === -1,
      (): string => source.slice(targetIndex, findStatementEnd(source, targetIndex) + 1),
    ),
    Match.orElse((index): string =>
      source.slice(targetIndex, findBalancedCallEnd(source, index) + 1),
    ),
  );
};

export const effectCallBodies = (source: string, callPattern: RegExp): string[] => {
  const code = stripCommentsAndStrings(source);
  return pipe(
    [...code.matchAll(callPattern)],
    Array.filterMap((match): Option.Option<string> => {
      const openParenIndex = source.indexOf('(', match.index);
      return Match.value(openParenIndex).pipe(
        Match.when(
          (index): boolean => index === -1,
          (): Option.Option<string> => Option.none(),
        ),
        Match.orElse(
          (index): Option.Option<string> =>
            Option.some(source.slice(index + 1, findBalancedCallEnd(source, index))),
        ),
      );
    }),
  );
};

export const someEffectGenBodyMatch = (source: string, pattern: RegExp): boolean => {
  const code = stripCommentsAndStrings(source);
  const genMatches = code.matchAll(effectCallPattern(source, 'gen'));
  const navigation = sourceNavigationIndex(source);
  let nextGenMatch = genMatches.next(),
    furthestBodyEnd = -1;
  const advanceGenMatches = (targetIndex: number): void => {
    while (!nextGenMatch.done) {
      const openParenIndex = source.indexOf('(', nextGenMatch.value.index);
      if (openParenIndex === -1) {
        nextGenMatch = genMatches.next();
      } else if (openParenIndex + 1 > targetIndex) {
        break;
      } else {
        furthestBodyEnd = Math.max(furthestBodyEnd, navigation.matchingCall(openParenIndex));
        nextGenMatch = genMatches.next();
      }
    }
  };
  for (const match of code.matchAll(pattern)) {
    advanceGenMatches(match.index);
    if (match.index < furthestBodyEnd) {
      return true;
    }
  }
  return false;
};

export const strippedCallSegment = (source: string, targetIndex: number): string =>
  stripComments(localCallSegment(source, targetIndex));
