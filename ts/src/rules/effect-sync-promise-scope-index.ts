/* -------------------------------------------------------------------------- */
/*         Lexical source index for the Effect.sync Promise fallback.         */
/* -------------------------------------------------------------------------- */

import {
  SOURCE_SCOPE_CACHE_MAX_WEIGHT,
  sourceScopeIndexCacheWeight,
} from './effect-source-cache-weights';
import type { SourceWeightedCache } from './effect-source-cache-weights';
import { createWeightedCache } from './source-cache';
import { findMatchingBrace } from './effect-source-helpers';

/**
 * Bit mask for a local fetch value binding.
 *
 * @internal
 */
export const BINDING_FETCH = 1;
/**
 * Bit mask for a local Promise value binding.
 *
 * @internal
 */
export const BINDING_PROMISE = 2;
/**
 * Bit mask for a local globalThis value binding.
 *
 * @internal
 */
export const BINDING_GLOBAL_THIS = 4;

const NO_BINDING = 0;
const SOURCE_SCOPE_CACHE_MAX_ENTRIES = 128;
const DECLARATION_PATTERN = /\b(?:class|const|function|let|var)\s+(Promise|fetch|globalThis)\b/g;
const IMPORT_PATTERN = /\bimport\s+(?!type\b)([^;]*?)\s+from\s*["']/g;
const ARROW_PATTERN = /=>/g;
const FUNCTION_PATTERN = /\bfunction(?:\s+[A-Za-z_$][\w$]*)?\s*(?:<[^>{;]*>)?\s*\(/g;
const CATCH_PATTERN = /\bcatch\s*\(/g;
const BINDING_BITS = [BINDING_FETCH, BINDING_PROMISE, BINDING_GLOBAL_THIS] as const;

interface SourceScope {
  bindingMask: number;
  end: number;
  parent: number;
  start: number;
}

interface ParameterScope {
  bindingMask: number;
  end: number;
  start: number;
}

interface Parentheses {
  close: number;
  open: number;
}

/** Binding and parameter scopes indexed for one stripped source file. @internal */
export interface SourceScopeIndex {
  parameterScopes: readonly ParameterScope[];
  scopes: readonly SourceScope[];
}

interface ScopeScan {
  parentheses: Parentheses[];
  parenthesesByOpen: ReadonlyMap<number, number>;
  scopes: SourceScope[];
}

interface DelimiterScan {
  parentheses: Parentheses[];
  parenthesesByOpen: Map<number, number>;
  parenthesisStack: number[];
  scopes: SourceScope[];
  scopeStack: number[];
  sourceLength: number;
}

interface NestingDepth {
  brace: number;
  bracket: number;
  parenthesis: number;
}

const sourceScopeCache: SourceWeightedCache<SourceScopeIndex> = createWeightedCache({
  maxEntries: SOURCE_SCOPE_CACHE_MAX_ENTRIES,
  maxWeight: SOURCE_SCOPE_CACHE_MAX_WEIGHT,
});
const parameterRangeCache = new WeakMap<
  readonly ParameterScope[],
  ReadonlyMap<number, readonly SourceScope[]>
>();

const bindingMaskFor = (name: string): number => {
  if (name === 'Promise') {
    return BINDING_PROMISE;
  }
  if (name === 'fetch') {
    return BINDING_FETCH;
  }
  return BINDING_GLOBAL_THIS;
};

/** Skip source whitespace without allocating a substring. @internal */
export const skipWhitespace = (source: string, start: number): number => {
  let index = start;
  while (index < source.length && /\s/.test(source[index] ?? '')) {
    index += 1;
  }
  return index;
};

/** Find the close for one parenthesized source segment. @internal */
export const matchingParenthesisEnd = (code: string, open: number): number => {
  let depth = 1;
  for (let index = open + 1; index < code.length; index += 1) {
    const character = code[index];
    if (character === '(') {
      depth += 1;
    } else if (character === ')') {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }
  return code.length;
};

const openScope = (
  scopes: SourceScope[],
  scopeStack: number[],
  sourceLength: number,
  index: number,
): void => {
  const parent = scopeStack[scopeStack.length - 1] ?? 0;
  scopes.push({ bindingMask: NO_BINDING, end: sourceLength, parent, start: index + 1 });
  scopeStack.push(scopes.length - 1);
};

const closeScope = (scopes: SourceScope[], scopeStack: number[], index: number): void => {
  const scopeIndex = scopeStack.pop();
  if (scopeIndex === undefined || scopeIndex === 0) {
    return;
  }
  const scope = scopes[scopeIndex];
  if (scope) {
    scope.end = index;
  }
};

const closeParenthesis = (
  parentheses: Parentheses[],
  parenthesesByOpen: Map<number, number>,
  parenthesisStack: number[],
  index: number,
): void => {
  const open = parenthesisStack.pop();
  if (open !== undefined) {
    parentheses.push({ close: index, open });
    parenthesesByOpen.set(open, index);
  }
};

const scanDelimiter = (character: string | undefined, index: number, scan: DelimiterScan): void => {
  const { parentheses, parenthesesByOpen, parenthesisStack, scopes, scopeStack, sourceLength } =
    scan;
  if (character === '{') {
    openScope(scopes, scopeStack, sourceLength, index);
  } else if (character === '}') {
    closeScope(scopes, scopeStack, index);
  } else if (character === '(') {
    parenthesisStack.push(index);
  } else if (character === ')') {
    closeParenthesis(parentheses, parenthesesByOpen, parenthesisStack, index);
  }
};

const scanSourceScopes = (code: string): ScopeScan => {
  const scopes: SourceScope[] = [
    { bindingMask: NO_BINDING, end: code.length, parent: -1, start: 0 },
  ];
  const scopeStack = [0];
  const parenthesisStack: number[] = [];
  const parentheses: Parentheses[] = [];
  const parenthesesByOpen = new Map<number, number>();
  const scan = {
    parentheses,
    parenthesesByOpen,
    parenthesisStack,
    scopeStack,
    scopes,
    sourceLength: code.length,
  };
  for (let index = 0; index < code.length; index += 1) {
    scanDelimiter(code[index], index, scan);
  }
  return { parentheses, parenthesesByOpen, scopes };
};

const lastScopeBefore = (scopes: readonly SourceScope[], index: number): number => {
  let low = 0;
  let high = scopes.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if ((scopes[middle]?.start ?? Number.POSITIVE_INFINITY) <= index) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return Math.max(0, low - 1);
};

const scopeAt = (scopes: readonly SourceScope[], index: number): number => {
  let scopeIndex = lastScopeBefore(scopes, index);
  while (scopeIndex > 0) {
    const scope = scopes[scopeIndex];
    if (scope && index < scope.end) {
      return scopeIndex;
    }
    scopeIndex = scope?.parent ?? 0;
  }
  return 0;
};

const importBindingMask = (clause: string): number => {
  const valueClause = clause.replace(/\btype\s+[A-Za-z_$][\w$]*(?:\s+as\s+[A-Za-z_$][\w$]*)?/g, '');
  let bindingMask = NO_BINDING;
  if (
    /(?:^|[{,])\s*Promise\s*(?:[,}]|$)/.test(valueClause) ||
    /\*\s+as\s+Promise\b|\bas\s+Promise\b/.test(valueClause)
  ) {
    bindingMask |= BINDING_PROMISE;
  }
  if (
    /(?:^|[{,])\s*fetch\s*(?:[,}]|$)/.test(valueClause) ||
    /\*\s+as\s+fetch\b|\bas\s+fetch\b/.test(valueClause)
  ) {
    bindingMask |= BINDING_FETCH;
  }
  if (
    /(?:^|[{,])\s*globalThis\s*(?:[,}]|$)/.test(valueClause) ||
    /\*\s+as\s+globalThis\b|\bas\s+globalThis\b/.test(valueClause)
  ) {
    bindingMask |= BINDING_GLOBAL_THIS;
  }
  return bindingMask;
};

const addNamedDeclaration = (
  scopes: SourceScope[],
  name: string | undefined,
  index: number,
): void => {
  if (!name) {
    return;
  }
  const scope = scopes[scopeAt(scopes, index)];
  if (scope) {
    scope.bindingMask |= bindingMaskFor(name);
  }
};

const addDeclaredBindings = (code: string, scopes: SourceScope[]): void => {
  for (const match of code.matchAll(DECLARATION_PATTERN)) {
    const [, name] = match;
    addNamedDeclaration(scopes, name, match.index);
  }
  const [rootScope] = scopes;
  if (!rootScope) {
    return;
  }
  for (const match of code.matchAll(IMPORT_PATTERN)) {
    const [, clause = ''] = match;
    rootScope.bindingMask |= importBindingMask(clause);
  }
};

const parameterBindingMask = (parameters: string): number => {
  let bindingMask = NO_BINDING;
  if (/(?:^|[,({])\s*(?:\.\.\.\s*)?Promise\s*(?=$|[:,?=}])/.test(parameters)) {
    bindingMask |= BINDING_PROMISE;
  }
  if (/(?:^|[,({])\s*(?:\.\.\.\s*)?fetch\s*(?=$|[:,?=}])/.test(parameters)) {
    bindingMask |= BINDING_FETCH;
  }
  if (/(?:^|[,({])\s*(?:\.\.\.\s*)?globalThis\s*(?=$|[:,?=}])/.test(parameters)) {
    bindingMask |= BINDING_GLOBAL_THIS;
  }
  return bindingMask;
};

const lastParenthesisBefore = (parentheses: readonly Parentheses[], arrowIndex: number): number => {
  let low = 0;
  let high = parentheses.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if ((parentheses[middle]?.close ?? Number.POSITIVE_INFINITY) < arrowIndex) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return low - 1;
};

const matchingParameterPair = (
  code: string,
  parentheses: readonly Parentheses[],
  arrowIndex: number,
): Parentheses | undefined => {
  const pair = parentheses[lastParenthesisBefore(parentheses, arrowIndex)];
  if (
    pair &&
    pair.close < arrowIndex &&
    /^\s*(?::[^=;{}]*)?$/.test(code.slice(pair.close + 1, arrowIndex))
  ) {
    return pair;
  }
  return undefined;
};

const singleArrowParameterMask = (code: string, arrowIndex: number): number => {
  let end = arrowIndex;
  while (end > 0 && /\s/.test(code[end - 1] ?? '')) {
    end -= 1;
  }
  let start = end;
  while (start > 0 && /[\w$]/.test(code[start - 1] ?? '')) {
    start -= 1;
  }
  const name = code.slice(start, end);
  if (name !== 'Promise' && name !== 'fetch' && name !== 'globalThis') {
    return NO_BINDING;
  }
  return bindingMaskFor(name);
};

const isAtBaseDepth = (depth: NestingDepth): boolean =>
  depth.brace === 0 && depth.bracket === 0 && depth.parenthesis === 0;

const isUnmatchedClose = (character: string | undefined, depth: NestingDepth): boolean =>
  (character === ')' && depth.parenthesis === 0) ||
  (character === ']' && depth.bracket === 0) ||
  (character === '}' && depth.brace === 0);

const isArrowBodyEnd = (character: string | undefined, depth: NestingDepth): boolean =>
  isUnmatchedClose(character, depth) ||
  ((character === ',' || character === ';') && isAtBaseDepth(depth));

const updateDepth = (character: string | undefined, depth: NestingDepth): void => {
  const mutableDepth = depth;
  if (character === '(') {
    mutableDepth.parenthesis += 1;
  } else if (character === '[') {
    mutableDepth.bracket += 1;
  } else if (character === '{') {
    mutableDepth.brace += 1;
  } else if (character === ')') {
    mutableDepth.parenthesis -= 1;
  } else if (character === ']') {
    mutableDepth.bracket -= 1;
  } else if (character === '}') {
    mutableDepth.brace -= 1;
  }
};

const blockArrowBodyEnd = (code: string, start: number): number => {
  const braceEnd = findMatchingBrace(code, start);
  if (braceEnd === -1) {
    return code.length;
  }
  return braceEnd;
};

const expressionArrowBodyEnd = (code: string, start: number): number => {
  const depth = { brace: 0, bracket: 0, parenthesis: 0 };
  for (let index = start; index < code.length; index += 1) {
    const character = code[index];
    if (isArrowBodyEnd(character, depth)) {
      return index;
    }
    updateDepth(character, depth);
  }
  return code.length;
};

const arrowBodyEnd = (code: string, start: number): number => {
  if (code[start] === '{') {
    return blockArrowBodyEnd(code, start);
  }
  return expressionArrowBodyEnd(code, start);
};

const arrowBindingMask = (
  code: string,
  parentheses: readonly Parentheses[],
  arrowIndex: number,
): number => {
  const pair = matchingParameterPair(code, parentheses, arrowIndex);
  if (!pair) {
    return singleArrowParameterMask(code, arrowIndex);
  }
  return parameterBindingMask(code.slice(pair.open + 1, pair.close));
};

const addArrowParameterScopes = (
  code: string,
  parentheses: readonly Parentheses[],
  parameterScopes: ParameterScope[],
): void => {
  for (const arrow of code.matchAll(ARROW_PATTERN)) {
    const bindingMask = arrowBindingMask(code, parentheses, arrow.index);
    if (bindingMask !== NO_BINDING) {
      const start = skipWhitespace(code, arrow.index + arrow[0].length);
      parameterScopes.push({ bindingMask, end: arrowBodyEnd(code, start), start });
    }
  }
};

const functionBodyScope = (
  code: string,
  close: number,
  bindingMask: number,
): ParameterScope | undefined => {
  const bodyStart = code.indexOf('{', close + 1);
  const declarationEnd = code.indexOf(';', close + 1);
  if (bodyStart === -1 || (declarationEnd !== -1 && bodyStart >= declarationEnd)) {
    return undefined;
  }
  const bodyEnd = findMatchingBrace(code, bodyStart);
  let end = bodyEnd;
  if (bodyEnd === -1) {
    end = code.length;
  }
  return { bindingMask, end, start: bodyStart + 1 };
};

const functionParameterScope = (
  code: string,
  match: RegExpExecArray,
  parenthesesByOpen: ReadonlyMap<number, number>,
): ParameterScope | undefined => {
  const open = code.indexOf('(', match.index);
  const close = parenthesesByOpen.get(open) ?? code.length;
  const bindingMask = parameterBindingMask(code.slice(open + 1, close));
  if (bindingMask === NO_BINDING) {
    return undefined;
  }
  return functionBodyScope(code, close, bindingMask);
};

const addFunctionParameterScopes = (
  code: string,
  pattern: RegExp,
  parenthesesByOpen: ReadonlyMap<number, number>,
  parameterScopes: ParameterScope[],
): void => {
  for (const match of code.matchAll(pattern)) {
    const scope = functionParameterScope(code, match, parenthesesByOpen);
    if (scope) {
      parameterScopes.push(scope);
    }
  }
};

const parameterRangesFor = (
  scopes: readonly ParameterScope[],
  bindingMask: number,
): SourceScope[] => {
  let maxEnd = -1;
  return scopes
    .filter((scope): boolean => (scope.bindingMask & bindingMask) !== 0 && scope.start < scope.end)
    .sort((left, right) => left.start - right.start)
    .map(({ end, start }) => {
      maxEnd = Math.max(maxEnd, end);
      return { bindingMask: NO_BINDING, end: maxEnd, parent: -1, start };
    });
};

const parameterRangesIndex = (
  scopes: readonly ParameterScope[],
): ReadonlyMap<number, readonly SourceScope[]> => {
  const cached = parameterRangeCache.get(scopes);
  if (cached) {
    return cached;
  }
  const value = new Map(
    BINDING_BITS.map((bindingMask) => [bindingMask, parameterRangesFor(scopes, bindingMask)]),
  );
  parameterRangeCache.set(scopes, value);
  return value;
};

const cacheSourceScopeIndex = (code: string, value: SourceScopeIndex): SourceScopeIndex =>
  sourceScopeCache.set(
    code,
    value,
    sourceScopeIndexCacheWeight(code.length, {
      parameterScopeCount: value.parameterScopes.length,
      scopeCount: value.scopes.length,
    }),
  );

/** Build or retrieve the lexical scope index for stripped source. @internal */
export const sourceScopeIndex = (code: string): SourceScopeIndex => {
  const cached = sourceScopeCache.get(code);
  if (cached) {
    return cached;
  }
  const scan = scanSourceScopes(code);
  addDeclaredBindings(code, scan.scopes);
  const parameterScopes: ParameterScope[] = [];
  addArrowParameterScopes(code, scan.parentheses, parameterScopes);
  addFunctionParameterScopes(code, FUNCTION_PATTERN, scan.parenthesesByOpen, parameterScopes);
  addFunctionParameterScopes(code, CATCH_PATTERN, scan.parenthesesByOpen, parameterScopes);
  return cacheSourceScopeIndex(code, { parameterScopes, scopes: scan.scopes });
};

const isParameterBound = (
  parameterScopes: readonly ParameterScope[],
  targetIndex: number,
  bindingMask: number,
): boolean => {
  const ranges = parameterRangesIndex(parameterScopes);
  return BINDING_BITS.some((bindingBit) => {
    const bindingRanges = ranges.get(bindingBit);
    const scope = bindingRanges?.[lastScopeBefore(bindingRanges, targetIndex)];
    return (
      (bindingMask & bindingBit) !== 0 &&
      scope !== undefined &&
      scope.start <= targetIndex &&
      scope.end > targetIndex
    );
  });
};

/** Check whether a Promise or fetch reference resolves to a local value. @internal */
const isScopeBound = (
  scopes: readonly SourceScope[],
  targetIndex: number,
  bindingMask: number,
): boolean => {
  let scopeIndex = scopeAt(scopes, targetIndex);
  while (scopeIndex !== -1) {
    const scope = scopes[scopeIndex];
    if (!scope) {
      return false;
    }
    if ((scope.bindingMask & bindingMask) !== 0) {
      return true;
    }
    scopeIndex = scope.parent;
  }
  return false;
};

/** Check whether a Promise or fetch reference resolves to a local value. @internal */
export const isLocallyBound = (
  index: SourceScopeIndex,
  targetIndex: number,
  bindingMask: number,
): boolean =>
  isParameterBound(index.parameterScopes, targetIndex, bindingMask) ||
  isScopeBound(index.scopes, targetIndex, bindingMask);
