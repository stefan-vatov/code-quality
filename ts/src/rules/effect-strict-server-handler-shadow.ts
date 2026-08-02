/* -------------------------------------------------------------------------- */
/*            Lexical shadowing index for handler source fallback.            */
/* -------------------------------------------------------------------------- */
import type { RunSyncBindings, SourceRange } from './effect-strict-server-handler-types';
import { isIdentifierPart, isWhitespace, lowerBound } from './effect-strict-server-handler-index';
import type { ExpressionBoundaryIndex } from './effect-strict-server-handler-index';

const CHAR_CODE_PAREN_CLOSE = 41;
const CHAR_CODE_BRACE_OPEN = 123;
const CHAR_CODE_DOT = 46;
const CHAR_CODE_COLON = 58;
const CHAR_CODE_COMMA = 44;
const CHAR_CODE_EQUALS = 61;
const CHAR_CODE_BRACKET_CLOSE = 93;
const CHAR_CODE_BRACE_CLOSE = 125;
const FUNCTION_PATTERN = /\bfunction(?:\s*\*)?\s*([A-Za-z_$][\w$]*)?\s*\(/g;
const ARROW_PATTERN = /=>/g;
const DECLARATION_PATTERN = /\b(?:const|let|var|class|function)\s+([A-Za-z_$][\w$]*)\b/g;

/**
 * Describes indexed lexical shadow intervals.
 *
 * @param intervals - Shadow intervals grouped by binding name.
 * @param maxEnds - Prefix maximum interval ends grouped by binding name.
 * @param starts - Sorted interval starts grouped by binding name.
 * @returns A shadow lookup index.
 * @throws Does not throw.
 * @internal
 */
export interface ShadowIntervalIndex {
  readonly intervals: ReadonlyMap<string, readonly SourceRange[]>;
  readonly maxEnds: ReadonlyMap<string, readonly number[]>;
  readonly starts: ReadonlyMap<string, readonly number[]>;
}

type FunctionBodyRange = (
  code: string,
  boundary: ExpressionBoundaryIndex,
  parameterOpen: number,
) => SourceRange | undefined;

interface ArrowParameters {
  contentEnd: number;
  contentStart: number;
  scopeStart: number;
}

interface BindingSets {
  readonly names: ReadonlySet<string>;
  readonly intervals: Map<string, SourceRange[]>;
}

const previousCodeAt = (boundary: ExpressionBoundaryIndex, index: number): number =>
  boundary.previousCode[index] ?? -1;

const tokenEndAt = (code: string, start: number, end: number): number => {
  let tokenEnd = start + 1;
  while (tokenEnd < end && isIdentifierPart(code.charCodeAt(tokenEnd))) {
    tokenEnd += 1;
  }
  return tokenEnd;
};

interface ParameterBindingInput {
  readonly boundary: ExpressionBoundaryIndex;
  readonly code: string;
  readonly end: number;
  readonly names: ReadonlySet<string>;
  readonly start: number;
  readonly tokenEnd: number;
}

interface ParameterTokenInput {
  readonly boundary: ExpressionBoundaryIndex;
  readonly code: string;
  readonly end: number;
  readonly found: string[];
  readonly index: number;
  readonly names: ReadonlySet<string>;
}

interface NamedFunctionBoundNamesInput {
  readonly boundary: ExpressionBoundaryIndex;
  readonly code: string;
  readonly match: RegExpExecArray;
  readonly parameterClose: number;
  readonly parameterOpen: number;
  readonly sets: BindingSets;
}

const isParameterBinding = (input: ParameterBindingInput): boolean => {
  const { boundary, code, end, names, start, tokenEnd } = input;
  const token = code.slice(start, tokenEnd);
  let after = CHAR_CODE_PAREN_CLOSE;
  if (tokenEnd < end) {
    after = code.charCodeAt(tokenEnd);
  }
  const previous = previousCodeAt(boundary, start);
  if (!names.has(token) || previous === CHAR_CODE_DOT || after === CHAR_CODE_COLON) {
    return false;
  }
  return (
    after === CHAR_CODE_PAREN_CLOSE ||
    after === CHAR_CODE_COMMA ||
    after === CHAR_CODE_EQUALS ||
    after === CHAR_CODE_BRACKET_CLOSE ||
    after === CHAR_CODE_BRACE_CLOSE
  );
};

const parameterTokenEnd = (input: ParameterTokenInput): number => {
  const { boundary, code, end, found, index, names } = input;
  const tokenEnd = tokenEndAt(code, index, end);
  if (
    isParameterBinding({
      boundary,
      code,
      end,
      names,
      start: index,
      tokenEnd,
    })
  ) {
    found.push(code.slice(index, tokenEnd));
  }
  return tokenEnd;
};

const parameterBindingNames = (
  code: string,
  boundary: ExpressionBoundaryIndex,
  start: number,
  end: number,
  names: ReadonlySet<string>,
): string[] => {
  const found: string[] = [];
  let index = start;
  while (index < end) {
    const isTokenStart =
      isIdentifierPart(code.charCodeAt(index)) &&
      (index === start || !isIdentifierPart(code.charCodeAt(index - 1)));
    let nextIndex = index + 1;
    if (isTokenStart) {
      nextIndex = parameterTokenEnd({ boundary, code, end, found, index, names });
    }
    index = nextIndex;
  }
  return found;
};

const addShadowInterval = (
  intervals: Map<string, SourceRange[]>,
  name: string,
  range: SourceRange,
): void => {
  const values = intervals.get(name);
  if (values) {
    values.push(range);
  } else {
    intervals.set(name, [range]);
  }
};

const namedFunctionBoundNames = (input: NamedFunctionBoundNamesInput): string[] => {
  const { boundary, code, match, parameterClose, parameterOpen, sets } = input;
  const boundNames = parameterBindingNames(
    code,
    boundary,
    parameterOpen + 1,
    parameterClose,
    sets.names,
  );
  const functionName = match.at(1);
  if (functionName && sets.names.has(functionName)) {
    boundNames.push(functionName);
  }
  return boundNames;
};

const addNamedFunctionShadow = (
  sets: BindingSets,
  code: string,
  boundary: ExpressionBoundaryIndex,
  functionBodyRange: FunctionBodyRange,
  match: RegExpExecArray,
): void => {
  const parameterOpen = match.index + match[0].lastIndexOf('(');
  const parameterClose = boundary.closeByOpen.get(parameterOpen);
  const body = functionBodyRange(code, boundary, parameterOpen);
  if (parameterClose === undefined || body === undefined) {
    return;
  }
  const boundNames = namedFunctionBoundNames({
    boundary,
    code,
    match,
    parameterClose,
    parameterOpen,
    sets,
  });
  for (const name of boundNames) {
    addShadowInterval(sets.intervals, name, { end: body.end, start: parameterOpen + 1 });
  }
};

const addNamedFunctionShadows = (
  sets: BindingSets,
  code: string,
  boundary: ExpressionBoundaryIndex,
  functionBodyRange: FunctionBodyRange,
): void => {
  FUNCTION_PATTERN.lastIndex = 0;
  let match = FUNCTION_PATTERN.exec(code);
  while (match !== null) {
    addNamedFunctionShadow(sets, code, boundary, functionBodyRange, match);
    match = FUNCTION_PATTERN.exec(code);
  }
};

const frameOpenAt = (boundary: ExpressionBoundaryIndex, frameId: number): number | undefined => {
  if (frameId < 0) {
    return undefined;
  }
  return boundary.frameOpens[frameId];
};

const parenthesizedArrowParameters = (
  boundary: ExpressionBoundaryIndex,
  previous: number,
): ArrowParameters | undefined => {
  const frameId = boundary.frameAt[previous] ?? -1;
  const open = frameOpenAt(boundary, frameId);
  if (open !== undefined && boundary.closeByOpen.get(open) === previous) {
    return { contentEnd: previous, contentStart: open + 1, scopeStart: open };
  }
  return undefined;
};

const bareArrowParameters = (code: string, previous: number): ArrowParameters => {
  let parameterStart = previous;
  while (parameterStart >= 0 && isIdentifierPart(code.charCodeAt(parameterStart))) {
    parameterStart -= 1;
  }
  parameterStart += 1;
  return {
    contentEnd: previous + 1,
    contentStart: parameterStart,
    scopeStart: parameterStart,
  };
};

const arrowParametersAt = (
  code: string,
  boundary: ExpressionBoundaryIndex,
  arrowIndex: number,
): ArrowParameters | undefined => {
  const previous = previousCodeAt(boundary, arrowIndex);
  if (previous < 0) {
    return undefined;
  }
  if (code.charCodeAt(previous) === CHAR_CODE_PAREN_CLOSE) {
    return parenthesizedArrowParameters(boundary, previous);
  }
  return bareArrowParameters(code, previous);
};

const nextCodeIndex = (code: string, start: number): number => {
  let index = start;
  while (index < code.length && isWhitespace(code.charCodeAt(index))) {
    index += 1;
  }
  return index;
};

const arrowBodyEnd = (
  code: string,
  boundary: ExpressionBoundaryIndex,
  arrow: RegExpExecArray,
): number => {
  const bodyStart = nextCodeIndex(code, arrow.index + arrow[0].length);
  if (code.charCodeAt(bodyStart) === CHAR_CODE_BRACE_OPEN) {
    return boundary.closeByOpen.get(bodyStart) ?? -1;
  }
  return boundary.expressionEnd(bodyStart);
};

const addArrowShadow = (
  sets: BindingSets,
  code: string,
  boundary: ExpressionBoundaryIndex,
  match: RegExpExecArray,
): void => {
  const parameters = arrowParametersAt(code, boundary, match.index);
  if (parameters === undefined) {
    return;
  }
  const bodyEnd = arrowBodyEnd(code, boundary, match);
  if (bodyEnd < parameters.contentStart) {
    return;
  }
  const boundNames = parameterBindingNames(
    code,
    boundary,
    parameters.contentStart,
    parameters.contentEnd,
    sets.names,
  );
  for (const name of boundNames) {
    addShadowInterval(sets.intervals, name, { end: bodyEnd, start: parameters.scopeStart });
  }
};

const addArrowShadows = (
  sets: BindingSets,
  code: string,
  boundary: ExpressionBoundaryIndex,
): void => {
  ARROW_PATTERN.lastIndex = 0;
  let match = ARROW_PATTERN.exec(code);
  while (match !== null) {
    addArrowShadow(sets, code, boundary, match);
    match = ARROW_PATTERN.exec(code);
  }
};

const declarationEnd = (code: string, boundary: ExpressionBoundaryIndex, index: number): number => {
  const frameId = boundary.frameAt[index] ?? -1;
  if (frameId < 0) {
    return code.length;
  }
  return boundary.frameCloses[frameId] ?? code.length;
};

const addDeclarationShadow = (
  sets: BindingSets,
  code: string,
  boundary: ExpressionBoundaryIndex,
  match: RegExpExecArray,
): void => {
  const [, name] = match;
  if (name && sets.names.has(name)) {
    addShadowInterval(sets.intervals, name, {
      end: declarationEnd(code, boundary, match.index),
      start: match.index,
    });
  }
};

const addDeclarationShadows = (
  sets: BindingSets,
  code: string,
  boundary: ExpressionBoundaryIndex,
): void => {
  DECLARATION_PATTERN.lastIndex = 0;
  let match = DECLARATION_PATTERN.exec(code);
  while (match !== null) {
    addDeclarationShadow(sets, code, boundary, match);
    match = DECLARATION_PATTERN.exec(code);
  }
};

const summarizeIntervals = (
  intervals: ReadonlyMap<string, readonly SourceRange[]>,
): Pick<ShadowIntervalIndex, 'maxEnds' | 'starts'> => {
  const maxEnds = new Map<string, readonly number[]>();
  const starts = new Map<string, readonly number[]>();
  for (const [name, values] of intervals) {
    const sortedValues = [...values].sort((left, right): number => left.start - right.start);
    const summary = summarizeIntervalValues(sortedValues);
    maxEnds.set(name, summary.maxEnds);
    starts.set(name, summary.starts);
  }
  return { maxEnds, starts };
};

const summarizeIntervalValues = (
  values: readonly SourceRange[],
): { maxEnds: readonly number[]; starts: readonly number[] } => {
  const maxEnds: number[] = [];
  const starts: number[] = [];
  let maximum = -1;
  for (const value of values) {
    maximum = Math.max(maximum, value.end);
    maxEnds.push(maximum);
    starts.push(value.start);
  }
  return { maxEnds, starts };
};

/**
 * Builds lexical shadow intervals for imported runSync names.
 *
 * @param code - Comment and literal-free source projection.
 * @param boundary - Indexed delimiter boundaries.
 * @param bindings - Imported names eligible for matching.
 * @param functionBodyRange - Function-body range resolver.
 * @returns A shadow lookup index.
 * @throws Does not throw.
 * @internal
 */
export const buildShadowIndex = (
  code: string,
  boundary: ExpressionBoundaryIndex,
  bindings: RunSyncBindings,
  functionBodyRange: FunctionBodyRange,
): ShadowIntervalIndex => {
  const names = new Set([...bindings.direct, ...bindings.namespace, ...bindings.root]);
  const intervals = new Map<string, SourceRange[]>();
  const sets = { intervals, names };
  addNamedFunctionShadows(sets, code, boundary, functionBodyRange);
  addArrowShadows(sets, code, boundary);
  addDeclarationShadows(sets, code, boundary);
  const summary = summarizeIntervals(intervals);
  return { intervals, ...summary };
};

/**
 * Tests whether an imported name is shadowed at a source offset.
 *
 * @param index - Lexical shadow index.
 * @param name - Imported binding name.
 * @param target - Source offset being checked.
 * @returns Whether the binding is shadowed at the target.
 * @throws Does not throw.
 * @internal
 */
export const isShadowed = (index: ShadowIntervalIndex, name: string, target: number): boolean => {
  const maxEnds = index.maxEnds.get(name);
  const starts = index.starts.get(name);
  if (maxEnds === undefined || starts === undefined) {
    return false;
  }
  const position = lowerBound(starts, target + 1);
  return position > 0 && (maxEnds[position - 1] ?? -1) >= target;
};
