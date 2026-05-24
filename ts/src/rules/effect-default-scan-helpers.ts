/**
 * Shared scan helpers for always-on Effect lint predicates.
 *
 * @internal
 */
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
  if (cache.size >= EFFECT_PATTERN_CACHE_MAX) {
    const firstKey = cache.keys().next().value;
    if (firstKey !== undefined) {
      cache.delete(firstKey);
    }
  }
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
  if (cachedPattern !== undefined) {
    return cachedPattern;
  }

  return setBoundedCacheValue(
    effectAliasesPatternCache,
    source,
    effectImportAliases(source).map(escapeRegExp).join('|'),
  );
};

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const effectCallPattern = (source: string, methods: string): RegExp => {
  let sourceCache = effectCallPatternCache.get(source);
  if (sourceCache === undefined) {
    sourceCache = setBoundedCacheValue(effectCallPatternCache, source, new Map<string, RegExp>());
  }

  const cachedPattern = sourceCache.get(methods);
  if (cachedPattern !== undefined) {
    return cachedPattern;
  }

  const pattern = new RegExp(`\\b(?:${effectAliasesPattern(source)})\\.(?:${methods})\\s*\\(`, 'g');
  sourceCache.set(methods, pattern);
  return pattern;
};

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const localCallSegment = (source: string, targetIndex: number): string => {
  const openParenIndex = source.indexOf('(', targetIndex);
  if (openParenIndex === -1) {
    return source.slice(targetIndex, findStatementEnd(source, targetIndex) + 1);
  }
  return source.slice(targetIndex, findBalancedCallEnd(source, openParenIndex) + 1);
};

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const effectCallBodies = (source: string, callPattern: RegExp): string[] => {
  const code = stripCommentsAndStrings(source);
  const bodies: string[] = [];
  for (const match of code.matchAll(callPattern)) {
    const openParenIndex = source.indexOf('(', match.index);
    if (openParenIndex !== -1) {
      bodies.push(source.slice(openParenIndex + 1, findBalancedCallEnd(source, openParenIndex)));
    }
  }

  return bodies;
};

const effectGenHasBody = (
  source: string,
  code: string,
  predicate: (body: string) => boolean,
): boolean => {
  for (const match of code.matchAll(effectCallPattern(source, 'gen'))) {
    const openParenIndex = source.indexOf('(', match.index);
    if (
      openParenIndex !== -1 &&
      predicate(source.slice(openParenIndex + 1, findBalancedCallEnd(source, openParenIndex)))
    ) {
      return true;
    }
  }
  return false;
};

const effectFnBodyBounds = (
  source: string,
  openParenIndex: number,
): { end: number; start: number } => {
  const firstCallEnd = findBalancedCallEnd(source, openParenIndex);
  const nextCallMatch = /^\s*\(/.exec(source.slice(firstCallEnd + 1));
  if (nextCallMatch) {
    const start = firstCallEnd + 1 + nextCallMatch[0].lastIndexOf('(');
    return { end: findBalancedCallEnd(source, start), start };
  }
  return { end: firstCallEnd, start: openParenIndex };
};

const effectFnHasBody = (
  source: string,
  code: string,
  predicate: (body: string) => boolean,
): boolean => {
  for (const match of code.matchAll(effectCallPattern(source, 'fn'))) {
    const openParenIndex = source.indexOf('(', match.index);
    if (openParenIndex !== -1) {
      const bounds = effectFnBodyBounds(source, openParenIndex);
      if (predicate(source.slice(bounds.start + 1, bounds.end))) {
        return true;
      }
    }
  }
  return false;
};

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
export const enclosingPipeBody = (source: string, targetIndex: number): string | undefined => {
  for (const match of source.matchAll(/\.pipe\s*\(/g)) {
    const openParenIndex = source.indexOf('(', match.index);
    if (openParenIndex !== -1 && openParenIndex <= targetIndex) {
      const endIndex = findBalancedCallEnd(source, openParenIndex);
      if (targetIndex <= endIndex) {
        return source.slice(openParenIndex + 1, endIndex);
      }
    }
  }

  return undefined;
};

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const strippedCallSegment = (source: string, targetIndex: number): string =>
  stripComments(localCallSegment(source, targetIndex));
