/* -------------------------------------------------------------------------- */
/*    Detection heuristic for commented-out source code. Checks whether a     */
/* Comment's text content looks like code rather than natural language. Uses  */
/*   A scoring approach: each code indicator adds to a score; if the score    */
/*    Meets the threshold, the comment is flagged. Optimized: pre-compiled    */
/*       Regex, line scanning via indexOf, minimal string allocations.        */
/* -------------------------------------------------------------------------- */
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

const CODE_KEYWORDS = new Set([
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
]);

const CODE_PATTERNS = [
  RE_ARROW_FN,
  RE_ASSIGNMENT,
  RE_SEMICOLON_LINE,
  RE_DOT_CALL,
  RE_TEMPLATE,
  RE_JSX_TAG,
  RE_SPREAD,
] as const;

/**
 * Extract first whitespace-delimited word from text.
 */
const firstWhitespaceIndex = (text: string, index: number): number => {
  let current = index;
  while (current < text.length && text.charCodeAt(current) > CHAR_CODE_SPACE) {
    current += 1;
  }
  return current;
};

const firstWord = (text: string): string =>
  text.slice(0, firstWhitespaceIndex(text, 0)).toLowerCase();

const countOpenBraces = (source: string, start: number, end: number): number => {
  let count = 0;
  for (let index = start; index < end; index += 1) {
    if (source.charCodeAt(index) === CHAR_CODE_OPEN_BRACE) {
      count += 1;
    }
  }
  return count;
};

interface LineStats {
  braceCount: number;
  hasFoundKeyword: boolean;
  lineCount: number;
  score: number;
}

const hasCodeTokenSignal = (normalized: string): boolean =>
  RE_CODE_TOKEN.test(normalized) ||
  CODE_KEYWORDS.has(firstWord(normalized)) ||
  RE_KEYWORD_SCAN.test(normalized);

const nextLineEnd = (source: string, position: number): number => {
  const lineEnd = source.indexOf('\n', position);
  if (lineEnd === -1) {
    return source.length;
  }
  return lineEnd;
};

const firstNonWhitespaceIndex = (source: string, start: number, end: number): number => {
  let index = start;
  while (index < end && source.charCodeAt(index) <= CHAR_CODE_SPACE) {
    index += 1;
  }
  return index;
};

const lineWordEnd = (source: string, start: number, end: number): number => {
  let wordEnd = start;
  while (wordEnd < end && source.charCodeAt(wordEnd) > CHAR_CODE_SPACE) {
    wordEnd += 1;
  }
  return wordEnd;
};

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
  const hasFoundKeyword = CODE_KEYWORDS.has(clean);
  if (hasFoundKeyword) {
    return { hasFoundKeyword, score: KEYWORD_SCORE };
  }
  return { hasFoundKeyword, score: 0 };
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

const scanLineStats = (normalized: string): LineStats => {
  let stats = initialLineStats();
  let position = 0;
  while (position < normalized.length) {
    const lineEnd = nextLineEnd(normalized, position);
    const lineStart = firstNonWhitespaceIndex(normalized, position, lineEnd);
    if (lineStart < lineEnd) {
      stats = addLineStats(stats, normalized, lineStart, lineEnd);
    }
    position = lineEnd + 1;
  }
  return stats;
};

const patternScore = (normalized: string): number => {
  let score = 0;
  for (const pattern of CODE_PATTERNS) {
    if (pattern.test(normalized)) {
      score += PATTERN_SCORE;
    }
  }
  return score;
};

const isSentenceCaseSingleLine = (normalized: string, stats: LineStats): boolean =>
  !stats.hasFoundKeyword &&
  stats.braceCount === 0 &&
  stats.lineCount === 1 &&
  normalized.charCodeAt(0) >= CHAR_CODE_UPPER_A &&
  normalized.charCodeAt(0) <= CHAR_CODE_UPPER_Z &&
  normalized.charCodeAt(1) >= CHAR_CODE_LOWER_A &&
  normalized.charCodeAt(1) <= CHAR_CODE_LOWER_Z;

const scoreWhen = (condition: boolean, score: number): number => {
  if (condition) {
    return score;
  }
  return 0;
};

const languagePenalty = (normalized: string, stats: LineStats): number =>
  scoreWhen(!stats.hasFoundKeyword && RE_NATURAL_START.test(normalized), NATURAL_LANGUAGE_PENALTY) +
  scoreWhen(RE_JSDOC_TAG.test(normalized), JSDOC_TAG_PENALTY) +
  scoreWhen(!stats.hasFoundKeyword && RE_URL.test(normalized), URL_PENALTY) +
  scoreWhen(isSentenceCaseSingleLine(normalized, stats), SENTENCE_CASE_PENALTY);

const structuralScore = (stats: LineStats): number =>
  stats.score +
  scoreWhen(stats.braceCount >= 1, stats.braceCount) +
  scoreWhen(stats.lineCount >= MULTILINE_LINE_THRESHOLD, MULTILINE_SCORE);

/**
 * Determines whether comment text is likely dead source code.
 *
 * @param text - Raw comment text without comment delimiters.
 * @returns True when the text scores as commented-out code.
 */
export default function isCommentedOutCode(text: string): boolean {
  const normalized = text.trim();
  if (normalized.length < MIN_COMMENT_LENGTH || !hasCodeTokenSignal(normalized)) {
    return false;
  }
  const stats = scanLineStats(normalized);
  const score =
    structuralScore(stats) + patternScore(normalized) - languagePenalty(normalized, stats);
  return score >= FLAG_SCORE_THRESHOLD;
}
