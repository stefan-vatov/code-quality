/* -------------------------------------------------------------------------- */
/*    Detection heuristic for commented-out source code. Checks whether a     */
/* Comment's text content looks like code rather than natural language. Uses  */
/*   A scoring approach: each code indicator adds to a score; if the score    */
/*    Meets the threshold, the comment is flagged. Optimized: pre-compiled    */
/*       Regex, line scanning via indexOf, minimal string allocations.        */
/* -------------------------------------------------------------------------- */
import { Array, HashSet, Match, pipe } from 'effect';

// Pre-compiled regex patterns
const RE_ARROW_FN = /\b=>\s*[{(\w]/;
const RE_ASSIGNMENT = /\b\w+\s*=\s*[^=]/;
const RE_SEMICOLON_LINE = /;\s*$/m;
const RE_DOT_CALL = /\.\w+\(/;
const RE_TEMPLATE = /`[^`]*\$\{/;
const RE_JSX_TAG = /<\/?[A-Z]\w*/;
const RE_SPREAD = /\.\.\.\w+/;
const RE_CODE_TOKEN = /[;={}<>()&|!?:[\]]/;
const RE_KEYWORD_SCAN =
  /\b(await|async|function|class|import|export|return|throw|new|yield|for|while|if|switch|try|catch)\b/i;
const RE_NATURAL_START =
  /^(a|an|the|this|that|these|those|we|you|it|is|are|was|were|to|in|of|for|with|on|at|by|from|see|note|use)\s/i;
const RE_JSDOC_TAG = /^@\w+/;
const RE_URL = /https?:\/\//;
const CHAR_CODE_SPACE = 32;
const CHAR_CODE_OPEN_BRACE = 123;
const CHAR_CODE_UPPER_A = 65;
const CHAR_CODE_UPPER_Z = 90;
const CHAR_CODE_LOWER_A = 97;
const CHAR_CODE_LOWER_Z = 122;
const MIN_COMMENT_LENGTH = 3;
const KEYWORD_SCORE = 2;
const PATTERN_SCORE = 2;
const MULTILINE_LINE_THRESHOLD = 3;
const MULTILINE_SCORE = 1;
const NATURAL_LANGUAGE_PENALTY = 3;
const JSDOC_TAG_PENALTY = 10;
const URL_PENALTY = 5;
const SENTENCE_CASE_PENALTY = 2;
const FLAG_SCORE_THRESHOLD = 3;

// Code-indicative keywords
const CODE_KEYWORDS = HashSet.make(
  'const',
  'let',
  'var',
  'function',
  'class',
  'import',
  'export',
  'return',
  'if',
  'for',
  'while',
  'switch',
  'try',
  'catch',
  'throw',
  'await',
  'async',
  'interface',
  'type',
  'enum',
  'new',
  'yield',
  'extends',
  'implements',
  'typeof',
  'instanceof',
  'break',
  'continue',
  'default',
  'case',
  'finally',
  'static',
  'get',
  'set',
  'readonly',
  'abstract',
  'declare',
  'protected',
  'private',
  'public',
);

const scanIndexes = (startIndex: number, endIndex: number): readonly number[] =>
  Match.value(startIndex).pipe(
    Match.when(
      (value): boolean => value > endIndex,
      () => [],
    ),
    Match.orElse((value): readonly number[] => Array.range(value, endIndex)),
  );

/**
 * Extract first whitespace-delimited word from text.
 */
const firstWhitespaceIndex = (text: string, index: number): number =>
  Match.value(index).pipe(
    Match.when(
      (current): boolean => current >= text.length || text.charCodeAt(current) <= CHAR_CODE_SPACE,
      (current): number => current,
    ),
    Match.orElse((current): number => firstWhitespaceIndex(text, current + 1)),
  );

const firstWord = (text: string): string =>
  text.slice(0, firstWhitespaceIndex(text, 0)).toLowerCase();

const countOpenBraces = (source: string, start: number, end: number): number =>
  pipe(
    scanIndexes(start, end - 1),
    Array.reduce(0, (count, idx): number =>
      Match.value(source.charCodeAt(idx)).pipe(
        Match.when(CHAR_CODE_OPEN_BRACE, (): number => count + 1),
        Match.orElse((): number => count),
      ),
    ),
  );

interface LineStats {
  braceCount: number;
  hasFoundKeyword: boolean;
  lineCount: number;
  score: number;
}

const hasCodeTokenSignal = (normalized: string): boolean =>
  Match.value(RE_CODE_TOKEN.test(normalized)).pipe(
    Match.when(true, (): boolean => true),
    Match.when(
      (): boolean => HashSet.has(CODE_KEYWORDS, firstWord(normalized)),
      (): boolean => true,
    ),
    Match.orElse((): boolean => RE_KEYWORD_SCAN.test(normalized)),
  );

const nextLineEnd = (source: string, position: number): number =>
  Match.value(source.indexOf('\n', position)).pipe(
    Match.when(-1, (): number => source.length),
    Match.orElse((lineEnd): number => lineEnd),
  );

const firstNonWhitespaceIndex = (source: string, start: number, end: number): number =>
  Match.value(start).pipe(
    Match.when(
      (index): boolean => index >= end || source.charCodeAt(index) > CHAR_CODE_SPACE,
      (index): number => index,
    ),
    Match.orElse((index): number => firstNonWhitespaceIndex(source, index + 1, end)),
  );

const lineWordEnd = (source: string, start: number, end: number): number =>
  Match.value(start).pipe(
    Match.when(
      (wordEnd): boolean => wordEnd >= end || source.charCodeAt(wordEnd) <= CHAR_CODE_SPACE,
      (wordEnd): number => wordEnd,
    ),
    Match.orElse((wordEnd): number => lineWordEnd(source, wordEnd + 1, end)),
  );

const firstLineWord = (source: string, start: number, end: number): string =>
  source
    .slice(start, lineWordEnd(source, start, end))
    .toLowerCase()
    .replace(/[;:,]$/, '');

const lineKeywordScore = (
  source: string,
  lineStart: number,
  lineEnd: number,
): { hasFoundKeyword: boolean; score: number } => {
  const clean = firstLineWord(source, lineStart, lineEnd);
  return Match.value(HashSet.has(CODE_KEYWORDS, clean)).pipe(
    Match.when(true, (): { hasFoundKeyword: boolean; score: number } => ({
      hasFoundKeyword: true,
      score: KEYWORD_SCORE,
    })),
    Match.orElse((): { hasFoundKeyword: boolean; score: number } => ({
      hasFoundKeyword: false,
      score: 0,
    })),
  );
};

const addLineStats = (
  stats: LineStats,
  normalized: string,
  lineStart: number,
  lineEnd: number,
): LineStats => {
  const keywordScore = lineKeywordScore(normalized, lineStart, lineEnd);
  return {
    braceCount: stats.braceCount + countOpenBraces(normalized, lineStart, lineEnd),
    hasFoundKeyword: stats.hasFoundKeyword || keywordScore.hasFoundKeyword,
    lineCount: stats.lineCount + 1,
    score: stats.score + keywordScore.score,
  };
};

const initialLineStats = (): LineStats => ({
  braceCount: 0,
  hasFoundKeyword: false,
  lineCount: 0,
  score: 0,
});

const scanLineStatsFrom = (normalized: string, pos: number, stats: LineStats): LineStats =>
  Match.value(pos).pipe(
    Match.when(
      (position): boolean => position >= normalized.length,
      (): LineStats => stats,
    ),
    Match.orElse((position): LineStats => {
      const lineEnd = nextLineEnd(normalized, position);
      const lineStart = firstNonWhitespaceIndex(normalized, position, lineEnd);
      const nextStats = Match.value(lineStart < lineEnd).pipe(
        Match.when(true, (): LineStats => addLineStats(stats, normalized, lineStart, lineEnd)),
        Match.orElse((): LineStats => stats),
      );
      return scanLineStatsFrom(normalized, lineEnd + 1, nextStats);
    }),
  );

const scanLineStats = (normalized: string): LineStats =>
  scanLineStatsFrom(normalized, 0, initialLineStats());

const patternScore = (normalized: string): number => {
  const patterns = [
    RE_ARROW_FN,
    RE_ASSIGNMENT,
    RE_SEMICOLON_LINE,
    RE_DOT_CALL,
    RE_TEMPLATE,
    RE_JSX_TAG,
    RE_SPREAD,
  ];
  return pipe(
    patterns,
    Array.reduce(0, (score, pattern): number =>
      Match.value(pattern.test(normalized)).pipe(
        Match.when(true, (): number => score + PATTERN_SCORE),
        Match.orElse((): number => score),
      ),
    ),
  );
};

const isSentenceCaseSingleLine = (normalized: string, stats: LineStats): boolean =>
  !stats.hasFoundKeyword &&
  stats.braceCount === 0 &&
  stats.lineCount === 1 &&
  normalized.charCodeAt(0) >= CHAR_CODE_UPPER_A &&
  normalized.charCodeAt(0) <= CHAR_CODE_UPPER_Z &&
  normalized.charCodeAt(1) >= CHAR_CODE_LOWER_A &&
  normalized.charCodeAt(1) <= CHAR_CODE_LOWER_Z;

const scoreWhen = (condition: boolean, score: number): number =>
  Match.value(condition).pipe(
    Match.when(true, (): number => score),
    Match.orElse((): number => 0),
  );

const languagePenaltyChecks = (normalized: string, stats: LineStats): readonly number[] => [
  scoreWhen(!stats.hasFoundKeyword && RE_NATURAL_START.test(normalized), NATURAL_LANGUAGE_PENALTY),
  scoreWhen(RE_JSDOC_TAG.test(normalized), JSDOC_TAG_PENALTY),
  scoreWhen(!stats.hasFoundKeyword && RE_URL.test(normalized), URL_PENALTY),
  scoreWhen(isSentenceCaseSingleLine(normalized, stats), SENTENCE_CASE_PENALTY),
];

const languagePenalty = (normalized: string, stats: LineStats): number =>
  pipe(
    languagePenaltyChecks(normalized, stats),
    Array.reduce(0, (penalty, value): number => penalty + value),
  );

const structuralScore = (stats: LineStats): number =>
  pipe(
    [
      stats.score,
      scoreWhen(stats.braceCount >= 1, stats.braceCount),
      scoreWhen(stats.lineCount >= MULTILINE_LINE_THRESHOLD, MULTILINE_SCORE),
    ],
    Array.reduce(0, (score, value): number => score + value),
  );

/**
 * Determines whether comment text is likely dead source code.
 *
 * @param text - Raw comment text without comment delimiters.
 * @returns True when the text scores as commented-out code.
 */
export default function isCommentedOutCode(text: string): boolean {
  const normalized = text.trim();
  return Match.value(normalized).pipe(
    Match.when(
      (value): boolean => value.length < MIN_COMMENT_LENGTH,
      (): boolean => false,
    ),
    Match.when(
      (value): boolean => !hasCodeTokenSignal(value),
      (): boolean => false,
    ),
    Match.orElse((value): boolean => {
      const stats = scanLineStats(value);
      const score = structuralScore(stats) + patternScore(value) - languagePenalty(value, stats);
      return score >= FLAG_SCORE_THRESHOLD;
    }),
  );
}
