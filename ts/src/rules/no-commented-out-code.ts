/**
 * Detection heuristic for commented-out source code.
 *
 * Checks whether a comment's text content looks like code rather than
 * natural language. Uses a scoring approach: each code indicator adds
 * to a score; if the score meets the threshold, the comment is flagged.
 */

// Code-indicative keywords found in TypeScript/JavaScript
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

// Patterns that strongly indicate code
const CODE_PATTERNS: RegExp[] = [
  // Arrow function
  /\b=>\s*[{(]/,
  /\b=>\s+\w/,
  // Assignment (but not comparison operators)
  /\b\w+\s*=\s*[^=]/,
  // Statement terminator
  /;\s*$/m,
  // Function call with dot notation
  /\.\w+\(/,
  // Template literal
  /`[^`]*\$\{/,
  // JSX-like tag
  /<\/?[A-Z]\w*/,
  // Spread operator
  /\.\.\.\w+/,
];

export default function isCommentedOutCode(text: string): boolean {
  const normalized = text.trim();

  // Skip obviously not code: very short, or doc-like
  if (normalized.length < 3) {
    return false;
  }

  // Fast-path: if text contains no code-like tokens at all, skip
  const firstWord = normalized.split(/\s+/)[0].toLowerCase();
  let hasCodeTokens = /[;={}<>()&|!?:[\]]/.test(normalized);
  if (!hasCodeTokens) {
    hasCodeTokens = CODE_KEYWORDS.has(firstWord);
  }

  if (!hasCodeTokens) {
    if (
      !/\b(await|async|function|class|import|export|return|throw|new|yield|for|while|if|switch|try|catch)\b/i.test(
        normalized,
      )
    ) {
      return false;
    }
  }

  let score = 0;
  let foundKeyword = false;

  // Helper: strip trailing punctuation from a word for keyword matching
  const stripTrailingPunctuation = (word: string): string => word.replace(/[;:,]$/, '');

  // 1. Check for keywords at start of line (strong signal)
  const lines = normalized.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    const lineFirstWord = trimmed.split(/\s+/)[0].toLowerCase();

    if (
      CODE_KEYWORDS.has(lineFirstWord) ||
      CODE_KEYWORDS.has(stripTrailingPunctuation(lineFirstWord))
    ) {
      score += 2;
      foundKeyword = true;
    }
  }

  // 2. Check for code patterns
  for (const pattern of CODE_PATTERNS) {
    if (pattern.test(normalized)) {
      score += 2;
    }
  }

  // 3. Check for curly braces as block indicators
  const braceCount = (normalized.match(/\{/g) || []).length;
  if (braceCount >= 1) {
    score += braceCount;
  }

  // 4. Check for multiple lines (code tends to have structure)
  if (lines.length >= 3) {
    score += 1;
  }

  // 5. Penalize natural-language indicators
  // - Starting with lowercase articles or prepositions (but not when code keyword found)
  if (
    !foundKeyword &&
    /^(a|an|the|this|that|these|those|we|you|it|is|are|was|were|to|in|of|for|with|on|at|by|from|see|note|use)\s/i.test(
      normalized,
    )
  ) {
    score -= 3;
  }

  // - Starting with @ (JSDoc tag)
  if (/^@\w+/.test(normalized)) {
    score -= 10;
  }

  // - Contains URL but no code keywords (URLs in comments shouldn't flag)
  if (!foundKeyword && /https?:\/\//.test(normalized)) {
    score -= 5;
  }

  // - Looks like a natural language sentence (but not when code keyword found)
  if (!foundKeyword && /^[A-Z][a-z]/.test(normalized) && braceCount === 0 && lines.length === 1) {
    score -= 2;
  }

  // Threshold: score >= 3 means it's commented-out code
  return score >= 3;
}
