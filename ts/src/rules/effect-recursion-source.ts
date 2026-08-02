/* -------------------------------------------------------------------------- */
/*      Source fallback for execution-aware Effect recursion detection.       */
/* -------------------------------------------------------------------------- */

import type { DeferredCallRange, SourceRange } from './effect-recursion-source-deferred';
import { canonicalizeEffectAPIAliases, effectImportAliases } from './effect-rule-aliases';
import type { SourceNavigationIndex } from './effect-source-navigation-index';
import { copyGenericArrowHeader } from './effect-recursion-source-copy';
import { deferredCallRanges } from './effect-recursion-source-deferred';
import { sourceNavigationIndex } from './effect-source-navigation-index';
import { stripCommentsAndStrings } from './effect-source-helpers';

const [ARROW_INDEX, PARENTHESIS_INDEX] = [/=>/g, /\(/g];
const FUNCTION_PATTERN =
  /\b(async\s+)?function\s*(\*)?\s*([A-Za-z_$][\w$]*)\s*(?:<[^>{;]*>)?\s*\(/g;
const ARROW_DECLARATION_PATTERN = /\bconst\s+([A-Za-z_$][\w$]*)\s*=/g;
const GENERIC_ARROW_DECLARATION_PATTERN = /\bconst\s+[A-Za-z_$][\w$]*\s*=\s*</g;
const EFFECT_CALL_PATTERN = /\bEffect\.[A-Za-z_$][\w$]*\s*\(/g;
const CALL_PATTERN = /\b([A-Za-z_$][\w$]*)\s*\(/g;
const DECLARATION_PATTERN = /\b(?:class|const|function|let)\s+([A-Za-z_$][\w$]*)\b/g;
const PARAMETER_BINDING_PATTERN = /(?:^|[({,])\s*([A-Za-z_$][\w$]*)\s*(?=[:,)}=])/g;

interface RecursiveSourceIndex {
  arrowRanges: readonly ArrowRange[];
  arrowBindings: ReadonlyMap<number, ReadonlySet<string>>;
  arrowIndexes: readonly number[];
  callsByName: ReadonlyMap<string, readonly number[]>;
  code: string;
  declarationsByName: ReadonlyMap<string, readonly number[]>;
  deferredRanges: readonly DeferredCallRange[];
  effectCallIndexes: readonly number[];
  navigation: SourceNavigationIndex;
  parenthesisIndexes: readonly number[];
}

interface ArrowRange extends SourceRange {
  readonly arrowIndex: number;
  readonly bindings: ReadonlySet<string>;
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

const matchIndexes = (source: string, pattern: RegExp): number[] =>
  [...source.matchAll(pattern)].map((match) => match.index);

const lastIndexBefore = (indexes: readonly number[], target: number): number => {
  let low = 0;
  let high = indexes.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if ((indexes[middle] ?? Number.POSITIVE_INFINITY) < target) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return low - 1;
};

const endsWithFunctionKeyword = (source: string, target: number): boolean => {
  let end = target;
  while (end > 0 && /\s/.test(source[end - 1] ?? '')) {
    end -= 1;
  }
  const start = end - 'function'.length;
  return (
    start >= 0 &&
    source.slice(start, end) === 'function' &&
    (start === 0 || !/\w/.test(source[start - 1] ?? ''))
  );
};

const skipWhitespaceUntil = (source: string, start: number, end: number): number => {
  let index = start;
  while (index < end && /\s/.test(source[index] ?? '')) {
    index += 1;
  }
  return index;
};

const immediateSuffixStart = (source: string, start: number, end: number): number => {
  let index = skipWhitespaceUntil(source, start, end);
  while (index < end && (source[index] === ')' || source[index] === '}')) {
    index += 1;
  }
  return skipWhitespaceUntil(source, index, end);
};

const immediateMethodEnd = (source: string, start: number, end: number): number => {
  const index = skipWhitespaceUntil(source, start, end);
  if (index + 'apply'.length <= end && source.startsWith('apply', index)) {
    return index + 'apply'.length;
  }
  if (index + 'call'.length <= end && source.startsWith('call', index)) {
    return index + 'call'.length;
  }
  return -1;
};

// oxlint-disable-next-line max-statements, no-ternary -- checks both immediate call suffix forms in one offset pass.
const hasImmediateInvocationSuffix = (
  sourceIndex: RecursiveSourceIndex,
  target: number,
  rangeEnd: number,
): boolean => {
  const { code } = sourceIndex;
  const end = Math.min(rangeEnd, code.length);
  const openParen = code.indexOf('(', target);
  let callEnd = target;
  if (openParen !== -1) {
    callEnd = sourceIndex.navigation.matchingCall(openParen);
  }
  const index = immediateSuffixStart(code, callEnd + 1, end);
  if (code[index] === '(') {
    const closeIndex = skipWhitespaceUntil(code, index + 1, end);
    return closeIndex < end && code[closeIndex] === ')';
  }
  if (code[index] !== '.') {
    return false;
  }
  const methodEnd = immediateMethodEnd(code, index + 1, end);
  const openIndex = skipWhitespaceUntil(code, methodEnd, end);
  return methodEnd !== -1 && openIndex < end && code[openIndex] === '(';
};

const lastRangeBefore = (ranges: readonly SourceRange[], target: number): number => {
  let low = 0;
  let high = ranges.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if ((ranges[middle]?.start ?? Number.POSITIVE_INFINITY) <= target) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return low - 1;
};

// oxlint-disable-next-line complexity, max-statements -- walks the pre-indexed callback parent chain.
const isDeferredEffectCallback = (sourceIndex: RecursiveSourceIndex, target: number): boolean => {
  const { deferredRanges: ranges } = sourceIndex;
  let rangeIndex = lastRangeBefore(ranges, target);
  while (rangeIndex >= 0) {
    const call = ranges[rangeIndex];
    if (call && target <= call.end) {
      const callbackIndex = lastRangeBefore(call.callbackRanges, target);
      const callback = call.callbackRanges[callbackIndex];
      if (
        callback &&
        target < callback.end &&
        !hasImmediateInvocationSuffix(sourceIndex, target, callback.end)
      ) {
        return true;
      }
    }
    rangeIndex = call?.parent ?? -1;
  }
  return false;
};

const appendNamedIndex = (
  indexesByName: Map<string, number[]>,
  name: string | undefined,
  index: number,
): void => {
  if (!name) {
    return;
  }
  const indexes = indexesByName.get(name);
  if (indexes) {
    indexes.push(index);
  } else {
    indexesByName.set(name, [index]);
  }
};

// oxlint-disable-next-line max-statements -- collects parameter names once per arrow header.
const parameterBindings = (source: string, start: number, end: number): ReadonlySet<string> => {
  const bindings = new Set<string>();
  PARAMETER_BINDING_PATTERN.lastIndex = 0;
  const header = source.slice(start, end);
  let match = PARAMETER_BINDING_PATTERN.exec(header);
  while (match !== null) {
    const [, name] = match;
    if (name) {
      bindings.add(name);
    }
    match = PARAMETER_BINDING_PATTERN.exec(header);
  }
  return bindings;
};

// oxlint-disable-next-line max-statements -- resolves one indexed arrow range without recursive descent.
const arrowRangeFor = (
  code: string,
  navigation: SourceNavigationIndex,
  arrowIndex: number,
  parenthesisIndexes: readonly number[],
): ArrowRange | undefined => {
  const parameterPosition = lastIndexBefore(parenthesisIndexes, arrowIndex);
  const parameterStart = parenthesisIndexes[parameterPosition];
  if (parameterStart === undefined) {
    return undefined;
  }
  const bindings = parameterBindings(code, parameterStart, arrowIndex);
  if (bindings.size === 0) {
    return undefined;
  }
  const bodyStart = firstCodeIndex(code, arrowIndex + 2);
  let bodyEnd = navigation.statementEnd(bodyStart);
  if (code[bodyStart] === '{') {
    bodyEnd = navigation.matchingBrace(bodyStart);
  }
  let end = bodyEnd;
  if (bodyEnd === -1) {
    end = code.length;
  }
  return { arrowIndex, bindings, end, start: bodyStart };
};

const arrowRangesFor = (
  code: string,
  navigation: SourceNavigationIndex,
  arrowIndexes: readonly number[],
  parenthesisIndexes: readonly number[],
): ArrowRange[] => {
  const ranges: ArrowRange[] = [];
  for (const arrowIndex of arrowIndexes) {
    const range = arrowRangeFor(code, navigation, arrowIndex, parenthesisIndexes);
    if (range) {
      ranges.push(range);
    }
  }
  return ranges;
};

// oxlint-disable-next-line complexity, max-statements -- tracks four delimiter depths in one pass.
const genericArrowEnd = (source: string, start: number): number => {
  let angleDepth = 0;
  let braceDepth = 0;
  let bracketDepth = 0;
  let parenthesisDepth = 0;
  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    if (character === '<') {
      angleDepth += 1;
    } else if (character === '>' && angleDepth > 0) {
      angleDepth -= 1;
    } else if (character === '(') {
      parenthesisDepth += 1;
    } else if (character === ')') {
      parenthesisDepth -= 1;
    } else if (character === '[') {
      bracketDepth += 1;
    } else if (character === ']') {
      bracketDepth -= 1;
    } else if (character === '{') {
      braceDepth += 1;
    } else if (character === '}') {
      braceDepth -= 1;
    } else if (
      character === '=' &&
      source[index + 1] === '>' &&
      angleDepth === 0 &&
      braceDepth === 0 &&
      bracketDepth === 0 &&
      parenthesisDepth === 0
    ) {
      return index + 2;
    } else if (
      character === ';' &&
      angleDepth === 0 &&
      braceDepth === 0 &&
      bracketDepth === 0 &&
      parenthesisDepth === 0
    ) {
      return -1;
    }
  }
  return -1;
};

const restoreGenericArrowHeaders = (source: string, code: string): string => {
  // oxlint-disable-next-line unicorn/prefer-spread, typescript/no-misused-spread -- preserve UTF-16 code-unit offsets.
  const output = code.split('');
  GENERIC_ARROW_DECLARATION_PATTERN.lastIndex = 0;
  let match = GENERIC_ARROW_DECLARATION_PATTERN.exec(code);
  while (match !== null) {
    const headerStart = match.index + match[0].length - 1;
    const arrowEnd = genericArrowEnd(source, headerStart);
    if (arrowEnd !== -1) {
      copyGenericArrowHeader(output, source, headerStart, arrowEnd);
    }
    match = GENERIC_ARROW_DECLARATION_PATTERN.exec(code);
  }
  return output.join('');
};

// oxlint-disable-next-line max-statements -- constructs all shared indexes in one source pass.
const buildRecursiveSourceIndex = (code: string): RecursiveSourceIndex => {
  const navigation = sourceNavigationIndex(code);
  const arrowIndexes = matchIndexes(code, ARROW_INDEX);
  const parenthesisIndexes = matchIndexes(code, PARENTHESIS_INDEX);
  const arrowBindings = new Map<number, ReadonlySet<string>>();
  for (const arrowIndex of arrowIndexes) {
    const parameterPosition = lastIndexBefore(parenthesisIndexes, arrowIndex);
    const parameterStart = parenthesisIndexes[parameterPosition];
    if (parameterStart !== undefined) {
      arrowBindings.set(arrowIndex, parameterBindings(code, parameterStart, arrowIndex));
    }
  }
  const callsByName = new Map<string, number[]>();
  CALL_PATTERN.lastIndex = 0;
  let callMatch = CALL_PATTERN.exec(code);
  while (callMatch !== null) {
    appendNamedIndex(callsByName, callMatch[1], callMatch.index);
    callMatch = CALL_PATTERN.exec(code);
  }
  const declarationsByName = new Map<string, number[]>();
  DECLARATION_PATTERN.lastIndex = 0;
  let declarationMatch = DECLARATION_PATTERN.exec(code);
  while (declarationMatch !== null) {
    appendNamedIndex(declarationsByName, declarationMatch[1], declarationMatch.index);
    declarationMatch = DECLARATION_PATTERN.exec(code);
  }
  return {
    arrowBindings,
    arrowIndexes,
    arrowRanges: arrowRangesFor(code, navigation, arrowIndexes, parenthesisIndexes),
    callsByName,
    code,
    declarationsByName,
    deferredRanges: deferredCallRanges(code, navigation),
    effectCallIndexes: matchIndexes(code, EFFECT_CALL_PATTERN),
    navigation,
    parenthesisIndexes,
  };
};

const hasIndexInRange = (indexes: readonly number[], start: number, end: number): boolean => {
  const position = lastIndexBefore(indexes, start) + 1;
  return (indexes[position] ?? Number.POSITIVE_INFINITY) < end;
};

const hasDeclarationInBlock = (
  sourceIndex: RecursiveSourceIndex,
  name: string,
  callIndex: number,
  blockStart: number,
): boolean => {
  const indexes = sourceIndex.declarationsByName.get(name) ?? [];
  const declarationPosition = lastIndexBefore(indexes, callIndex);
  return (indexes[declarationPosition] ?? -1) >= blockStart;
};

const hasShadowedArrowParameter = (
  sourceIndex: RecursiveSourceIndex,
  name: string,
  callIndex: number,
): boolean => {
  let arrowPosition = lastRangeBefore(sourceIndex.arrowRanges, callIndex);
  while (arrowPosition >= 0) {
    const arrow = sourceIndex.arrowRanges[arrowPosition];
    if (arrow && callIndex < arrow.end && arrow.bindings.has(name)) {
      return true;
    }
    arrowPosition -= 1;
  }
  return false;
};

const isShadowedRecursiveCall = (
  sourceIndex: RecursiveSourceIndex,
  name: string,
  callIndex: number,
  analysisStart: number,
  bodyOpen: number,
): boolean => {
  if (endsWithFunctionKeyword(sourceIndex.code, callIndex)) {
    return true;
  }
  const braceOpen = sourceIndex.navigation.enclosingBraceOpen(callIndex);
  let blockStart = braceOpen + 1;
  if (braceOpen < analysisStart || braceOpen === bodyOpen) {
    blockStart = analysisStart;
  }
  return (
    hasDeclarationInBlock(sourceIndex, name, callIndex, blockStart) ||
    hasShadowedArrowParameter(sourceIndex, name, callIndex)
  );
};

// oxlint-disable-next-line max-statements -- evaluates indexed candidates without rescanning body text.
const hasUnsafeRecursiveRange = (
  sourceIndex: RecursiveSourceIndex,
  name: string,
  analysisStart: number,
  analysisEnd: number,
  bodyOpen: number,
): boolean => {
  if (!hasIndexInRange(sourceIndex.effectCallIndexes, analysisStart, analysisEnd)) {
    return false;
  }
  const callIndexes = sourceIndex.callsByName.get(name) ?? [];
  let callPosition = lastIndexBefore(callIndexes, analysisStart);
  while (++callPosition < callIndexes.length) {
    const callIndex = callIndexes[callPosition];
    if (callIndex === undefined || callIndex >= analysisEnd) {
      break;
    }
    if (
      !isDeferredEffectCallback(sourceIndex, callIndex) &&
      !isShadowedRecursiveCall(sourceIndex, name, callIndex, analysisStart, bodyOpen)
    ) {
      return true;
    }
  }
  return false;
};

// oxlint-disable-next-line max-statements -- resolves one declaration from shared offsets.
const isUnsafeFunctionMatch = (
  sourceIndex: RecursiveSourceIndex,
  match: RegExpExecArray,
): boolean => {
  const [, asyncKeyword, star, name = ''] = match;
  if (asyncKeyword || star) {
    return false;
  }
  const { code, navigation } = sourceIndex;
  const parameterStart = code.indexOf('(', match.index);
  const bodyStart = findTopLevelToken(code, parameterStart, '{');
  if (bodyStart === -1) {
    return false;
  }
  const matchingBodyEnd = navigation.matchingBrace(bodyStart);
  let bodyEnd = matchingBodyEnd;
  if (bodyEnd === -1) {
    bodyEnd = code.length;
  }
  return (
    !headerBindsName(code.slice(parameterStart, bodyStart), name) &&
    hasUnsafeRecursiveRange(sourceIndex, name, parameterStart, bodyEnd, bodyStart)
  );
};

const hasUnsafeRecursiveFunction = (sourceIndex: RecursiveSourceIndex): boolean => {
  const { code } = sourceIndex;
  FUNCTION_PATTERN.lastIndex = 0;
  let match = FUNCTION_PATTERN.exec(code);
  while (match !== null) {
    if (isUnsafeFunctionMatch(sourceIndex, match)) {
      return true;
    }
    match = FUNCTION_PATTERN.exec(code);
  }
  return false;
};

const firstCodeIndex = (source: string, start: number): number => {
  let index = start;
  while (/\s/.test(source[index] ?? '')) {
    index += 1;
  }
  return index;
};

// oxlint-disable-next-line max-statements, no-ternary -- resolves block and expression arrow bodies by offsets.
const isUnsafeArrowMatch = (sourceIndex: RecursiveSourceIndex, match: RegExpExecArray): boolean => {
  const [, name] = match;
  const { code, navigation } = sourceIndex;
  const headerStart = match.index + match[0].length;
  const arrowIndex = findTopLevelToken(code, headerStart, '=>');
  if (arrowIndex === -1) {
    return false;
  }
  const bodyStart = firstCodeIndex(code, arrowIndex + 2);
  const bodyIsBlock = code[bodyStart] === '{';
  let bodyEnd = navigation.statementEnd(bodyStart);
  if (bodyIsBlock) {
    bodyEnd = navigation.matchingBrace(bodyStart);
  }
  if (bodyEnd === -1) {
    bodyEnd = code.length;
  }
  const header = code.slice(headerStart, arrowIndex);
  let bodyOpen = -1;
  if (bodyIsBlock) {
    bodyOpen = bodyStart;
  }
  return (
    !/^\s*async\b/.test(header) &&
    !headerBindsName(header, name) &&
    hasUnsafeRecursiveRange(sourceIndex, name, headerStart, bodyEnd, bodyOpen)
  );
};

const hasUnsafeRecursiveArrow = (sourceIndex: RecursiveSourceIndex): boolean => {
  const { code } = sourceIndex;
  ARROW_DECLARATION_PATTERN.lastIndex = 0;
  let match = ARROW_DECLARATION_PATTERN.exec(code);
  while (match !== null) {
    if (isUnsafeArrowMatch(sourceIndex, match)) {
      return true;
    }
    match = ARROW_DECLARATION_PATTERN.exec(code);
  }
  return false;
};

const sourceIndexFor = (source: string): RecursiveSourceIndex => {
  const stripped = stripCommentsAndStrings(source);
  return buildRecursiveSourceIndex(restoreGenericArrowHeaders(source, stripped));
};

const hasUnsafeRecursiveSource = (source: string): boolean => {
  const sourceIndex = sourceIndexFor(source);
  return hasUnsafeRecursiveFunction(sourceIndex) || hasUnsafeRecursiveArrow(sourceIndex);
};

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
  return hasUnsafeRecursiveSource(canonicalSource);
};
