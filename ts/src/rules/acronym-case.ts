import acronyms from './acronyms.js';

/**
 * Split a mixedCase (camelCase or PascalCase) identifier into its word segments.
 *
 * Uses case-transition detection: transitions from lowercase→uppercase, or
 * uppercase→lowercase (when preceded by multiple uppercase → acronym boundary).
 *
 * Examples:
 *   "parseURL"          → ["parse", "URL"]
 *   "URLParser"         → ["URL", "Parser"]
 *   "getHTTPSResponse"  → ["get", "HTTPS", "Response"]
 *   "XMLHttpRequest"    → ["XML", "Http", "Request"]
 *   "userId"            → ["user", "Id"]
 */
function splitMixedCase(name: string): string[] {
  const words: string[] = [];
  let current = '';
  let prevUpper = false;
  let prevUpperCount = 0;

  for (const ch of name) {
    const isUpper = ch >= 'A' && ch <= 'Z';

    if (current.length === 0) {
      current = ch;
      prevUpper = isUpper;
      prevUpperCount = isUpper ? 1 : 0;
    } else if (isUpper && !prevUpper) {
      // Lowercase → uppercase: new word
      words.push(current);
      current = ch;
      prevUpper = true;
      prevUpperCount = 1;
    } else if (!isUpper && prevUpper && prevUpperCount >= 2) {
      // Multiple uppercase → lowercase: the last uppercase char belongs to the new word
      const lastUpper = current[current.length - 1];
      current = current.slice(0, -1);
      words.push(current);
      current = lastUpper + ch;
      prevUpper = false;
      prevUpperCount = 0;
    } else {
      current += ch;
      prevUpper = isUpper;
      prevUpperCount = isUpper ? prevUpperCount + 1 : 0;
    }
  }

  if (current.length > 0) {
    words.push(current);
  }

  return words;
}

/**
 * Check if an identifier contains acronyms that are not consistently uppercase.
 *
 * For mixedCase identifiers (camelCase / PascalCase), each word segment that is
 * a known programming acronym must be all uppercase. Examples:
 *
 *   Correct: parseURL, URLParser, HTTPSConnection
 *   Wrong:   parseUrl, UrlParser, HttpsConnection
 *
 * Returns an array of word segments that are known acronyms but not all-caps.
 * Empty array means no violations.
 */
export default function findMisCasedAcronyms(name: string): string[] {
  // Only process mixed-case identifiers (contain both upper and lower)
  const hasUpper = /[A-Z]/.test(name);
  const hasLower = /[a-z]/.test(name);
  if (!hasUpper || !hasLower) {
    return [];
  }

  const words = splitMixedCase(name);
  const violations: string[] = [];

  for (const word of words) {
    if (word.length < 2) {
      continue;
    } // Skip single letters
    // Strip trailing digits before lookup (parseUrl2 → "Url")
    const alpha = word.replace(/\d+$/, '');
    if (alpha.length < 2) {
      continue;
    }
    const lower = alpha.toLowerCase();
    if (acronyms.has(lower) && word !== word.toUpperCase()) {
      violations.push(word);
    }
  }

  return violations;
}
