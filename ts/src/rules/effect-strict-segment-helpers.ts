/* -------------------------------------------------------------------------- */
/*        Source segment helpers for opt-in strict Effect lint rules.         */
/* -------------------------------------------------------------------------- */
import { Array, Match, Option, pipe } from 'effect';
import {
  findBalancedCallEnd,
  findStatementEnd,
  isInsideCall,
  stripCommentsAndStrings,
} from './effect-source-helpers';

const SEGMENT_CACHE_MAX = 256;
const localEffectCallSegmentCache = new Map<string, Map<number, string>>();
const enclosingEffectWrapperSegmentCache = new Map<string, Map<number, string | undefined>>();
const CHAR_CODE_ZERO = 48;
const CHAR_CODE_NINE = 57;
const CHAR_CODE_UPPER_A = 65;
const CHAR_CODE_UPPER_Z = 90;
const CHAR_CODE_LOWER_A = 97;
const CHAR_CODE_LOWER_Z = 122;
const LOCAL_CONTEXT_WINDOW = 160;
const RESOURCE_CONTEXT_WINDOW = 180;

const sourceIndexCache = <Value>(
  cache: Map<string, Map<number, Value>>,
  source: string,
): Map<number, Value> =>
  pipe(
    Option.fromNullable(cache.get(source)),
    Option.getOrElse((): Map<number, Value> => {
      pipe(
        Match.value(cache.size),
        Match.when(
          (size): boolean => size >= SEGMENT_CACHE_MAX,
          (): void => {
            pipe(
              Option.fromNullable(cache.keys().next().value),
              Option.match({
                onNone: (): void => undefined,
                onSome: (firstKey): void => {
                  cache.delete(firstKey);
                },
              }),
            );
          },
        ),
        Match.orElse((): void => undefined),
      );
      const indexCache = new Map<number, Value>();
      cache.set(source, indexCache);
      return indexCache;
    }),
  );

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
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

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
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

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
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

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
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

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
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

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
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

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
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

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const hasRealTestService = (source: string): boolean =>
  Match.value(source).pipe(
    Match.when(
      (value): boolean => !value.includes('real'),
      (): boolean => false,
    ),
    Match.orElse((value): boolean => /\breal[A-Z]/.test(stripCommentsAndStrings(value))),
  );

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
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

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const localEffectCallSegment = (source: string, targetIndex: number): string => {
  const indexCache = sourceIndexCache(localEffectCallSegmentCache, source);
  const cachedSegment = indexCache.get(targetIndex);
  return pipe(
    Option.fromNullable(cachedSegment),
    Option.match({
      onNone: (): string => {
        const segment = uncachedLocalEffectCallSegment(source, targetIndex);
        indexCache.set(targetIndex, segment);
        return segment;
      },
      onSome: (segment): string => segment,
    }),
  );
};

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const localStatementSegment = (source: string, targetIndex: number): string =>
  source.slice(targetIndex, findStatementEnd(source, targetIndex) + 1);

const effectWrapperEndIndex = (source: string, matchIndex: number, targetIndex: number): number => {
  const openParenIndex = source.indexOf('(', matchIndex);
  return Match.value(openParenIndex).pipe(
    Match.when(
      (index): boolean => index === -1 || index > targetIndex,
      (): number => -1,
    ),
    Match.orElse((index): number => findBalancedCallEnd(source, index)),
  );
};

const uncachedEnclosingEffectWrapperSegment = (
  source: string,
  targetIndex: number,
): string | undefined =>
  Match.value(source).pipe(
    Match.when(
      (value): boolean => !value.includes('Effect.promise') && !value.includes('Effect.tryPromise'),
      (): undefined => undefined,
    ),
    Match.orElse((value): string | undefined =>
      pipe(
        [...value.matchAll(/\bEffect\.(?:promise|tryPromise)\s*\(/g)],
        Array.findFirst((match): boolean => {
          const endIndex = effectWrapperEndIndex(value, match.index, targetIndex);
          return endIndex !== -1 && targetIndex <= endIndex;
        }),
        Option.map((match): string => localEffectCallSegment(value, match.index)),
        Option.getOrUndefined,
      ),
    ),
  );

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
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
      indexCache.set(targetIndex, segment);
      return segment;
    }),
  );
};

const isPipeOperatorAtTopLevel = (
  pipeBody: string,
  operatorIndex: number,
  operatorNeedle: string,
): boolean => {
  const previousNonWhitespaceIndex = (index: number): number =>
    Match.value(index).pipe(
      Match.when(
        (currentIndex): boolean => currentIndex >= 0 && isASCIIWhitespace(pipeBody[currentIndex]),
        (currentIndex): number => previousNonWhitespaceIndex(currentIndex - 1),
      ),
      Match.orElse((currentIndex): number => currentIndex),
    );
  const previousIndex = previousNonWhitespaceIndex(operatorIndex - 1);
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
  const scanOperator = (operatorIndex: number): boolean =>
    Match.value(operatorIndex).pipe(
      Match.when(
        (index): boolean => index === -1,
        (): boolean => false,
      ),
      Match.when(
        (index): boolean => isPipeOperatorAtTopLevel(pipeBody, index, operatorNeedle),
        (): boolean => true,
      ),
      Match.orElse((index): boolean =>
        scanOperator(pipeBody.indexOf(operatorNeedle, index + operatorNeedle.length)),
      ),
    );
  return scanOperator(pipeBody.indexOf(operatorNeedle));
};

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
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
