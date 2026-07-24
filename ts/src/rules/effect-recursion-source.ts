/* -------------------------------------------------------------------------- */
/*      Source fallback for execution-aware Effect recursion detection.       */
/* -------------------------------------------------------------------------- */

import { Array, pipe } from 'effect';
import { canonicalizeEffectAPIAliases, effectImportAliases } from './effect-rule-aliases';
import {
  findBalancedCallEnd,
  findMatchingBrace,
  findStatementEnd,
  stripCommentsAndStrings,
} from './effect-source-helpers';

const DEFERRED_EFFECT_CALLBACK = /\bEffect\.(?:flatMap|gen|map|succeed|suspend)\s*\(/g;

interface SourceRange {
  end: number;
  start: number;
}

const escapedIdentifier = (name: string): string =>
  name.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);

const headerBindsName = (header: string, name: string): boolean =>
  new RegExp(`(?:^|[({,])\\s*${escapedIdentifier(name)}\\s*(?=[:,)}=])`).test(header);

const findTopLevelToken = (source: string, start: number, token: string): number => {
  let depth = 0;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (char === '(' || char === '[') {
      depth += 1;
    } else if (char === ')' || char === ']') {
      depth -= 1;
    } else if (depth === 0 && source.startsWith(token, index)) {
      return index;
    } else if (depth === 0 && char === ';') {
      return -1;
    }
  }
  return -1;
};

const enclosingBlockStart = (source: string): number => {
  const stack: number[] = [];
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === '{') {
      stack.push(index);
    } else if (source[index] === '}') {
      stack.pop();
    }
  }
  return (stack.at(-1) ?? -1) + 1;
};

const isShadowedRecursiveCall = (name: string, body: string, callIndex: number): boolean => {
  const escapedName = escapedIdentifier(name);
  const prior = body.slice(0, callIndex);
  if (/\bfunction\s*$/.test(prior)) {
    return true;
  }
  const blockStart = enclosingBlockStart(prior);
  if (
    new RegExp(`\\b(?:class|const|function|let)\\s+${escapedName}\\b`).test(prior.slice(blockStart))
  ) {
    return true;
  }
  const arrowIndex = prior.lastIndexOf('=>');
  const parameterStart = prior.lastIndexOf('(', arrowIndex);
  return (
    arrowIndex !== -1 &&
    parameterStart !== -1 &&
    headerBindsName(prior.slice(parameterStart, arrowIndex), name)
  );
};

const updateDepth = (char: string, depth: number): number => {
  if (char === '(' || char === '[' || char === '{') {
    return depth + 1;
  }
  if (char === ')' || char === ']' || char === '}') {
    return depth - 1;
  }
  return depth;
};

const rangeIfContains = (start: number, end: number, target: number): SourceRange | undefined => {
  if (start <= target && target < end) {
    return { end, start };
  }
  return undefined;
};

const callArgumentAt = (
  source: string,
  openParen: number,
  callEnd: number,
  target: number,
): SourceRange | undefined => {
  let argumentStart = openParen + 1;
  let depth = 0;
  for (let index = argumentStart; index < callEnd; index += 1) {
    if (source[index] === ',' && depth === 0) {
      const targetRange = rangeIfContains(argumentStart, index, target);
      if (targetRange) {
        return targetRange;
      }
      argumentStart = index + 1;
    }
    depth = updateDepth(source[index] ?? '', depth);
  }
  return rangeIfContains(argumentStart, callEnd + 1, target);
};

const selfCallEnd = (source: string, target: number): number => {
  const openParen = source.indexOf('(', target);
  if (openParen === -1) {
    return target;
  }
  return findBalancedCallEnd(source, openParen);
};

const hasImmediateInvocationSuffix = (source: string, target: number): boolean => {
  const suffix = source.slice(selfCallEnd(source, target) + 1);
  return /^\s*[)}]*\s*(?:\.\s*(?:apply|call)\s*\(|\(\s*\))/.test(suffix);
};

const isBareFunctionArgument = (source: string, range: SourceRange, target: number): boolean => {
  const argument = source.slice(range.start, range.end);
  const relativeTarget = target - range.start;
  const arrowIndex = argument.lastIndexOf('=>', relativeTarget);
  const functionIndex = argument.lastIndexOf('function', relativeTarget);
  if (arrowIndex === -1 && functionIndex === -1) {
    return false;
  }
  return !hasImmediateInvocationSuffix(source.slice(0, range.end), target);
};

const isDeferredEffectCallback = (source: string, target: number): boolean =>
  pipe(
    Array.fromIterable(source.matchAll(DEFERRED_EFFECT_CALLBACK)),
    Array.some((match): boolean => {
      const openParen = source.indexOf('(', match.index);
      if (openParen === -1) {
        return false;
      }
      const callEnd = findBalancedCallEnd(source, openParen);
      if (target < openParen || target > callEnd) {
        return false;
      }
      const range = callArgumentAt(source, openParen, callEnd, target);
      return range !== undefined && isBareFunctionArgument(source, range, target);
    }),
  );

const hasUnsafeRecursiveBody = (name: string, body: string): boolean => {
  if (!/\bEffect\.[A-Za-z_$][\w$]*\s*\(/.test(body)) {
    return false;
  }
  return pipe(
    Array.fromIterable(body.matchAll(new RegExp(`\\b${escapedIdentifier(name)}\\s*\\(`, 'g'))),
    Array.some(
      (match): boolean =>
        !isDeferredEffectCallback(body, match.index) &&
        !isShadowedRecursiveCall(name, body, match.index),
    ),
  );
};

const recursiveBody = (source: string, bodyStart: number): string => {
  if (source[bodyStart] === '{') {
    return source.slice(bodyStart + 1, findMatchingBrace(source, bodyStart));
  }
  return source.slice(bodyStart, findStatementEnd(source, bodyStart));
};

const hasUnsafeRecursiveFunction = (source: string): boolean =>
  pipe(
    Array.fromIterable(
      source.matchAll(/\b(async\s+)?function\s*(\*)?\s*([A-Za-z_$][\w$]*)\s*(?:<[^>{;]*>)?\s*\(/g),
    ),
    Array.some((match): boolean => {
      const [, asyncKeyword, star, name] = match;
      const parameterStart = source.indexOf('(', match.index);
      const bodyStart = findTopLevelToken(source, parameterStart, '{');
      if (asyncKeyword || star || bodyStart === -1) {
        return false;
      }
      const header = source.slice(parameterStart, bodyStart);
      const body = recursiveBody(source, bodyStart);
      return !headerBindsName(header, name) && hasUnsafeRecursiveBody(name, header + body);
    }),
  );

const firstCodeIndex = (source: string, start: number): number => {
  let index = start;
  while (/\s/.test(source[index] ?? '')) {
    index += 1;
  }
  return index;
};

const hasUnsafeArrowMatch = (source: string, match: RegExpExecArray): boolean => {
  const [, name] = match;
  const headerStart = match.index + match[0].length;
  const arrowIndex = findTopLevelToken(source, headerStart, '=>');
  if (arrowIndex === -1) {
    return false;
  }
  const header = source.slice(headerStart, arrowIndex);
  const bodyStart = firstCodeIndex(source, arrowIndex + 2);
  const body = recursiveBody(source, bodyStart);
  return (
    !/^\s*async\b/.test(header) &&
    !headerBindsName(header, name) &&
    hasUnsafeRecursiveBody(name, header + body)
  );
};

const hasUnsafeRecursiveArrow = (source: string): boolean =>
  pipe(
    Array.fromIterable(source.matchAll(/\bconst\s+([A-Za-z_$][\w$]*)\s*=/g)),
    Array.some((match): boolean => hasUnsafeArrowMatch(source, match)),
  );

/**
 * Detect eager recursive Effect construction when an AST is unavailable.
 *
 * @param source - Complete TypeScript source text.
 * @returns Whether a supported function declaration or const arrow eagerly recurses.
 * @throws Does not throw.
 * @internal
 */
export const hasRecursiveEffectSource = (source: string): boolean => {
  const canonicalSource = canonicalizeEffectAPIAliases(source);
  if (!effectImportAliases(canonicalSource).includes('Effect')) {
    return false;
  }
  const code = stripCommentsAndStrings(canonicalSource);
  return hasUnsafeRecursiveFunction(code) || hasUnsafeRecursiveArrow(code);
};
