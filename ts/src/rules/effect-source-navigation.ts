/** @internal Source navigation helpers for Effect lint rule implementations. */
import {
  findBalancedCallEnd,
  findMatchingBrace,
  findREGEXLiteralEnd,
  isREGEXLiteralStart,
} from './effect-source-scan';

const skipLineCommentIndex = (source: string, index: number, fallback: number): number => {
  const newlineIndex = source.indexOf('\n', index + 2);
  if (newlineIndex === -1) {
    return fallback;
  }
  return newlineIndex;
};

const skipBlockCommentIndex = (source: string, index: number, fallback: number): number => {
  const commentEnd = source.indexOf('*/', index + 2);
  if (commentEnd === -1) {
    return fallback;
  }
  return commentEnd + 1;
};

interface QuoteState {
  isEscaped: boolean;
  quote: string;
}

const nextQuoteState = (state: QuoteState, char: string): QuoteState => {
  if (state.isEscaped) {
    return { ...state, isEscaped: false };
  }
  if (char === '\\') {
    return { ...state, isEscaped: true };
  }
  if (char === state.quote) {
    return { isEscaped: false, quote: '' };
  }
  return state;
};

const quoteStart = (char: string): string => {
  if (char === '"' || char === "'" || char === '`') {
    return char;
  }
  return '';
};

const scanNonCodeIndex = (source: string, index: number, fallback: number): number | undefined => {
  const char = source[index];
  const nextChar = source[index + 1];
  if (char === '/' && nextChar === '/') {
    return skipLineCommentIndex(source, index, fallback);
  }
  if (char === '/' && nextChar === '*') {
    return skipBlockCommentIndex(source, index, fallback);
  }
  if (isREGEXLiteralStart(source, index)) {
    return findREGEXLiteralEnd(source, index);
  }
  return undefined;
};

const scanBraceIndex = (
  source: string,
  index: number,
  targetIndex: number,
  stack: number[],
): number => {
  const char = source[index];
  const nonCodeIndex = scanNonCodeIndex(source, index, targetIndex);
  if (nonCodeIndex !== undefined) {
    return nonCodeIndex;
  }
  if (char === '{') {
    stack.push(index);
  } else if (char === '}') {
    stack.pop();
  }
  return index;
};

const nextBraceScanIndex = (
  source: string,
  index: number,
  targetIndex: number,
  stack: number[],
  quoteState: QuoteState,
): { index: number; quoteState: QuoteState } => {
  const char = source[index];
  if (quoteState.quote) {
    return { index, quoteState: nextQuoteState(quoteState, char) };
  }
  const quote = quoteStart(char);
  if (quote) {
    return { index, quoteState: { isEscaped: false, quote } };
  }
  return {
    index: scanBraceIndex(source, index, targetIndex, stack),
    quoteState,
  };
};

const findEnclosingBraceOpen = (source: string, targetIndex: number): number => {
  const stack: number[] = [];
  let quoteState = { isEscaped: false, quote: '' };

  for (let index = 0; index < targetIndex; index++) {
    const next = nextBraceScanIndex(source, index, targetIndex, stack, quoteState);
    ({ index, quoteState } = next);
  }

  return stack.at(-1) ?? -1;
};

/** Internal helper exported for package-local composition.
 *
 * @internal
 */
export const isInsideCall = (source: string, targetIndex: number, callPattern: RegExp): boolean => {
  for (const match of source.matchAll(callPattern)) {
    const openParenIndex = source.indexOf('(', match.index);
    if (
      openParenIndex !== -1 &&
      openParenIndex <= targetIndex &&
      targetIndex <= findBalancedCallEnd(source, openParenIndex)
    ) {
      return true;
    }
  }

  return false;
};

/** Internal helper exported for package-local composition.
 *
 * @internal
 */
export const statementAfter = (source: string, targetIndex: number, maxLength = 320): string => {
  const end = source.indexOf(';', targetIndex);
  if (end === -1) {
    return source.slice(targetIndex, targetIndex + maxLength);
  }
  return source.slice(targetIndex, end + 1);
};

interface StatementDepth {
  brace: number;
  bracket: number;
  paren: number;
}

const isStatementDepthZero = (depth: StatementDepth): boolean =>
  depth.brace === 0 && depth.bracket === 0 && depth.paren === 0;

const updateParenDepth = (depth: StatementDepth, char: string): StatementDepth | undefined => {
  if (char === '(') {
    return { ...depth, paren: depth.paren + 1 };
  }
  if (char === ')') {
    return { ...depth, paren: depth.paren - 1 };
  }
  return undefined;
};

const updateBraceDepth = (depth: StatementDepth, char: string): StatementDepth | undefined => {
  if (char === '{') {
    return { ...depth, brace: depth.brace + 1 };
  }
  if (char === '}') {
    return { ...depth, brace: depth.brace - 1 };
  }
  return undefined;
};

const updateBracketDepth = (depth: StatementDepth, char: string): StatementDepth | undefined => {
  if (char === '[') {
    return { ...depth, bracket: depth.bracket + 1 };
  }
  if (char === ']') {
    return { ...depth, bracket: depth.bracket - 1 };
  }
  return undefined;
};

const updateStatementDepth = (depth: StatementDepth, char: string): StatementDepth =>
  updateParenDepth(depth, char) ??
  updateBraceDepth(depth, char) ??
  updateBracketDepth(depth, char) ??
  depth;

const skipStatementNonCode = (source: string, index: number): number | undefined =>
  scanNonCodeIndex(source, index, source.length);

const quoteOrStatementNonCodeScan = (
  source: string,
  index: number,
  quoteState: QuoteState,
): { index: number; quoteState: QuoteState } | undefined => {
  const char = source[index];
  if (quoteState.quote) {
    return { index, quoteState: nextQuoteState(quoteState, char) };
  }
  const quote = quoteStart(char);
  if (quote) {
    return { index, quoteState: { isEscaped: false, quote } };
  }
  const nonCodeIndex = skipStatementNonCode(source, index);
  if (nonCodeIndex !== undefined) {
    return { index: nonCodeIndex, quoteState };
  }
  return undefined;
};

const nextStatementScan = (
  source: string,
  index: number,
  depth: StatementDepth,
  quoteState: QuoteState,
): { depth: StatementDepth; index: number; isEnd: boolean; quoteState: QuoteState } => {
  const char = source[index];
  if (char === ';' && isStatementDepthZero(depth)) {
    return { depth, index, isEnd: true, quoteState };
  }
  const quoteOrNonCode = quoteOrStatementNonCodeScan(source, index, quoteState);
  if (quoteOrNonCode) {
    return { ...quoteOrNonCode, depth, isEnd: false };
  }
  return { depth: updateStatementDepth(depth, char), index, isEnd: false, quoteState };
};

/** Internal helper exported for package-local composition.
 *
 * @internal
 */
export const findStatementEnd = (source: string, startIndex: number): number => {
  let depth = { brace: 0, bracket: 0, paren: 0 };
  let quoteState = { isEscaped: false, quote: '' };

  for (let index = startIndex; index < source.length; index++) {
    const next = nextStatementScan(source, index, depth, quoteState);
    if (next.isEnd) {
      return index;
    }
    ({ depth, index, quoteState } = next);
  }

  return source.length - 1;
};

const enclosingEffectCallTail = (source: string, targetIndex: number): string | undefined => {
  for (const match of source.matchAll(/\bEffect\.(?:gen|fn)\s*\(/g)) {
    const openParenIndex = source.indexOf('(', match.index);
    const endIndex = ((): number => {
      if (openParenIndex === -1 || openParenIndex > targetIndex) {
        return -1;
      }
      return findBalancedCallEnd(source, openParenIndex);
    })();
    if (endIndex !== -1 && targetIndex <= endIndex) {
      return source.slice(targetIndex, endIndex + 1);
    }
  }

  return undefined;
};

const enclosingBraceTail = (source: string, targetIndex: number): string | undefined => {
  const openBrace = findEnclosingBraceOpen(source, targetIndex);
  if (openBrace === -1) {
    return undefined;
  }
  const closeBrace = findMatchingBrace(source, openBrace);
  if (closeBrace === -1) {
    return undefined;
  }
  return source.slice(targetIndex, closeBrace + 1);
};

const tailUntilNextFunction = (source: string, targetIndex: number): string => {
  const tail = source.slice(targetIndex);
  const nextFunction = tail
    .slice(1)
    .search(
      /\n\s*(?:export\s+)?(?:(?:async\s+)?function\b|const\s+[A-Za-z_$][\w$]*\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)?\s*=>)/,
    );
  if (nextFunction === -1) {
    return tail;
  }
  return tail.slice(0, nextFunction + 1);
};

/** Internal helper exported for package-local composition.
 *
 * @internal
 */
export const sameFunctionTail = (source: string, targetIndex: number): string => {
  const effectTail = enclosingEffectCallTail(source, targetIndex);
  if (effectTail) {
    return effectTail;
  }

  const braceTail = enclosingBraceTail(source, targetIndex);
  if (braceTail) {
    return braceTail;
  }
  return tailUntilNextFunction(source, targetIndex);
};
