/* -------------------------------------------------------------------------- */
/*                   Floating Effect expression detection.                    */
/* -------------------------------------------------------------------------- */
import { Array, Match, pipe } from 'effect';
import { findBalancedCallEnd, stripCommentsAndStrings } from './effect-source-helpers';
import { createWeightedCache } from './source-cache';
import { effectAliasesPattern } from './effect-default-scan-helpers';
import { effectImportAliases } from './effect-rule-core';

const EFFECT_PATTERN_CACHE_MAX = 256;
const BYTES_PER_KIBIBYTE = 1024;
const BYTES_PER_MEBIBYTE = BYTES_PER_KIBIBYTE * BYTES_PER_KIBIBYTE;
const FLOATING_EFFECT_PATTERN_CACHE_MEBIBYTES = 4;
const FLOATING_EFFECT_PATTERN_CACHE_MAX_WEIGHT =
  FLOATING_EFFECT_PATTERN_CACHE_MEBIBYTES * BYTES_PER_MEBIBYTE;
const UTF16_CODE_UNIT_BYTES = 2;
const CACHE_ENTRY_BYTES = 128;
const OBJECT_BASE_BYTES = 256;
const REGEXP_BYTES = 128;

interface FloatingEffectPatterns {
  floatingEffectCall: RegExp;
  guardedAndEffectCall: RegExp;
  guardedOrEffectCall: RegExp;
  inlineIfEffectCall: RegExp;
  ternaryEffectCall: RegExp;
}

type FloatingEffectPatternCache = ReturnType<
  typeof createWeightedCache<string, FloatingEffectPatterns>
>;
const floatingEffectPatternCache: FloatingEffectPatternCache = createWeightedCache({
  maxEntries: EFFECT_PATTERN_CACHE_MAX,
  maxWeight: FLOATING_EFFECT_PATTERN_CACHE_MAX_WEIGHT,
});

interface FloatingLineInput {
  line: string;
  patterns: FloatingEffectPatterns;
  previous: string;
}

const UTF16Bytes = (value: string): number => value.length * UTF16_CODE_UNIT_BYTES;
const bytesForUTF16 = UTF16Bytes;

const floatingEffectPatternsWeight = (
  aliasPattern: string,
  patterns: FloatingEffectPatterns,
): number =>
  bytesForUTF16(aliasPattern) +
  CACHE_ENTRY_BYTES +
  OBJECT_BASE_BYTES +
  [
    patterns.floatingEffectCall,
    patterns.guardedAndEffectCall,
    patterns.guardedOrEffectCall,
    patterns.inlineIfEffectCall,
    patterns.ternaryEffectCall,
  ].reduce((weight, pattern): number => weight + REGEXP_BYTES + bytesForUTF16(pattern.source), 0);

const floatingEffectPatterns = (aliasPattern: string): FloatingEffectPatterns => {
  const cachedPatterns = floatingEffectPatternCache.get(aliasPattern);
  if (cachedPatterns !== undefined) {
    return cachedPatterns;
  }
  const runtimeMethods = 'runPromise|runPromiseExit|runSync|runSyncExit|runFork';
  const patterns: FloatingEffectPatterns = {
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
  };
  return floatingEffectPatternCache.set(
    aliasPattern,
    patterns,
    floatingEffectPatternsWeight(aliasPattern, patterns),
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

const FLOATING_PIPE_STATEMENT_PATTERN = /^\s*[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?\.pipe\s*\(/gm;
const FLOATING_PIPE_PREFIX_CHARACTERS = '=(:,[';
const FLOATING_PIPE_WHITESPACE_CHARACTERS =
  '\t\n\v\f\r \u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff';

const isFloatingPipeWhitespace = (character: string | undefined): boolean =>
  character !== undefined && FLOATING_PIPE_WHITESPACE_CHARACTERS.includes(character);

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

const previousNonWhitespaceIndexBefore = (
  code: string,
  startIndex: number,
  endIndex: number,
  previousIndex: number,
): number => {
  let index = startIndex;
  let lastIndex = previousIndex;
  while (index < endIndex) {
    if (!isFloatingPipeWhitespace(code[index])) {
      lastIndex = index;
    }
    index += 1;
  }
  return lastIndex;
};

const isFloatingPipeStatementPrefixAllowed = (
  code: string,
  previousNonWhitespaceIndex: number,
): boolean => {
  const previousCharacter = code[previousNonWhitespaceIndex];
  return (
    previousCharacter === undefined || !FLOATING_PIPE_PREFIX_CHARACTERS.includes(previousCharacter)
  );
};

const hasFloatingEffectInPipeCall = (code: string, matchIndex: number): boolean => {
  const openParenIndex = code.indexOf('(', matchIndex);
  const pipeCall = code.slice(matchIndex, findBalancedCallEnd(code, openParenIndex) + 1);
  return /\bEffect\./.test(pipeCall);
};

const hasFloatingPipeStatement = (code: string): boolean => {
  let previousNonWhitespaceIndex = -1;
  let scannedIndex = 0;

  for (const match of code.matchAll(FLOATING_PIPE_STATEMENT_PATTERN)) {
    previousNonWhitespaceIndex = previousNonWhitespaceIndexBefore(
      code,
      scannedIndex,
      match.index,
      previousNonWhitespaceIndex,
    );
    scannedIndex = match.index;
    if (
      isFloatingPipeStatementPrefixAllowed(code, previousNonWhitespaceIndex) &&
      hasFloatingEffectInPipeCall(code, match.index)
    ) {
      return true;
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
  const aliasNeedles = pipe(
    effectImportAliases(source),
    Array.map((alias): string => `${alias}.`),
  );
  const aliases = effectAliasesPattern(source);
  return hasFloatingEffectLines(code, aliasNeedles, aliases) || hasFloatingPipeStatement(code);
};
