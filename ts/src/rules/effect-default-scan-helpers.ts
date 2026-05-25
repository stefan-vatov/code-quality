/* -------------------------------------------------------------------------- */
/*         Shared scan helpers for always-on Effect lint predicates.          */
/* -------------------------------------------------------------------------- */
import { Array, Match, Option, pipe } from 'effect';
import {
  findBalancedCallEnd,
  findStatementEnd,
  stripComments,
  stripCommentsAndStrings,
} from './effect-source-helpers';
import { effectImportAliases } from './effect-rule-core';

const EFFECT_PATTERN_CACHE_MAX = 256;
const effectAliasesPatternCache = new Map<string, string>();
const effectCallPatternCache = new Map<string, Map<string, RegExp>>();

const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);

const setBoundedCacheValue = <Value>(
  cache: Map<string, Value>,
  key: string,
  value: Value,
): Value => {
  pipe(
    Match.value(cache.size),
    Match.when(
      (size): boolean => size >= EFFECT_PATTERN_CACHE_MAX,
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
  cache.set(key, value);
  return value;
};

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const effectAliasesPattern = (source: string): string => {
  const cachedPattern = effectAliasesPatternCache.get(source);
  return pipe(
    Option.fromNullable(cachedPattern),
    Option.match({
      onNone: (): string =>
        setBoundedCacheValue(
          effectAliasesPatternCache,
          source,
          pipe(effectImportAliases(source), Array.map(escapeRegExp), Array.join('|')),
        ),
      onSome: (pattern): string => pattern,
    }),
  );
};

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const effectCallPattern = (source: string, methods: string): RegExp => {
  const sourceCache = pipe(
    Option.fromNullable(effectCallPatternCache.get(source)),
    Option.getOrElse(
      (): Map<string, RegExp> =>
        setBoundedCacheValue(effectCallPatternCache, source, new Map<string, RegExp>()),
    ),
  );
  const cachedPattern = sourceCache.get(methods);
  return pipe(
    Option.fromNullable(cachedPattern),
    Option.match({
      onNone: (): RegExp => {
        const pattern = new RegExp(
          `\\b(?:${effectAliasesPattern(source)})\\.(?:${methods})\\s*\\(`,
          'g',
        );
        sourceCache.set(methods, pattern);
        return pattern;
      },
      onSome: (pattern): RegExp => pattern,
    }),
  );
};

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const localCallSegment = (source: string, targetIndex: number): string => {
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

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
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

const effectGenHasBody = (
  source: string,
  code: string,
  predicate: (body: string) => boolean,
): boolean =>
  pipe(
    [...code.matchAll(effectCallPattern(source, 'gen'))],
    Array.some((match): boolean => {
      const openParenIndex = source.indexOf('(', match.index);
      return Match.value(openParenIndex).pipe(
        Match.when(
          (index): boolean => index === -1,
          (): boolean => false,
        ),
        Match.orElse((index): boolean =>
          predicate(source.slice(index + 1, findBalancedCallEnd(source, index))),
        ),
      );
    }),
  );

const effectFnBodyBounds = (
  source: string,
  openParenIndex: number,
): { end: number; start: number } => {
  const firstCallEnd = findBalancedCallEnd(source, openParenIndex);
  const nextCallMatch = /^\s*\(/.exec(source.slice(firstCallEnd + 1));
  return pipe(
    Option.fromNullable(nextCallMatch),
    Option.match({
      onNone: (): { end: number; start: number } => ({ end: firstCallEnd, start: openParenIndex }),
      onSome: (match): { end: number; start: number } => {
        const start = firstCallEnd + 1 + match[0].lastIndexOf('(');
        return { end: findBalancedCallEnd(source, start), start };
      },
    }),
  );
};

const effectFnHasBody = (
  source: string,
  code: string,
  predicate: (body: string) => boolean,
): boolean =>
  pipe(
    [...code.matchAll(effectCallPattern(source, 'fn'))],
    Array.some((match): boolean => {
      const openParenIndex = source.indexOf('(', match.index);
      return Match.value(openParenIndex).pipe(
        Match.when(
          (index): boolean => index === -1,
          (): boolean => false,
        ),
        Match.orElse((index): boolean => {
          const bounds = effectFnBodyBounds(source, index);
          return predicate(source.slice(bounds.start + 1, bounds.end));
        }),
      );
    }),
  );

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const someEffectWorkflowBody = (
  source: string,
  predicate: (body: string) => boolean,
): boolean => {
  const code = stripCommentsAndStrings(source);
  return effectGenHasBody(source, code, predicate) || effectFnHasBody(source, code, predicate);
};

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const enclosingPipeBody = (source: string, targetIndex: number): string | undefined =>
  pipe(
    [...source.matchAll(/\.pipe\s*\(/g)],
    Array.findFirst((match): boolean => {
      const openParenIndex = source.indexOf('(', match.index);
      return Match.value(openParenIndex).pipe(
        Match.when(
          (index): boolean => index === -1 || index > targetIndex,
          (): boolean => false,
        ),
        Match.orElse((index): boolean => targetIndex <= findBalancedCallEnd(source, index)),
      );
    }),
    Option.map((match): string => {
      const openParenIndex = source.indexOf('(', match.index);
      return source.slice(openParenIndex + 1, findBalancedCallEnd(source, openParenIndex));
    }),
    Option.getOrUndefined,
  );

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const strippedCallSegment = (source: string, targetIndex: number): string =>
  stripComments(localCallSegment(source, targetIndex));
