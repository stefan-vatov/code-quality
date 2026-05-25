/* -------------------------------------------------------------------------- */
/*                   Floating Effect expression detection.                    */
/* -------------------------------------------------------------------------- */
import { Array, Match, Option, pipe } from 'effect';
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

const floatingEffectPatterns = (aliasPattern: string): FloatingEffectPatterns => {
  const cachedPatterns = floatingEffectPatternCache.get(aliasPattern);
  return pipe(
    Option.fromNullable(cachedPatterns),
    Option.match({
      onNone: (): FloatingEffectPatterns => {
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
      },
      onSome: (patterns): FloatingEffectPatterns => patterns,
    }),
  );
};

const hasFloatingEffectCandidateLine = (line: string, aliasNeedles: readonly string[]): boolean =>
  Match.value(line).pipe(
    Match.when(
      (value): boolean => value.includes('.pipe') || value.includes('Schema.decode'),
      (): boolean => true,
    ),
    Match.orElse((value): boolean =>
      pipe(
        aliasNeedles,
        Array.some((needle): boolean => value.includes(needle)),
      ),
    ),
  );

const lineEndFor = (source: string, lineStart: number): number => {
  const newlineIndex = source.indexOf('\n', lineStart);
  return Match.value(newlineIndex).pipe(
    Match.when(
      (index): boolean => index === -1,
      (): number => source.length,
    ),
    Match.orElse((index): number => index),
  );
};

const nextLineStart = (source: string, lineStart: number): number | undefined => {
  const newlineIndex = source.indexOf('\n', lineStart);
  return Match.value(newlineIndex).pipe(
    Match.when(
      (index): boolean => index === -1,
      (): undefined => undefined,
    ),
    Match.orElse((index): number => index + 1),
  );
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
  pipe(
    [
      patterns.inlineIfEffectCall,
      patterns.guardedAndEffectCall,
      patterns.guardedOrEffectCall,
      patterns.ternaryEffectCall,
    ],
    Array.some((pattern): boolean => pattern.test(line)),
  );

const isFloatingEffectLine = (input: FloatingLineInput): boolean =>
  pipe(
    [
      (): boolean => isStandaloneFloatingCall(input),
      (): boolean => isFloatingPipeCall(input.line, input.previous),
      (): boolean => isFloatingDecodeCall(input.line),
      (): boolean => isFloatingGuardedCall(input.line, input.patterns),
    ],
    Array.some((predicate): boolean => predicate()),
  );

const floatingLineState = (
  code: string,
  lineStart: number,
  previous: string,
): { line: string; nextPrevious: string; nextStart?: number; previous: string } => {
  const line = code.slice(lineStart, lineEndFor(code, lineStart)).trim();
  return Match.value(line).pipe(
    Match.when(
      (value): boolean => value === '',
      (): { line: string; nextPrevious: string; nextStart?: number; previous: string } => ({
        line,
        nextPrevious: previous,
        nextStart: nextLineStart(code, lineStart),
        previous,
      }),
    ),
    Match.orElse(
      (value): { line: string; nextPrevious: string; nextStart?: number; previous: string } => ({
        line: value,
        nextPrevious: value,
        nextStart: nextLineStart(code, lineStart),
        previous,
      }),
    ),
  );
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
  const scanLine = (state: ReturnType<typeof floatingLineState>): boolean =>
    Match.value(state).pipe(
      Match.when(
        (currentState): boolean => isFloatingEffectCandidate(currentState, aliasNeedles, patterns),
        (): boolean => true,
      ),
      Match.when(
        (currentState): boolean => currentState.nextStart === undefined,
        (): boolean => false,
      ),
      Match.orElse((currentState): boolean =>
        scanLine(floatingLineState(code, currentState.nextStart ?? 0, currentState.nextPrevious)),
      ),
    );
  return scanLine(floatingLineState(code, 0, ''));
};

const hasFloatingPipeStatement = (code: string): boolean =>
  pipe(
    [...code.matchAll(/^\s*[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?\.pipe\s*\(/gm)],
    Array.some((match): boolean => {
      const statementPrefix = code.slice(code.lastIndexOf(';', match.index) + 1, match.index);
      return Match.value(statementPrefix.trimEnd()).pipe(
        Match.when(
          (prefix): boolean => /[=(:,[]\s*$/.test(prefix),
          (): boolean => false,
        ),
        Match.orElse((): boolean => {
          const openParenIndex = code.indexOf('(', match.index);
          const pipeCall = code.slice(match.index, findBalancedCallEnd(code, openParenIndex) + 1);
          return /\bEffect\./.test(pipeCall);
        }),
      );
    }),
  );

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const hasFloatingEffect = (source: string): boolean => {
  const code = stripCommentsAndStrings(source);
  const aliasNeedles = pipe(
    effectImportAliases(source),
    Array.map((alias): string => `${alias}.`),
  );
  const aliases = effectAliasesPattern(source);
  return hasFloatingEffectLines(code, aliasNeedles, aliases) || hasFloatingPipeStatement(code);
};
