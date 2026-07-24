/* -------------------------------------------------------------------------- */
/*         Lexical source index for the Effect.sync Promise fallback.         */
/* -------------------------------------------------------------------------- */

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
const SOURCE_SCOPE_CACHE_MAX = 128;
const DECLARATION_PATTERN = /\b(?:class|const|function|let|var)\s+(Promise|fetch|globalThis)\b/g;
const IMPORT_PATTERN = /\bimport\s+(?!type\b)([^;]*?)\s+from\s*["']/g;
const ARROW_PATTERN = /=>/g;
const FUNCTION_PATTERN = /\bfunction(?:\s+[A-Za-z_$][\w$]*)?\s*(?:<[^>{;]*>)?\s*\(/g;
const CATCH_PATTERN = /\bcatch\s*\(/g;

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
  scopes: SourceScope[];
}

interface DelimiterScan {
  parentheses: Parentheses[];
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

const sourceScopeCache = new Map<string, SourceScopeIndex>();

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
  parenthesisStack: number[],
  index: number,
): void => {
  const open = parenthesisStack.pop();
  if (open !== undefined) {
    parentheses.push({ close: index, open });
  }
};

const scanDelimiter = (character: string | undefined, index: number, scan: DelimiterScan): void => {
  const { parentheses, parenthesisStack, scopes, scopeStack, sourceLength } = scan;
  if (character === '{') {
    openScope(scopes, scopeStack, sourceLength, index);
  } else if (character === '}') {
    closeScope(scopes, scopeStack, index);
  } else if (character === '(') {
    parenthesisStack.push(index);
  } else if (character === ')') {
    closeParenthesis(parentheses, parenthesisStack, index);
  }
};

const scanSourceScopes = (code: string): ScopeScan => {
  const scopes: SourceScope[] = [
    { bindingMask: NO_BINDING, end: code.length, parent: -1, start: 0 },
  ];
  const scopeStack = [0];
  const parenthesisStack: number[] = [];
  const parentheses: Parentheses[] = [];
  const scan = { parentheses, parenthesisStack, scopeStack, scopes, sourceLength: code.length };
  for (let index = 0; index < code.length; index += 1) {
    scanDelimiter(code[index], index, scan);
  }
  return { parentheses, scopes };
};

const scopeAt = (scopes: readonly SourceScope[], index: number): number => {
  for (let scopeIndex = scopes.length - 1; scopeIndex >= 0; scopeIndex -= 1) {
    const scope = scopes[scopeIndex];
    if (scope && scope.start <= index && index < scope.end) {
      return scopeIndex;
    }
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

const matchingParameterPair = (
  code: string,
  parentheses: readonly Parentheses[],
  arrowIndex: number,
): Parentheses | undefined => {
  for (let index = parentheses.length - 1; index >= 0; index -= 1) {
    const pair = parentheses[index];
    if (
      pair &&
      pair.close < arrowIndex &&
      /^\s*(?::[^=;{}]*)?$/.test(code.slice(pair.close + 1, arrowIndex))
    ) {
      return pair;
    }
  }
  return undefined;
};

const singleArrowParameterMask = (code: string, arrowIndex: number): number => {
  const prefix = code.slice(0, arrowIndex);
  const match = /(?:^|[^\w$])(?:async\s+)?(Promise|fetch|globalThis)\s*$/.exec(prefix);
  const name = match?.[1];
  if (!name) {
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
): ParameterScope | undefined => {
  const open = code.indexOf('(', match.index);
  const close = matchingParenthesisEnd(code, open);
  const bindingMask = parameterBindingMask(code.slice(open + 1, close));
  if (bindingMask === NO_BINDING) {
    return undefined;
  }
  return functionBodyScope(code, close, bindingMask);
};

const addFunctionParameterScopes = (
  code: string,
  pattern: RegExp,
  parameterScopes: ParameterScope[],
): void => {
  for (const match of code.matchAll(pattern)) {
    const scope = functionParameterScope(code, match);
    if (scope) {
      parameterScopes.push(scope);
    }
  }
};

const cacheSourceScopeIndex = (code: string, value: SourceScopeIndex): SourceScopeIndex => {
  if (sourceScopeCache.size >= SOURCE_SCOPE_CACHE_MAX) {
    const firstKey = sourceScopeCache.keys().next().value;
    if (firstKey !== undefined) {
      sourceScopeCache.delete(firstKey);
    }
  }
  sourceScopeCache.set(code, value);
  return value;
};

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
  addFunctionParameterScopes(code, FUNCTION_PATTERN, parameterScopes);
  addFunctionParameterScopes(code, CATCH_PATTERN, parameterScopes);
  return cacheSourceScopeIndex(code, { parameterScopes, scopes: scan.scopes });
};

const isParameterBound = (
  parameterScopes: readonly ParameterScope[],
  targetIndex: number,
  bindingMask: number,
): boolean => {
  for (const scope of parameterScopes) {
    if (
      scope.start <= targetIndex &&
      targetIndex < scope.end &&
      (scope.bindingMask & bindingMask) !== 0
    ) {
      return true;
    }
  }
  return false;
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
