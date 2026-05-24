/**
 * Floating Effect expression detection.
 *
 * @internal
 */
import { findBalancedCallEnd, stripCommentsAndStrings } from './effect-source-helpers';
import { effectAliasesPattern } from './effect-default-scan-helpers';
import { effectImportAliases } from './effect-rule-core';

const EFFECT_PATTERN_CACHE_MAX = 256;
const floatingEffectPatternCache = new Map<string, FloatingEffectPatterns>();

interface FloatingEffectPatterns {
  floatingEffectCall: RegExp;
  guardedAndEffectCall: RegExp;
  guardedOrEffectCall: RegExp;
  inlineIfEffectCall: RegExp;
  ternaryEffectCall: RegExp;
}

interface FloatingLineInput {
  line: string;
  patterns: FloatingEffectPatterns;
  previous: string;
}

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

const floatingEffectPatterns = (aliasPattern: string): FloatingEffectPatterns => {
  const cachedPatterns = floatingEffectPatternCache.get(aliasPattern);
  if (cachedPatterns !== undefined) {
    return cachedPatterns;
  }

  const runtimeMethods = 'runPromise|runPromiseExit|runSync|runSyncExit|runFork';
  return setBoundedCacheValue(floatingEffectPatternCache, aliasPattern, {
    floatingEffectCall: new RegExp(
      `^(?:void\\s+)?\\(*\\s*(?:${aliasPattern})\\.(?!(?:${runtimeMethods})\\b)[A-Za-z_$][\\w$]*\\s*\\(`,
    ),
    guardedAndEffectCall: new RegExp(
      `^[A-Za-z_$][\\w$]*(?:\\.[A-Za-z_$][\\w$]*)?\\s*&&\\s*(?:${aliasPattern})\\.(?!(?:${runtimeMethods})\\b)[A-Za-z_$][\\w$]*\\s*\\(`,
    ),
    guardedOrEffectCall: new RegExp(
      `^[A-Za-z_$][\\w$]*(?:\\.[A-Za-z_$][\\w$]*)?\\s*\\|\\|\\s*(?:${aliasPattern})\\.(?!(?:${runtimeMethods})\\b)[A-Za-z_$][\\w$]*\\s*\\(`,
    ),
    inlineIfEffectCall: new RegExp(
      `^if\\s*\\([^)]*\\)\\s*(?:${aliasPattern})\\.(?!(?:${runtimeMethods})\\b)[A-Za-z_$][\\w$]*\\s*\\(`,
    ),
    ternaryEffectCall: new RegExp(
      `\\?\\s*(?:${aliasPattern})\\.(?!(?:${runtimeMethods})\\b)[A-Za-z_$][\\w$]*\\s*\\(`,
    ),
  });
};

const hasFloatingEffectCandidateLine = (line: string, aliasNeedles: readonly string[]): boolean => {
  if (line.includes('.pipe') || line.includes('Schema.decode')) {
    return true;
  }

  return aliasNeedles.some((needle) => line.includes(needle));
};

const lineEndFor = (source: string, lineStart: number): number => {
  const newlineIndex = source.indexOf('\n', lineStart);
  if (newlineIndex === -1) {
    return source.length;
  }
  return newlineIndex;
};

const nextLineStart = (source: string, lineStart: number): number | undefined => {
  const newlineIndex = source.indexOf('\n', lineStart);
  if (newlineIndex === -1) {
    return undefined;
  }
  return newlineIndex + 1;
};

const isStandaloneFloatingCall = (input: FloatingLineInput): boolean =>
  input.patterns.floatingEffectCall.test(input.line) &&
  !/[=(:,[]\s*$/.test(input.previous) &&
  !input.previous.endsWith('.pipe(') &&
  !input.line.endsWith(',');

const isFloatingPipeCall = (line: string, previous: string): boolean =>
  /^[A-Za-z_$][\w$]*\.pipe\s*\([\s\S]*?\bEffect\./.test(line) && !/[=(:,[]\s*$/.test(previous);

const isFloatingDecodeCall = (line: string): boolean =>
  /^Schema\.decode[A-Za-z]*\s*\([^)]*\)\s*\([^)]*\)\s*;?$/.test(line);

const isFloatingGuardedCall = (line: string, patterns: FloatingEffectPatterns): boolean =>
  patterns.inlineIfEffectCall.test(line) ||
  patterns.guardedAndEffectCall.test(line) ||
  patterns.guardedOrEffectCall.test(line) ||
  patterns.ternaryEffectCall.test(line);

const isFloatingEffectLine = (input: FloatingLineInput): boolean =>
  isStandaloneFloatingCall(input) ||
  isFloatingPipeCall(input.line, input.previous) ||
  isFloatingDecodeCall(input.line) ||
  isFloatingGuardedCall(input.line, input.patterns);

const floatingLineState = (
  code: string,
  lineStart: number,
  previous: string,
): { line: string; nextPrevious: string; nextStart?: number; previous: string } => {
  const line = code.slice(lineStart, lineEndFor(code, lineStart)).trim();
  if (line === '') {
    return { line, nextPrevious: previous, nextStart: nextLineStart(code, lineStart), previous };
  }
  return { line, nextPrevious: line, nextStart: nextLineStart(code, lineStart), previous };
};

const isFloatingEffectCandidate = (
  state: { line: string; previous: string },
  aliasNeedles: readonly string[],
  patterns: FloatingEffectPatterns,
): boolean =>
  hasFloatingEffectCandidateLine(state.line, aliasNeedles) &&
  isFloatingEffectLine({ line: state.line, patterns, previous: state.previous });

const hasFloatingEffectLines = (
  code: string,
  aliasNeedles: readonly string[],
  aliases: string,
): boolean => {
  const patterns = floatingEffectPatterns(aliases);
  let state = floatingLineState(code, 0, '');
  while (true) {
    if (isFloatingEffectCandidate(state, aliasNeedles, patterns)) {
      return true;
    }
    if (state.nextStart === undefined) {
      return false;
    }
    state = floatingLineState(code, state.nextStart, state.nextPrevious);
  }
};

const hasFloatingPipeStatement = (code: string): boolean => {
  for (const match of code.matchAll(/^\s*[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?\.pipe\s*\(/gm)) {
    const statementPrefix = code.slice(code.lastIndexOf(';', match.index) + 1, match.index);
    if (!/[=(:,[]\s*$/.test(statementPrefix.trimEnd())) {
      const openParenIndex = code.indexOf('(', match.index);
      const pipeCall = code.slice(match.index, findBalancedCallEnd(code, openParenIndex) + 1);
      if (/\bEffect\./.test(pipeCall)) {
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
export const hasFloatingEffect = (source: string): boolean => {
  const code = stripCommentsAndStrings(source);
  const aliasNeedles = effectImportAliases(source).map((alias) => `${alias}.`);
  const aliases = effectAliasesPattern(source);
  return hasFloatingEffectLines(code, aliasNeedles, aliases) || hasFloatingPipeStatement(code);
};
