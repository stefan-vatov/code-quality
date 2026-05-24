import { CHAR_CLASS, CLS_DIGIT, CLS_LOWER, CLS_UNDER, CLS_UPPER } from './char-class.js';

const regexPrefixChars = new Set(['(', '[', '{', '=', ':', ',', ';', '!', '?', '&', '|']);
const regexPrefixWords = new Set(['case', 'delete', 'return', 'throw', 'typeof', 'void', 'yield']);
const STRIP_CACHE_MAX = 256;
const commentCache = new Map<string, string>();
const codeOnlyCache = new Map<string, string>();
const IDENTIFIER_MASK = CLS_UPPER | CLS_LOWER | CLS_DIGIT | CLS_UNDER;

function isWhitespaceCode(code: number): boolean {
  return code === 32 || code === 9 || code === 10 || code === 13 || code === 11 || code === 12;
}

function isAsciiIdentifierChar(source: string, index: number): boolean {
  const code = source.charCodeAt(index);
  return code === 36 || (code < CHAR_CLASS.length && (CHAR_CLASS[code] & IDENTIFIER_MASK) !== 0);
}

function isAsciiLetter(source: string, index: number): boolean {
  const code = source.charCodeAt(index);
  return code < CHAR_CLASS.length && (CHAR_CLASS[code] & (CLS_UPPER | CLS_LOWER)) !== 0;
}

function cached(cache: Map<string, string>, source: string): string | undefined {
  return cache.get(source);
}

function cacheResult(cache: Map<string, string>, source: string, value: string): string {
  if (cache.size >= STRIP_CACHE_MAX) {
    const firstKey = cache.keys().next().value;
    if (firstKey !== undefined) {
      cache.delete(firstKey);
    }
  }
  cache.set(source, value);
  return value;
}

function previousSignificantIndex(source: string, index: number): number {
  for (let cursor = index - 1; cursor >= 0; cursor--) {
    if (!isWhitespaceCode(source.charCodeAt(cursor))) {
      return cursor;
    }
  }

  return -1;
}

function wordBefore(source: string, index: number): string {
  const endIndex = previousSignificantIndex(source, index);
  if (endIndex === -1 || !isAsciiIdentifierChar(source, endIndex)) {
    return '';
  }

  let startIndex = endIndex;
  while (startIndex > 0 && isAsciiIdentifierChar(source, startIndex - 1)) {
    startIndex--;
  }

  return source.slice(startIndex, endIndex + 1);
}

function isRegexLiteralStart(source: string, index: number): boolean {
  if (source[index] !== '/' || source[index + 1] === '/' || source[index + 1] === '*') {
    return false;
  }

  const previousIndex = previousSignificantIndex(source, index);
  if (previousIndex === -1) {
    return true;
  }

  return (
    regexPrefixChars.has(source[previousIndex]) || regexPrefixWords.has(wordBefore(source, index))
  );
}

function findRegexLiteralEnd(source: string, startIndex: number): number {
  let isEscaped = false;
  let isCharacterClass = false;

  for (let index = startIndex + 1; index < source.length; index++) {
    const char = source[index];
    if (isEscaped) {
      isEscaped = false;
      continue;
    }
    if (char === '\\') {
      isEscaped = true;
      continue;
    }
    if (char === '[') {
      isCharacterClass = true;
      continue;
    }
    if (char === ']') {
      isCharacterClass = false;
      continue;
    }
    if (char === '\n') {
      return startIndex;
    }
    if (char === '/' && !isCharacterClass) {
      let flagsEndIndex = index;
      while (isAsciiLetter(source, flagsEndIndex + 1)) {
        flagsEndIndex++;
      }
      return flagsEndIndex;
    }
  }

  return startIndex;
}

function findBalancedCallEnd(source: string, openParenIndex: number): number {
  let depth = 0;
  let quote = '';
  let isEscaped = false;

  for (let index = openParenIndex; index < source.length; index++) {
    const char = source[index];
    const nextChar = source[index + 1];
    if (quote) {
      if (isEscaped) {
        isEscaped = false;
      } else if (char === '\\') {
        isEscaped = true;
      } else if (char === quote) {
        quote = '';
      }
      continue;
    }

    if (char === '/' && nextChar === '/') {
      const newlineIndex = source.indexOf('\n', index + 2);
      index = newlineIndex === -1 ? source.length : newlineIndex;
      continue;
    }
    if (char === '/' && nextChar === '*') {
      const commentEnd = source.indexOf('*/', index + 2);
      index = commentEnd === -1 ? source.length : commentEnd + 1;
      continue;
    }
    if (isRegexLiteralStart(source, index)) {
      index = findRegexLiteralEnd(source, index);
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      continue;
    }
    if (char === '(') {
      depth++;
    } else if (char === ')') {
      depth--;
      if (depth === 0) {
        return index;
      }
    }
  }

  return source.length - 1;
}

function stripComments(source: string): string {
  const cachedValue = cached(commentCache, source);
  if (cachedValue !== undefined) {
    return cachedValue;
  }

  let stripped = '';
  let quote = '';
  let isEscaped = false;
  let isLineComment = false;
  let isBlockComment = false;

  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    const nextChar = source[index + 1];

    if (isLineComment) {
      if (char === '\n') {
        isLineComment = false;
        stripped += char;
      } else {
        stripped += ' ';
      }
      continue;
    }

    if (isBlockComment) {
      if (char === '*' && nextChar === '/') {
        isBlockComment = false;
        stripped += '  ';
        index++;
      } else {
        stripped += char === '\n' ? char : ' ';
      }
      continue;
    }

    if (quote) {
      if (isEscaped) {
        isEscaped = false;
      } else if (char === '\\') {
        isEscaped = true;
      } else if (char === quote) {
        quote = '';
      }
      stripped += char;
      continue;
    }

    if (char === '/' && nextChar === '/') {
      isLineComment = true;
      stripped += '  ';
      index++;
      continue;
    }

    if (char === '/' && nextChar === '*') {
      isBlockComment = true;
      stripped += '  ';
      index++;
      continue;
    }
    if (isRegexLiteralStart(source, index)) {
      const endIndex = findRegexLiteralEnd(source, index);
      stripped += source.slice(index, endIndex + 1);
      index = endIndex;
      continue;
    }

    if (char === '"' || char === "'" || char === '`') {
      quote = char;
    }

    stripped += char;
  }

  return cacheResult(commentCache, source, stripped);
}

function stripCommentsAndStrings(source: string): string {
  const cachedValue = cached(codeOnlyCache, source);
  if (cachedValue !== undefined) {
    return cachedValue;
  }

  let stripped = '';
  let quote = '';
  let isEscaped = false;
  let isLineComment = false;
  let isBlockComment = false;
  let templateExpressionDepth = 0;

  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    const nextChar = source[index + 1];

    if (isLineComment) {
      if (char === '\n') {
        isLineComment = false;
        stripped += char;
      } else {
        stripped += ' ';
      }
      continue;
    }

    if (isBlockComment) {
      if (char === '*' && nextChar === '/') {
        isBlockComment = false;
        stripped += '  ';
        index++;
      } else {
        stripped += char === '\n' ? char : ' ';
      }
      continue;
    }

    if (quote) {
      const currentQuote = quote;
      let shouldPreserve = char === '\n';
      if (quote === '`' && char === '$' && nextChar === '{' && !isEscaped) {
        templateExpressionDepth++;
        quote = '';
        stripped += '  ';
        index++;
        continue;
      }
      if (isEscaped) {
        isEscaped = false;
      } else if (char === '\\') {
        isEscaped = true;
      } else if (char === quote) {
        shouldPreserve = true;
        quote = '';
      }
      stripped += shouldPreserve || char === currentQuote ? char : ' ';
      continue;
    }

    if (templateExpressionDepth > 0) {
      if (char === '{') {
        templateExpressionDepth++;
      } else if (char === '}') {
        templateExpressionDepth--;
        if (templateExpressionDepth === 0) {
          stripped += ' ';
          quote = '`';
          continue;
        }
      }
    }

    if (char === '/' && nextChar === '/') {
      isLineComment = true;
      stripped += '  ';
      index++;
      continue;
    }

    if (char === '/' && nextChar === '*') {
      isBlockComment = true;
      stripped += '  ';
      index++;
      continue;
    }
    if (isRegexLiteralStart(source, index)) {
      const endIndex = findRegexLiteralEnd(source, index);
      stripped += ' '.repeat(endIndex - index + 1);
      index = endIndex;
      continue;
    }

    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      stripped += char;
      continue;
    }

    stripped += char;
  }

  return cacheResult(codeOnlyCache, source, stripped);
}

function findMatchingBrace(source: string, openIndex: number): number {
  let depth = 0;
  let quote = '';
  let isEscaped = false;

  for (let index = openIndex; index < source.length; index++) {
    const char = source[index];
    const nextChar = source[index + 1];
    if (quote) {
      if (isEscaped) {
        isEscaped = false;
      } else if (char === '\\') {
        isEscaped = true;
      } else if (char === quote) {
        quote = '';
      }
      continue;
    }
    if (char === '/' && nextChar === '/') {
      const newlineIndex = source.indexOf('\n', index + 2);
      index = newlineIndex === -1 ? source.length : newlineIndex;
      continue;
    }
    if (char === '/' && nextChar === '*') {
      const commentEnd = source.indexOf('*/', index + 2);
      index = commentEnd === -1 ? source.length : commentEnd + 1;
      continue;
    }
    if (isRegexLiteralStart(source, index)) {
      index = findRegexLiteralEnd(source, index);
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      continue;
    }
    if (char === '{') {
      depth++;
    } else if (char === '}') {
      depth--;
      if (depth === 0) {
        return index;
      }
    }
  }

  return -1;
}

export {
  findBalancedCallEnd,
  findMatchingBrace,
  findRegexLiteralEnd,
  isRegexLiteralStart,
  stripComments,
  stripCommentsAndStrings,
};
