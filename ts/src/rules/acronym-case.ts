import acronyms from './acronyms.js';

/**
 * Split a mixedCase (camelCase or PascalCase) identifier into word segments.
 *
 * Uses index tracking + single slice at word boundaries instead of per-character
 * string concatenation.
 */
function splitMixedCase(name: string): string[] {
  const words: string[] = [];
  const len = name.length;
  if (len === 0) {
    return words;
  }

  let wordStart = 0;
  let prevUpper = name.charCodeAt(0) < 97;
  let prevUpperCount = prevUpper ? 1 : 0;

  for (let idx = 1; idx < len; idx++) {
    const code = name.charCodeAt(idx);
    const isUpper = code < 97 && code >= 65;

    if (isUpper && !prevUpper) {
      words.push(name.slice(wordStart, idx));
      wordStart = idx;
      prevUpperCount = 1;
    } else if (!isUpper && prevUpper && prevUpperCount >= 2) {
      words.push(name.slice(wordStart, idx - 1));
      wordStart = idx - 1;
      prevUpperCount = 0;
    } else {
      prevUpperCount = isUpper ? prevUpperCount + 1 : 0;
    }
    prevUpper = isUpper;
  }

  words.push(name.slice(wordStart));
  return words;
}

/** Check if a word is a mis-cased acronym (known acronym not in ALLCAPS). */
function hasMisCasedAcronym(word: string): boolean {
  if (word.length < 2) {
    return false;
  }

  // Strip trailing digits
  let alphaEnd = word.length;
  while (alphaEnd > 0) {
    const dc = word.charCodeAt(alphaEnd - 1);
    if (dc < 48 || dc > 57) {
      break;
    }
    alphaEnd--;
  }
  if (alphaEnd < 2) {
    return false;
  }

  const alpha = word.slice(0, alphaEnd);
  return acronyms.has(alpha.toLowerCase()) && !isAllUpper(alpha, alpha.length);
}

/** Check if entire string (known length) is all uppercase A-Z. */
function isAllUpper(str: string, length: number): boolean {
  for (let idx = 0; idx < length; idx++) {
    const ch = str.charCodeAt(idx);
    if (ch < 65 || ch > 90) {
      return false;
    }
  }
  return true;
}

/**
 * Check if an identifier contains acronyms that are not consistently uppercase.
 */
export default function findMisCasedAcronyms(name: string): string[] {
  // Quick rejection: must have both upper and lower
  let hasUpper = false;
  let hasLower = false;
  const len = name.length;
  for (let idx = 0; idx < len; idx++) {
    const ch = name.charCodeAt(idx);
    if (ch < 97) {
      hasUpper ||= ch >= 65 && ch <= 90;
    } else if (ch <= 122) {
      hasLower = true;
    }
    if (hasUpper && hasLower) {
      break;
    }
  }
  if (!hasUpper || !hasLower) {
    return [];
  }

  const words = splitMixedCase(name);
  const violations: string[] = [];

  for (let idx = 0; idx < words.length; idx++) {
    if (hasMisCasedAcronym(words[idx])) {
      violations.push(words[idx]);
    }
  }

  return violations;
}

/**
 * Fix mis-cased acronyms in an identifier by uppercasing known acronyms.
 */
export function fixAcronymCase(name: string): string {
  let hasUpper = false;
  let hasLower = false;
  const len = name.length;
  for (let idx = 0; idx < len; idx++) {
    const ch = name.charCodeAt(idx);
    if (ch < 97) {
      hasUpper ||= ch >= 65 && ch <= 90;
    } else if (ch <= 122) {
      hasLower = true;
    }
    if (hasUpper && hasLower) {
      break;
    }
  }
  if (!hasUpper || !hasLower) {
    return name;
  }

  const words = splitMixedCase(name);
  let changed = false;

  for (let idx = 0; idx < words.length; idx++) {
    const word = words[idx];
    if (word.length < 2) {
      continue;
    }

    let alphaEnd = word.length;
    while (alphaEnd > 0) {
      const dc = word.charCodeAt(alphaEnd - 1);
      if (dc < 48 || dc > 57) {
        break;
      }
      alphaEnd--;
    }
    if (alphaEnd < 2) {
      continue;
    }

    const alpha = word.slice(0, alphaEnd);
    if (acronyms.has(alpha.toLowerCase()) && !isAllUpper(alpha, alpha.length)) {
      words[idx] = word.slice(0, alphaEnd).toUpperCase() + word.slice(alphaEnd);
      changed = true;
    }
  }

  return changed ? words.join('') : name;
}
