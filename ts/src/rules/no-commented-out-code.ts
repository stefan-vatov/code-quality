/**
 * Detection heuristic for commented-out source code.
 *
 * Checks whether a comment's text content looks like code rather than
 * natural language. Uses a scoring approach: each code indicator adds
 * to a score; if the score meets the threshold, the comment is flagged.
 *
 * Optimized: pre-compiled regex, line scanning via indexOf, minimal
 * string allocations.
 */

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

/** Extract first whitespace-delimited word from text. */
function firstWord(text: string): string {
  let end = 0;
  const len = text.length;
  while (end < len && text.charCodeAt(end) > 32) {
    end++;
  }
  return text.slice(0, end).toLowerCase();
}

export default function isCommentedOutCode(text: string): boolean {
  const normalized = text.trim();
  if (normalized.length < 3) {
    return false;
  }

  // Fast-path: check for code-like tokens
  let hasCodeTokens = RE_CODE_TOKEN.test(normalized);
  if (!hasCodeTokens) {
    hasCodeTokens = CODE_KEYWORDS.has(firstWord(normalized));
  }
  if (!hasCodeTokens && !RE_KEYWORD_SCAN.test(normalized)) {
    return false;
  }

  let score = 0;
  let foundKeyword = false;

  // 1. Line-by-line keyword scanning (avoid split() — scan with indexOf)
  let braceCount = 0;
  let lineCount = 0;
  let pos = 0;
  const len = normalized.length;

  while (pos < len) {
    // Find line end
    let lineEnd = normalized.indexOf('\n', pos);
    if (lineEnd === -1) {
      lineEnd = len;
    }

    // Skip leading whitespace
    let lineStart = pos;
    while (lineStart < lineEnd && normalized.charCodeAt(lineStart) <= 32) {
      lineStart++;
    }

    if (lineStart < lineEnd) {
      lineCount++;

      // Count braces in this line
      for (let idx = lineStart; idx < lineEnd; idx++) {
        if (normalized.charCodeAt(idx) === 123) {
          braceCount++;
        }
      }

      // Extract first word of line
      let wordEnd = lineStart;
      while (wordEnd < lineEnd && normalized.charCodeAt(wordEnd) > 32) {
        wordEnd++;
      }
      const fw = normalized.slice(lineStart, wordEnd).toLowerCase();
      // Strip trailing punctuation
      const clean = fw.replace(/[;:,]$/, '');
      if (CODE_KEYWORDS.has(clean)) {
        score += 2;
        foundKeyword = true;
      }
    }

    pos = lineEnd + 1;
  }

  // 2. Code patterns
  if (RE_ARROW_FN.test(normalized)) {
    score += 2;
  }
  if (RE_ASSIGNMENT.test(normalized)) {
    score += 2;
  }
  if (RE_SEMICOLON_LINE.test(normalized)) {
    score += 2;
  }
  if (RE_DOT_CALL.test(normalized)) {
    score += 2;
  }
  if (RE_TEMPLATE.test(normalized)) {
    score += 2;
  }
  if (RE_JSX_TAG.test(normalized)) {
    score += 2;
  }
  if (RE_SPREAD.test(normalized)) {
    score += 2;
  }

  // 3. Brace bonus
  if (braceCount >= 1) {
    score += braceCount;
  }

  // 4. Multi-line bonus
  if (lineCount >= 3) {
    score += 1;
  }

  // 5. Natural-language penalties
  if (!foundKeyword && RE_NATURAL_START.test(normalized)) {
    score -= 3;
  }
  if (RE_JSDOC_TAG.test(normalized)) {
    score -= 10;
  }
  if (!foundKeyword && RE_URL.test(normalized)) {
    score -= 5;
  }
  if (
    !foundKeyword &&
    braceCount === 0 &&
    lineCount === 1 &&
    normalized.charCodeAt(0) >= 65 &&
    normalized.charCodeAt(0) <= 90 &&
    normalized.charCodeAt(1) >= 97 &&
    normalized.charCodeAt(1) <= 122
  ) {
    score -= 2;
  }

  return score >= 3;
}
