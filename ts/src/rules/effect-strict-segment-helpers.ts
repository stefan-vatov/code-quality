import { Array, Match, Option, pipe } from 'effect';
import {
  findBalancedCallEnd,
  findStatementEnd,
  isInsideCall,
  stripCommentsAndStrings,
} from './effect-source-helpers';
import { createWeightedCache } from './source-cache';
import { enclosingEffectWrapperBounds } from './effect-strict-wrapper-index';

const UTF16_BYTES_PER_CODE_UNIT = 2;
const STRING_CONTAINER_BYTES = 128;
const MAP_CONTAINER_BYTES = 256;
const MAP_ENTRY_BYTES = 96;
const NUMBER_KEY_BYTES = 8;
const SEGMENT_INDEX_CACHE_MAX = 128;
const localEffectCallSegmentCache: WeightedSegmentCache<string> = createWeightedCache({
  maxEntries: 256,
  maxWeight: 5_242_880,
});
const enclosingEffectWrapperSegmentCache: WeightedSegmentCache<string | undefined> =
  createWeightedCache({
    maxEntries: 256,
    maxWeight: 5_242_880,
  });
const CHAR_CODE_ZERO = 48;
const CHAR_CODE_NINE = 57;
const CHAR_CODE_UPPER_A = 65;
const CHAR_CODE_UPPER_Z = 90;
const CHAR_CODE_LOWER_A = 97;
const CHAR_CODE_LOWER_Z = 122;
const LOCAL_CONTEXT_WINDOW = 160;
const RESOURCE_CONTEXT_WINDOW = 180;

interface WeightedSegmentCache<Value> {
  readonly get: (source: string) => Map<number, Value> | undefined;
  readonly set: (
    source: string,
    value: Map<number, Value>,
    explicitWeight?: number,
  ) => Map<number, Value>;
}

const stringWeight = (value: string): number =>
  value.length * UTF16_BYTES_PER_CODE_UNIT + STRING_CONTAINER_BYTES;

const segmentMapWeight = <Value extends string | undefined>(
  source: string,
  indexCache: ReadonlyMap<number, Value>,
): number => {
  let weight =
    stringWeight(source) +
    MAP_CONTAINER_BYTES +
    indexCache.size * (MAP_ENTRY_BYTES + NUMBER_KEY_BYTES);
  for (const segment of indexCache.values()) {
    if (segment !== undefined) {
      weight += stringWeight(segment);
    }
  }
  return weight;
};

const sourceIndexCache = <Value extends string | undefined>(
  cache: WeightedSegmentCache<Value>,
  source: string,
): Map<number, Value> => {
  const cached = cache.get(source);
  if (cached !== undefined) {
    return cached;
  }
  const indexCache = new Map<number, Value>();
  cache.set(source, indexCache, segmentMapWeight(source, indexCache));
  return indexCache;
};

const cacheSourceIndex = <Value extends string | undefined>(
  cache: WeightedSegmentCache<Value>,
  source: string,
  targetIndex: number,
  value: Value,
): Value => {
  const indexCache = sourceIndexCache(cache, source);
  if (!indexCache.has(targetIndex) && indexCache.size >= SEGMENT_INDEX_CACHE_MAX) {
    const firstKey = indexCache.keys().next().value;
    if (firstKey !== undefined) {
      indexCache.delete(firstKey);
    }
  }
  indexCache.set(targetIndex, value);
  cache.set(source, indexCache, segmentMapWeight(source, indexCache));
  return value;
};

export const lineAround = (source: string, targetIndex: number): string => {
  const start = source.lastIndexOf('\n', targetIndex) + 1;
  const end = Match.value(source.indexOf('\n', targetIndex)).pipe(
    Match.when(
      (lineEnd): boolean => lineEnd === -1,
      (): number => source.length,
    ),
    Match.orElse((lineEnd): number => lineEnd),
  );
  return source.slice(start, end);
};

const isASCIIWhitespace = (character: string | undefined): boolean =>
  character === ' ' || character === '\n' || character === '\r' || character === '\t';

const isIdentifierPart = (character: string | undefined): boolean =>
  Match.value(character).pipe(
    Match.when(
      (value): boolean => value === undefined,
      (): boolean => false,
    ),
    Match.when(
      (value): boolean => value === '$' || value === '_',
      (): boolean => true,
    ),
    Match.orElse((value): boolean => {
      if (value === undefined) {
        return false;
      }
      const charCode = value.charCodeAt(0);
      return (
        (charCode >= CHAR_CODE_ZERO && charCode <= CHAR_CODE_NINE) ||
        (charCode >= CHAR_CODE_UPPER_A && charCode <= CHAR_CODE_UPPER_Z) ||
        (charCode >= CHAR_CODE_LOWER_A && charCode <= CHAR_CODE_LOWER_Z)
      );
    }),
  );

export const testSegments = (source: string): string[] =>
  Match.value(source).pipe(
    Match.when(
      (value): boolean => !value.includes('it(') && !value.includes('it.effect'),
      (value): string[] => [value],
    ),
    Match.orElse((value): string[] => {
      const code = stripCommentsAndStrings(value);
      const starts = pipe(
        [...code.matchAll(/\bit(?:\.effect)?\s*\(/g)],
        Array.map((match): number => match.index),
      );
      return Match.value(starts).pipe(
        Match.when(
          (testStarts): boolean => testStarts.length === 0,
          (): string[] => [code],
        ),
        Match.orElse((testStarts): string[] =>
          pipe(
            testStarts,
            Array.map((start, index): string =>
              code.slice(start, testStarts[index + 1] ?? code.length),
            ),
          ),
        ),
      );
    }),
  );

export const hasLayerFactory = (source: string): boolean =>
  Match.value(source.includes('Layer.')).pipe(
    Match.when(
      (hasLayerToken): boolean => !hasLayerToken,
      (): boolean => false,
    ),
    Match.orElse((): boolean => {
      const code = stripCommentsAndStrings(source);
      return (
        /export\s+function\s+[A-Za-z_$][\w$]*Layer\s*\([^)]*\)\s*{[\s\S]*?Layer\./.test(code) ||
        /export\s+const\s+[A-Za-z_$][\w$]*Layer\s*=\s*(?:\([^)]*\)|[A-Za-z_$][\w$]*)?\s*=>[\s\S]*?Layer\./.test(
          code,
        )
      );
    }),
  );

export const hasUnscopedResourceLayer = (source: string): boolean =>
  Match.value(source).pipe(
    Match.when(
      (value): boolean => !value.includes('Layer.effect'),
      (): boolean => false,
    ),
    Match.orElse((value): boolean => {
      const code = stripCommentsAndStrings(value);
      return pipe(
        [...code.matchAll(/Layer\.effect\s*\(/g)],
        Array.some((match): boolean => {
          const openParenIndex = code.indexOf('(', match.index);
          const callSource = code.slice(match.index, findBalancedCallEnd(code, openParenIndex) + 1);
          return (
            /\b(?:open|connect|subscribe|listen)\w*\s*(?:\(|\)|$)/.test(callSource) &&
            !isInsideCall(code, match.index, /Layer\.scoped\s*\(/g)
          );
        }),
      );
    }),
  );

export const hasUnscopedResourceLoop = (source: string): boolean =>
  Match.value(source).pipe(
    Match.when(
      (value): boolean =>
        !value.includes('open') &&
        !value.includes('connect') &&
        !value.includes('subscribe') &&
        !value.includes('listen'),
      (): boolean => false,
    ),
    Match.orElse((value): boolean => {
      const code = stripCommentsAndStrings(value);
      return pipe(
        [...code.matchAll(/\b(?:open|connect|subscribe|listen)\w*\s*\(/g)],
        Array.some((match): boolean => {
          const prefix = code.slice(
            Math.max(0, match.index - RESOURCE_CONTEXT_WINDOW),
            match.index,
          );
          return (
            /\b(?:for|while)\b/.test(prefix) &&
            !isInsideCall(code, match.index, /Effect\.scoped\s*\(/g)
          );
        }),
      );
    }),
  );

export const hasUnsafeResourceStream = (source: string): boolean =>
  Match.value(source.includes('Stream.')).pipe(
    Match.when(
      (hasStreamToken): boolean =>
        !hasStreamToken ||
        (!source.includes('open') &&
          !source.includes('connect') &&
          !source.includes('subscribe') &&
          !source.includes('listen')),
      (): boolean => false,
    ),
    Match.orElse((): boolean => {
      const code = stripCommentsAndStrings(source);
      return pipe(
        [...code.matchAll(/\b(?:open|connect|subscribe|listen)\w*\s*\(/g)],
        Array.some((match): boolean => {
          const prefix = code.slice(
            Math.max(0, match.index - RESOURCE_CONTEXT_WINDOW),
            match.index,
          );
          return (
            /\bStream\./.test(prefix) &&
            !isInsideCall(code, match.index, /(?:Stream|Effect)\.scoped\s*\(/g)
          );
        }),
      );
    }),
  );

export const hasLiveTestService = (source: string): boolean =>
  Match.value(source).pipe(
    Match.when(
      (value): boolean => !value.includes('Live') && !value.includes('Layer.live'),
      (): boolean => false,
    ),
    Match.orElse((value): boolean =>
      /(?:\bLive\b|[A-Za-z_$][\w$]*Live\b|Layer\.live)/.test(stripCommentsAndStrings(value)),
    ),
  );

export const hasRealTestService = (source: string): boolean =>
  Match.value(source).pipe(
    Match.when(
      (value): boolean => !value.includes('real'),
      (): boolean => false,
    ),
    Match.orElse((value): boolean => /\breal[A-Z]/.test(stripCommentsAndStrings(value))),
  );

export const hasDuplicateLayerInstance = (source: string): boolean =>
  Match.value(source.includes('Layer.')).pipe(
    Match.when(
      (hasLayerToken): boolean => !hasLayerToken,
      (): boolean => false,
    ),
    Match.orElse((): boolean => {
      const code = stripCommentsAndStrings(source);
      const services = new Set<string>();
      return pipe(
        [
          ...code.matchAll(
            /Layer\.(?:succeed|sync|effect|scoped|fromEffect|fromFunction)\s*\(\s*([A-Za-z_$][\w$]*)\b/g,
          ),
        ],
        Array.some((match): boolean => {
          const [, serviceName] = match;
          return Match.value(services.has(serviceName)).pipe(
            Match.when(
              (hasService): boolean => hasService,
              (): boolean => true,
            ),
            Match.orElse((): boolean => {
              services.add(serviceName);
              return false;
            }),
          );
        }),
      );
    }),
  );

const localEffectCallEndIndex = (source: string, targetIndex: number): number | undefined => {
  const openParenIndex = source.indexOf('(', targetIndex);
  return Match.value(openParenIndex).pipe(
    Match.when(
      (index): boolean => index === -1,
      (): undefined => undefined,
    ),
    Match.orElse((index): number => {
      const endIndex = findBalancedCallEnd(source, index) + 1;
      const afterCall = source.slice(endIndex);
      return pipe(
        Option.fromNullable(/^\s*\.pipe\s*\(/.exec(afterCall)),
        Option.match({
          onNone: (): number => endIndex,
          onSome: (pipeMatch): number => {
            const pipeOpenIndex = endIndex + pipeMatch[0].lastIndexOf('(');
            return findBalancedCallEnd(source, pipeOpenIndex) + 1;
          },
        }),
      );
    }),
  );
};

const uncachedLocalEffectCallSegment = (source: string, targetIndex: number): string => {
  const endIndex = localEffectCallEndIndex(source, targetIndex);
  return pipe(
    Option.fromNullable(endIndex),
    Option.match({
      onNone: (): string => source.slice(targetIndex, targetIndex + LOCAL_CONTEXT_WINDOW),
      onSome: (index): string => source.slice(targetIndex, index),
    }),
  );
};

export const localEffectCallSegment = (source: string, targetIndex: number): string => {
  const indexCache = sourceIndexCache(localEffectCallSegmentCache, source);
  const cachedSegment = indexCache.get(targetIndex);
  return pipe(
    Option.fromNullable(cachedSegment),
    Option.match({
      onNone: (): string => {
        const segment = uncachedLocalEffectCallSegment(source, targetIndex);
        return cacheSourceIndex(localEffectCallSegmentCache, source, targetIndex, segment);
      },
      onSome: (segment): string => segment,
    }),
  );
};

export const localStatementSegment = (source: string, targetIndex: number): string =>
  source.slice(targetIndex, findStatementEnd(source, targetIndex) + 1);

const uncachedEnclosingEffectWrapperSegment = (
  source: string,
  targetIndex: number,
): string | undefined =>
  pipe(
    Option.fromNullable(enclosingEffectWrapperBounds(source, targetIndex)),
    Option.map(({ matchIndex, segmentEndIndex }): string =>
      cacheSourceIndex(
        localEffectCallSegmentCache,
        source,
        matchIndex,
        source.slice(matchIndex, segmentEndIndex),
      ),
    ),
    Option.getOrUndefined,
  );

export const enclosingEffectWrapperSegment = (
  source: string,
  targetIndex: number,
): string | undefined => {
  const indexCache = sourceIndexCache(enclosingEffectWrapperSegmentCache, source);
  return Match.value(indexCache.has(targetIndex)).pipe(
    Match.when(
      (hasCachedSegment): boolean => hasCachedSegment,
      (): string | undefined => indexCache.get(targetIndex),
    ),
    Match.orElse((): string | undefined => {
      const segment = uncachedEnclosingEffectWrapperSegment(source, targetIndex);
      return cacheSourceIndex(enclosingEffectWrapperSegmentCache, source, targetIndex, segment);
    }),
  );
};

const isPipeOperatorAtTopLevel = (
  pipeBody: string,
  operatorIndex: number,
  operatorNeedle: string,
): boolean => {
  let previousIndex = operatorIndex - 1;
  while (previousIndex >= 0 && isASCIIWhitespace(pipeBody[previousIndex])) {
    previousIndex -= 1;
  }
  const previousCharacter = pipeBody[previousIndex];
  const nextCharacter = pipeBody[operatorIndex + operatorNeedle.length];
  return (previousIndex < 0 || previousCharacter === ',') && !isIdentifierPart(nextCharacter);
};

const pipeBodySegment = (segment: string): string | undefined => {
  const pipeIndex = segment.indexOf('.pipe');
  return Match.value(pipeIndex).pipe(
    Match.when(
      (index): boolean => index === -1,
      (): undefined => undefined,
    ),
    Match.orElse((index): string | undefined =>
      Match.value(segment.indexOf('(', index)).pipe(
        Match.when(
          (openParenIndex): boolean => openParenIndex === -1,
          (): undefined => undefined,
        ),
        Match.orElse((openParenIndex): string =>
          segment.slice(openParenIndex + 1, findBalancedCallEnd(segment, openParenIndex)),
        ),
      ),
    ),
  );
};

const pipeBodyHasTopLevelOperator = (pipeBody: string, operatorNeedle: string): boolean => {
  let operatorIndex = pipeBody.indexOf(operatorNeedle);
  while (operatorIndex !== -1) {
    if (isPipeOperatorAtTopLevel(pipeBody, operatorIndex, operatorNeedle)) {
      return true;
    }
    operatorIndex = pipeBody.indexOf(operatorNeedle, operatorIndex + operatorNeedle.length);
  }
  return false;
};

export const hasTopLevelPipeOperator = (
  segment: string,
  operatorName: 'retry' | 'timeout' | 'withSpan',
): boolean => {
  const pipeBody = pipeBodySegment(segment);
  const operatorNeedle = `Effect.${operatorName}`;
  return pipe(
    Option.fromNullable(pipeBody),
    Option.exists((body): boolean => pipeBodyHasTopLevelOperator(body, operatorNeedle)),
  );
};
