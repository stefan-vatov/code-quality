import type { RunSyncBindings, SourceRange } from './effect-strict-server-handler-types';
import {
  buildExpressionBoundaryIndex,
  functionBodyRange,
  isIdentifierPart,
  isWhitespace,
  lowerBound,
} from './effect-strict-server-handler-index';
import { buildShadowIndex, isShadowed } from './effect-strict-server-handler-shadow';
import type { ExpressionBoundaryIndex } from './effect-strict-server-handler-index';
import type { ShadowIntervalIndex } from './effect-strict-server-handler-shadow';
import { collectRunSyncBindings } from './effect-strict-server-handler-imports';
import { stripComments } from './effect-source-comments';
import { stripCommentsAndStrings } from './effect-source-helpers';

const CHAR_CODE_PAREN_OPEN = 40;
const CHAR_CODE_COLON = 58;
const CHAR_CODE_COMMA = 44;
const CHAR_CODE_SEMICOLON = 59;
const CHAR_CODE_BRACE_OPEN = 123;
const CHAR_CODE_BRACE_CLOSE = 125;
const HANDLER_NAMES = new Set(['action', 'handler', 'loader', 'route']);
const PROPERTY_MODIFIERS = new Set([
  'abstract',
  'async',
  'declare',
  'get',
  'override',
  'private',
  'protected',
  'public',
  'readonly',
  'set',
  'static',
]);
const HANDLER_ASSIGNMENT_PATTERN = /\b(?:handler|route|loader|action)\s*=/g;
const HANDLER_FUNCTION_PATTERN =
  /\bfunction(?:\s*\*)?\s+(?:handler|route|loader|action)(?:\s*<[^>{}]*>)?\s*\(/g;
const HANDLER_PROPERTY_PATTERN =
  /(?:\b(handler|route|loader|action)\b|(["'])(handler|route|loader|action)\2)(?=\s*(?::|\())/g;
const RUN_SYNC_CALL_PATTERN =
  /\b([A-Za-z_$][\w$]*)\s*(?:\.\s*([A-Za-z_$][\w$]*)\s*\.\s*runSync|\.\s*runSync)?\s*\(/g;

const isCodeAt = (code: string, index: number): boolean =>
  index >= 0 && index < code.length && code[index]?.trim() !== '';

const previousIdentifierStart = (
  code: string,
  boundary: ExpressionBoundaryIndex,
  end: number,
): number => {
  let start = end;
  while (start > 0) {
    const previous = boundary.previousCode[start] ?? -1;
    const isAdjacent = previous >= 0 && previous + 1 === start;
    if (!isAdjacent || !isIdentifierPart(code.charCodeAt(previous))) {
      break;
    }
    start = previous;
  }
  return start;
};

const previousWord = (code: string, boundary: ExpressionBoundaryIndex, index: number): string => {
  const end = boundary.previousCode[index] ?? -1;
  if (end < 0 || !isIdentifierPart(code.charCodeAt(end))) {
    return '';
  }
  const start = previousIdentifierStart(code, boundary, end);
  return code.slice(start, end + 1);
};

const isPropertyBoundaryCode = (charCode: number): boolean =>
  charCode === CHAR_CODE_COMMA ||
  charCode === CHAR_CODE_SEMICOLON ||
  charCode === CHAR_CODE_BRACE_OPEN ||
  charCode === CHAR_CODE_BRACE_CLOSE;

const propertyModifierContextAt = (
  code: string,
  boundary: ExpressionBoundaryIndex,
  cursor: number,
): { before: number } | undefined => {
  const modifier = previousWord(code, boundary, cursor + 1);
  if (!PROPERTY_MODIFIERS.has(modifier)) {
    return undefined;
  }
  const modifierStart = cursor - modifier.length + 1;
  return { before: boundary.previousCode[modifierStart] ?? -1 };
};

const isPropertyModifierContext = (
  code: string,
  boundary: ExpressionBoundaryIndex,
  previous: number,
): boolean => {
  let cursor = previous;
  while (cursor >= 0) {
    const context = propertyModifierContextAt(code, boundary, cursor);
    if (!context) {
      return false;
    }
    if (context.before < 0 || isPropertyBoundaryCode(code.charCodeAt(context.before))) {
      return true;
    }
    cursor = context.before;
  }
  return false;
};

const isBoundaryBeforeProperty = (
  code: string,
  boundary: ExpressionBoundaryIndex,
  index: number,
): boolean => {
  const previous = boundary.previousCode[index] ?? -1;
  if (previous < 0) {
    return true;
  }
  if (isPropertyBoundaryCode(code.charCodeAt(previous))) {
    return true;
  }
  return isPropertyModifierContext(code, boundary, previous);
};

const nextNonWhitespace = (code: string, start: number): number => {
  let index = start;
  while (index < code.length && isWhitespace(code.charCodeAt(index))) {
    index += 1;
  }
  return index;
};

const addExpressionRange = (
  ranges: SourceRange[],
  code: string,
  boundary: ExpressionBoundaryIndex,
  start: number,
): void => {
  const expressionStart = nextNonWhitespace(code, start);
  const expressionEnd = boundary.expressionEnd(expressionStart);
  if (expressionStart <= expressionEnd) {
    ranges.push({ end: expressionEnd, start: expressionStart });
  }
};

const assignmentRanges = (code: string, boundary: ExpressionBoundaryIndex): SourceRange[] => {
  const ranges: SourceRange[] = [];
  HANDLER_ASSIGNMENT_PATTERN.lastIndex = 0;
  let match = HANDLER_ASSIGNMENT_PATTERN.exec(code);
  while (match !== null) {
    addExpressionRange(ranges, code, boundary, match.index + match[0].length);
    match = HANDLER_ASSIGNMENT_PATTERN.exec(code);
  }
  return ranges;
};

const namedFunctionRanges = (code: string, boundary: ExpressionBoundaryIndex): SourceRange[] => {
  const ranges: SourceRange[] = [];
  HANDLER_FUNCTION_PATTERN.lastIndex = 0;
  let match = HANDLER_FUNCTION_PATTERN.exec(code);
  while (match !== null) {
    const parameterOpen = match.index + match[0].lastIndexOf('(');
    const body = functionBodyRange(code, boundary, parameterOpen);
    if (body) {
      ranges.push(body);
    }
    match = HANDLER_FUNCTION_PATTERN.exec(code);
  }
  return ranges;
};

const propertySeparator = (code: string, match: RegExpExecArray): number =>
  nextNonWhitespace(code, match.index + match[0].length);

const propertyRange = (
  ranges: SourceRange[],
  code: string,
  boundary: ExpressionBoundaryIndex,
  match: RegExpExecArray,
): void => {
  const [, identifierName, , literalName] = match;
  const propertyName = identifierName ?? literalName;
  const separator = propertySeparator(code, match);
  if (
    propertyName &&
    HANDLER_NAMES.has(propertyName) &&
    isCodeAt(code, match.index) &&
    isBoundaryBeforeProperty(code, boundary, match.index)
  ) {
    if (code.charCodeAt(separator) === CHAR_CODE_COLON) {
      addExpressionRange(ranges, code, boundary, separator + 1);
    } else if (code.charCodeAt(separator) === CHAR_CODE_PAREN_OPEN) {
      const body = functionBodyRange(code, boundary, separator);
      if (body) {
        ranges.push(body);
      }
    }
  }
};

const propertyRanges = (
  code: string,
  commentFreeSource: string,
  boundary: ExpressionBoundaryIndex,
): SourceRange[] => {
  const ranges: SourceRange[] = [];
  HANDLER_PROPERTY_PATTERN.lastIndex = 0;
  let match = HANDLER_PROPERTY_PATTERN.exec(commentFreeSource);
  while (match !== null) {
    propertyRange(ranges, code, boundary, match);
    match = HANDLER_PROPERTY_PATTERN.exec(commentFreeSource);
  }
  return ranges;
};

const handlerRanges = (
  code: string,
  commentFreeSource: string,
  boundary: ExpressionBoundaryIndex,
): SourceRange[] => {
  const ranges = assignmentRanges(code, boundary);
  ranges.push(...namedFunctionRanges(code, boundary));
  ranges.push(...propertyRanges(code, commentFreeSource, boundary));
  return ranges;
};

const memberRunSyncAccepted = (
  bindings: RunSyncBindings,
  objectName: string,
  namespaceName: string | undefined,
): boolean => {
  if (namespaceName !== undefined) {
    return namespaceName === 'Effect' && bindings.root.has(objectName);
  }
  return bindings.namespace.has(objectName) || bindings.root.has(objectName);
};

const runSyncCallAccepted = (
  bindings: RunSyncBindings,
  objectName: string,
  namespaceName: string | undefined,
  isMemberCall: boolean,
): boolean => {
  if (isMemberCall) {
    return memberRunSyncAccepted(bindings, objectName, namespaceName);
  }
  return bindings.direct.has(objectName);
};

const runSyncMatchIndexes = (
  code: string,
  bindings: RunSyncBindings,
  shadows: ShadowIntervalIndex,
): number[] => {
  const indexes: number[] = [];
  RUN_SYNC_CALL_PATTERN.lastIndex = 0;
  let match = RUN_SYNC_CALL_PATTERN.exec(code);
  while (match !== null) {
    const [, objectName, namespaceName] = match;
    const isMemberCall = match[0].includes('.');
    if (
      objectName &&
      runSyncCallAccepted(bindings, objectName, namespaceName, isMemberCall) &&
      !isShadowed(shadows, objectName, match.index)
    ) {
      indexes.push(match.index);
    }
    match = RUN_SYNC_CALL_PATTERN.exec(code);
  }
  return indexes;
};

const hasRunSyncBetween = (indexes: readonly number[], start: number, end: number): boolean => {
  if (start > end || indexes.length === 0) {
    return false;
  }
  const index = lowerBound(indexes, start);
  return (indexes[index] ?? Number.POSITIVE_INFINITY) <= end;
};

export const hasRunSyncInServerRequestHandlerSource = (source: string): boolean => {
  const code = stripCommentsAndStrings(source);
  const commentFreeSource = stripComments(source);
  const boundary = buildExpressionBoundaryIndex(code);
  const bindings = collectRunSyncBindings(source);
  const shadows = buildShadowIndex(code, boundary, bindings, functionBodyRange);
  const indexes = runSyncMatchIndexes(code, bindings, shadows);
  if (indexes.length === 0) {
    return false;
  }
  return handlerRanges(code, commentFreeSource, boundary).some((range): boolean =>
    hasRunSyncBetween(indexes, range.start, range.end),
  );
};
