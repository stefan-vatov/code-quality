/* -------------------------------------------------------------------------- */
/*    Detection heuristic for commented-out source code. Checks whether a     */
/* Comment's text content looks like code rather than natural language. Uses  */
/*   A scoring approach: each code indicator adds to a score; if the score    */
/*    Meets the threshold, the comment is flagged. Optimized: pre-compiled    */
/*       Regex, line scanning via indexOf, minimal string allocations.        */
/* -------------------------------------------------------------------------- */

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

/**
 * Extract first whitespace-delimited word from text.
 */
const firstWord = (text: string): string => {
  let end = 0;
  const len = text.length;
  while (end < len && text.charCodeAt(end) > CHAR_CODE_SPACE) {
    end++;
  }
  return text.slice(0, end).toLowerCase();
};

const countOpenBraces = (source: string, start: number, end: number): number => {
  let count = 0;
  for (let idx = start; idx < end; idx++) {
    if (source.charCodeAt(idx) === CHAR_CODE_OPEN_BRACE) {
      count++;
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

const hasCodeTokenSignal = (normalized: string): boolean => {
  if (RE_CODE_TOKEN.test(normalized)) {
    return true;
  }
  if (CODE_KEYWORDS.has(firstWord(normalized))) {
    return true;
  }
  return RE_KEYWORD_SCAN.test(normalized);
};

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
    index++;
  }
  return index;
};

const firstLineWord = (source: string, start: number, end: number): string => {
  let wordEnd = start;
  while (wordEnd < end && source.charCodeAt(wordEnd) > CHAR_CODE_SPACE) {
    wordEnd++;
  }
  return source
    .slice(start, wordEnd)
    .toLowerCase()
    .replace(/[;:,]$/, '');
};

const lineKeywordScore = (
  source: string,
  lineStart: number,
  lineEnd: number,
): { hasFoundKeyword: boolean; score: number } => {
  const clean = firstLineWord(source, lineStart, lineEnd);
  if (CODE_KEYWORDS.has(clean)) {
    return { hasFoundKeyword: true, score: KEYWORD_SCORE };
  }
  return { hasFoundKeyword: false, score: 0 };
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

const scanLineStats = (normalized: string): LineStats => {
  let stats: LineStats = {
    braceCount: 0,
    hasFoundKeyword: false,
    lineCount: 0,
    score: 0,
  };
  let pos = 0;

  while (pos < normalized.length) {
    const lineEnd = nextLineEnd(normalized, pos);
    const lineStart = firstNonWhitespaceIndex(normalized, pos, lineEnd);

    if (lineStart < lineEnd) {
      stats = addLineStats(stats, normalized, lineStart, lineEnd);
    }

    pos = lineEnd + 1;
  }

  return stats;
};

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
  return patterns.reduce((score, pattern): number => {
    if (pattern.test(normalized)) {
      return score + PATTERN_SCORE;
    }
    return score;
  }, 0);
};

const isSentenceCaseSingleLine = (normalized: string, stats: LineStats): boolean =>
  !stats.hasFoundKeyword &&
  stats.braceCount === 0 &&
  stats.lineCount === 1 &&
  normalized.charCodeAt(0) >= CHAR_CODE_UPPER_A &&
  normalized.charCodeAt(0) <= CHAR_CODE_UPPER_Z &&
  normalized.charCodeAt(1) >= CHAR_CODE_LOWER_A &&
  normalized.charCodeAt(1) <= CHAR_CODE_LOWER_Z;

const languagePenalty = (normalized: string, stats: LineStats): number => {
  let penalty = 0;
  if (!stats.hasFoundKeyword && RE_NATURAL_START.test(normalized)) {
    penalty += NATURAL_LANGUAGE_PENALTY;
  }
  if (RE_JSDOC_TAG.test(normalized)) {
    penalty += JSDOC_TAG_PENALTY;
  }
  if (!stats.hasFoundKeyword && RE_URL.test(normalized)) {
    penalty += URL_PENALTY;
  }
  if (isSentenceCaseSingleLine(normalized, stats)) {
    penalty += SENTENCE_CASE_PENALTY;
  }
  return penalty;
};

const structuralScore = (stats: LineStats): number => {
  const { braceCount, lineCount, score: baseScore } = stats;
  let score = baseScore;
  if (braceCount >= 1) {
    score += braceCount;
  }
  if (lineCount >= MULTILINE_LINE_THRESHOLD) {
    score += MULTILINE_SCORE;
  }
  return score;
};

/**
 * Determines whether comment text is likely dead source code.
 *
 * @param text - Raw comment text without comment delimiters.
 * @returns True when the text scores as commented-out code.
 */
export default function isCommentedOutCode(text: string): boolean {
  const normalized = text.trim();
  if (normalized.length < MIN_COMMENT_LENGTH) {
    return false;
  }

  if (!hasCodeTokenSignal(normalized)) {
    return false;
  }

  const stats = scanLineStats(normalized);
  const score =
    structuralScore(stats) + patternScore(normalized) - languagePenalty(normalized, stats);

  return score >= FLAG_SCORE_THRESHOLD;
}
