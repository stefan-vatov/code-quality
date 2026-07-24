/* -------------------------------------------------------------------------- */
/*      Source fallback for Promise references inside Effect.sync calls.      */
/* -------------------------------------------------------------------------- */

import {
  BINDING_FETCH,
  BINDING_GLOBAL_THIS,
  BINDING_PROMISE,
  isLocallyBound,
  matchingParenthesisEnd,
  skipWhitespace,
  sourceScopeIndex,
} from './effect-sync-promise-scope-index';
import { canonicalizeEffectAPIAliases, effectFunctionAliases } from './effect-rule-aliases';
import { effectCallPattern } from './effect-default-scan-helpers';
import { stripCommentsAndStrings } from './effect-source-helpers';

const ASYNC_CALLBACK_PATTERN = /^\s*async\b/;
const SINGLE_RETURNED_ARROW_PATTERN = /^(?:[A-Za-z_$][\w$]*|\{[^}]*\}|\[[^\]]*\])\s*(?::[^=]+)?=>/;
const PROMISE_CALL_PATTERN =
  /(?:^|[^\w$.])(Promise)\.(?:all|allSettled|any|race|reject|resolve)\s*(?:<[^;()]*>)?\s*\(/g;
const NEW_PROMISE_PATTERN = /(?:^|[^\w$.])new\s+(Promise)\s*(?:<[^;()]*>)?\s*\(/g;
const FETCH_CALL_PATTERN = /(?:^|[^\w$.])(fetch)\s*(?:<[^;()]*>)?\s*\(/g;
const GLOBAL_THIS_FETCH_PATTERN = /(?:^|[^\w$.])(globalThis)\s*\.\s*fetch\s*(?:<[^;()]*>)?\s*\(/g;

interface SourceRange {
  end: number;
  start: number;
}

const escapedIdentifier = (name: string): string =>
  name.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);

const expressionStartAt = (code: string, start: number): number => {
  const expressionStart = skipWhitespace(code, start);
  if (code.startsWith('async', expressionStart)) {
    return skipWhitespace(code, expressionStart + 'async'.length);
  }
  return expressionStart;
};

const isWrappedFunction = (code: string, open: number, close: number): boolean => {
  const wrappedStart = skipWhitespace(code, open + 1);
  if (code.startsWith('function', wrappedStart)) {
    return true;
  }
  const arrowIndex = code.indexOf('=>', wrappedStart);
  return arrowIndex !== -1 && arrowIndex < close;
};

const isParenthesizedReturnedFunction = (code: string, expressionStart: number): boolean => {
  const close = matchingParenthesisEnd(code, expressionStart);
  const afterClose = skipWhitespace(code, close + 1);
  if (code.startsWith('=>', afterClose)) {
    return true;
  }
  return isWrappedFunction(code, expressionStart, close) && code[afterClose] !== '(';
};

const isReturnedFunction = (code: string, start: number, end: number): boolean => {
  const expressionStart = expressionStartAt(code, start);
  if (code.startsWith('function', expressionStart)) {
    return true;
  }
  if (code[expressionStart] === '(') {
    return isParenthesizedReturnedFunction(code, expressionStart);
  }
  return SINGLE_RETURNED_ARROW_PATTERN.test(code.slice(expressionStart, end));
};

const directCallbackRange = (
  code: string,
  bodyStart: number,
  bodyEnd: number,
): SourceRange | undefined => {
  const body = code.slice(bodyStart, bodyEnd);
  if (ASYNC_CALLBACK_PATTERN.test(body)) {
    return { end: bodyEnd, start: bodyStart };
  }
  const arrowIndex = body.indexOf('=>');
  let directStart = bodyStart;
  if (arrowIndex !== -1) {
    directStart = bodyStart + arrowIndex + 2;
  }
  if (isReturnedFunction(code, directStart, bodyEnd)) {
    return undefined;
  }
  return { end: bodyEnd, start: directStart };
};

const hasGlobalMatch = (
  code: string,
  range: SourceRange,
  pattern: RegExp,
  bindingMask: number,
): boolean => {
  const segment = code.slice(range.start, range.end);
  const scopeIndex = sourceScopeIndex(code);
  for (const match of segment.matchAll(pattern)) {
    const identifierOffset = match[0].indexOf(match[1] ?? '');
    if (!isLocallyBound(scopeIndex, range.start + match.index + identifierOffset, bindingMask)) {
      return true;
    }
  }
  return false;
};

const hasDirectPromiseCall = (code: string, bodyStart: number, bodyEnd: number): boolean => {
  const body = code.slice(bodyStart, bodyEnd);
  if (ASYNC_CALLBACK_PATTERN.test(body)) {
    return true;
  }
  const range = directCallbackRange(code, bodyStart, bodyEnd);
  return (
    range !== undefined &&
    (hasGlobalMatch(code, range, PROMISE_CALL_PATTERN, BINDING_PROMISE) ||
      hasGlobalMatch(code, range, NEW_PROMISE_PATTERN, BINDING_PROMISE) ||
      hasGlobalMatch(code, range, FETCH_CALL_PATTERN, BINDING_FETCH) ||
      hasGlobalMatch(code, range, GLOBAL_THIS_FETCH_PATTERN, BINDING_GLOBAL_THIS))
  );
};

const syncCallPatterns = (source: string): RegExp[] => {
  const patterns = [effectCallPattern(source, 'sync')];
  for (const name of effectFunctionAliases(source, 'Effect', 'sync')) {
    patterns.push(new RegExp(`\\b${escapedIdentifier(name)}\\s*\\(`, 'g'));
  }
  return patterns;
};

/**
 * Detect global Promise-producing calls directly inside Effect.sync callbacks.
 *
 * @param source - Complete source text for a source-backed compatibility check.
 * @returns Whether an Effect.sync callback directly performs asynchronous work.
 * @throws Does not throw.
 * @internal
 */
export const hasSyncForPromiseSource = (source: string): boolean => {
  const canonicalSource = canonicalizeEffectAPIAliases(source);
  const code = stripCommentsAndStrings(canonicalSource);
  for (const callPattern of syncCallPatterns(canonicalSource)) {
    for (const match of code.matchAll(callPattern)) {
      const open = canonicalSource.indexOf('(', match.index);
      const close = matchingParenthesisEnd(code, open);
      if (hasDirectPromiseCall(code, open + 1, close)) {
        return true;
      }
    }
  }
  return false;
};
