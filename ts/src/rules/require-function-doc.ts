/* -------------------------------------------------------------------------- */
/*  Exported-declaration documentation requirement helper for custom Oxlint   */
/*                                   Rules.                                   */
/* -------------------------------------------------------------------------- */
import type { IgnoredTextIndex } from './require-function-doc-ignored-text';
import { createIgnoredTextIndex } from './require-function-doc-ignored-text';
import { isDocumentedLocalExportList } from './require-function-doc-local-exports';

const CHAR_CODE_SPACE = 32,
  CHAR_CODE_TAB = 9,
  CHAR_CODE_NEWLINE = 10,
  CHAR_CODE_CARRIAGE_RETURN = 13;
const CHAR_CODE_ASTERISK = 42,
  CHAR_CODE_SLASH = 47,
  CHAR_CODE_HASH = 35,
  CHAR_CODE_AT_SIGN = 64;
const CHAR_CODE_OPEN_PAREN = 40,
  CHAR_CODE_OPEN_BRACE = 123,
  CHAR_CODE_SEMICOLON = 59,
  CHAR_CODE_LESS_THAN = 60;
const CHAR_CODE_LOWER_A = 97,
  CHAR_CODE_LOWER_C = 99,
  CHAR_CODE_LOWER_D = 100,
  CHAR_CODE_LOWER_E = 101,
  CHAR_CODE_LOWER_F = 102,
  CHAR_CODE_LOWER_I = 105,
  CHAR_CODE_LOWER_L = 108,
  CHAR_CODE_LOWER_N = 110,
  CHAR_CODE_LOWER_T = 116,
  CHAR_CODE_LOWER_V = 118;
const CHAR_CODE_UPPER_C = 67,
  CHAR_CODE_UPPER_E = 69,
  CHAR_CODE_UPPER_F = 70,
  CHAR_CODE_UPPER_I = 73,
  CHAR_CODE_UPPER_L = 76,
  CHAR_CODE_UPPER_N = 78,
  CHAR_CODE_UPPER_V = 86;
const ASYNC_KEYWORD_LENGTH = 'async '.length,
  TYPE_KEYWORD_LENGTH = 'type '.length,
  EXPORT_KEYWORD_LENGTH = 'export '.length,
  DEFAULT_KEYWORD_LENGTH = 'default '.length,
  DECLARE_KEYWORD_LENGTH = 'declare '.length,
  ABSTRACT_KEYWORD_LENGTH = 'abstract '.length;

const isWhitespace = (code: number): boolean =>
  code === CHAR_CODE_SPACE ||
  code === CHAR_CODE_TAB ||
  code === CHAR_CODE_NEWLINE ||
  code === CHAR_CODE_CARRIAGE_RETURN;

const firstIndexNotMatching = (
  source: string,
  start: number,
  endExclusive: number,
  predicate: (code: number) => boolean,
): number => {
  let cursor = start;
  while (cursor < endExclusive && predicate(source.charCodeAt(cursor))) {
    cursor += 1;
  }
  return cursor;
};

const skipLinePrefix = (source: string, pos: number, lineEnd: number): number => {
  const contentStart = firstIndexNotMatching(source, pos, lineEnd, isWhitespace);
  let afterAsterisk = contentStart;
  if (contentStart < lineEnd && source.charCodeAt(contentStart) === CHAR_CODE_ASTERISK) {
    afterAsterisk += 1;
  }
  return firstIndexNotMatching(source, afterAsterisk, lineEnd, isWhitespace);
};

const lineHasDescriptionContent = (source: string, lineStart: number, lineEnd: number): boolean => {
  const pos = skipLinePrefix(source, lineStart, lineEnd);
  if (pos < lineEnd && source.charCodeAt(pos) === CHAR_CODE_AT_SIGN) {
    return false;
  }
  let cursor = pos;
  while (cursor < lineEnd) {
    if (!isWhitespace(source.charCodeAt(cursor))) {
      return true;
    }
    cursor += 1;
  }
  return false;
};

const lineEndFor = (source: string, lineStart: number): number => {
  const newline = source.indexOf('\n', lineStart);
  if (newline === -1) {
    return source.length;
  }
  return newline;
};

const hasDescriptionContent = (jsdocBody: string): boolean => {
  let lineStart = 0;
  while (true) {
    const lineEnd = lineEndFor(jsdocBody, lineStart);
    if (lineHasDescriptionContent(jsdocBody, lineStart, lineEnd)) {
      return true;
    }
    if (lineEnd === jsdocBody.length) {
      return false;
    }
    lineStart = lineEnd + 1;
  }
};

const skipWhitespaceBack = (source: string, pos: number): number => {
  let cursor = pos;
  while (cursor > 0 && isWhitespace(source.charCodeAt(cursor - 1))) {
    cursor -= 1;
  }
  return cursor;
};

const hasBlockCommentCloseAt = (source: string, pos: number): boolean =>
  pos >= '*/'.length &&
  source.charCodeAt(pos - '*/'.length) === CHAR_CODE_ASTERISK &&
  source.charCodeAt(pos - 1) === CHAR_CODE_SLASH;

const previousJSDocStart = (
  jsdocStarts: readonly number[],
  closeStar: number,
): number | undefined => {
  let lower = 0;
  let upper = jsdocStarts.length;
  while (lower < upper) {
    const middle = lower + Math.floor((upper - lower) / 2);
    if ((jsdocStarts[middle] ?? 0) + 2 < closeStar) {
      lower = middle + 1;
    } else {
      upper = middle;
    }
  }
  if (lower === 0) {
    return undefined;
  }
  return jsdocStarts[lower - 1];
};

const hasJSDocBefore = (
  source: string,
  exportPOS: number,
  jsdocStarts: readonly number[],
): boolean => {
  const pos = skipWhitespaceBack(source, exportPOS);

  if (!hasBlockCommentCloseAt(source, pos)) {
    return false;
  }

  const closeStar = pos - '*/'.length;
  const start = previousJSDocStart(jsdocStarts, closeStar);
  if (start === undefined) {
    return false;
  }
  return hasDescriptionContent(source.slice(start + '/**'.length + 1, closeStar).trim());
};

const endsWithWord = (source: string, pos: number, word: string): boolean => {
  const end = pos + word.length;
  if (end > source.length) {
    return false;
  }
  if (source.slice(pos, end) !== word) {
    return false;
  }
  if (end >= source.length) {
    return true;
  }
  const next = source.charCodeAt(end);
  return (
    isWhitespace(next) ||
    next === CHAR_CODE_OPEN_PAREN ||
    next === CHAR_CODE_OPEN_BRACE ||
    next === CHAR_CODE_SEMICOLON ||
    next === CHAR_CODE_LESS_THAN
  );
};

const isDefaultDeclaration = (source: string, pos: number): boolean => {
  const ch = source.charCodeAt(pos);

  if (ch === CHAR_CODE_LOWER_F) {
    return endsWithWord(source, pos, 'function');
  }
  if (ch === CHAR_CODE_LOWER_C) {
    return endsWithWord(source, pos, 'class');
  }
  if (ch === CHAR_CODE_LOWER_I) {
    return endsWithWord(source, pos, 'interface');
  }

  return false;
};

const AMBIENT_DECLARE_PREFIXES = ['declare module', 'declare namespace', 'declare global'];

const skipShebangComments = (source: string, idx: number): number | undefined => {
  let cursor = idx;
  while (cursor < source.length && source.charCodeAt(cursor) === CHAR_CODE_HASH) {
    const newlineIndex = source.indexOf('\n', cursor);
    if (newlineIndex === -1) {
      return undefined;
    }
    cursor = newlineIndex + 1;
  }
  return cursor;
};

const skipBlockComment = (source: string, idx: number): number | undefined => {
  const close = source.indexOf('*/', idx + '/*'.length);
  if (close === -1) {
    return undefined;
  }
  return close + '*/'.length;
};

const skipLineComment = (source: string, idx: number): number | undefined => {
  const nl = source.indexOf('\n', idx);
  if (nl === -1) {
    return undefined;
  }
  return nl + 1;
};

const skipTriviaToken = (source: string, idx: number): number | undefined => {
  const ch = source.charCodeAt(idx);
  if (isWhitespace(ch)) {
    return idx + 1;
  }
  if (
    ch === CHAR_CODE_SLASH &&
    idx + 1 < source.length &&
    source.charCodeAt(idx + 1) === CHAR_CODE_ASTERISK
  ) {
    return skipBlockComment(source, idx);
  }
  if (
    ch === CHAR_CODE_SLASH &&
    idx + 1 < source.length &&
    source.charCodeAt(idx + 1) === CHAR_CODE_SLASH
  ) {
    return skipLineComment(source, idx);
  }
  return idx;
};

const skipLeadingTrivia = (source: string, idx: number): number | undefined => {
  let cursor = idx;
  while (cursor < source.length) {
    const next = skipTriviaToken(source, cursor);
    if (next === undefined) {
      return undefined;
    }
    if (next === cursor) {
      return cursor;
    }
    cursor = next;
  }
  return cursor;
};

const hasAmbientPrefixAt = (source: string, idx: number): boolean => {
  for (const prefix of AMBIENT_DECLARE_PREFIXES) {
    if (idx + prefix.length <= source.length && source.slice(idx, idx + prefix.length) === prefix) {
      return true;
    }
  }
  return false;
};

const isAmbientDeclarationFile = (source: string): boolean => {
  const shebangEnd = skipShebangComments(source, 0);
  if (shebangEnd === undefined) {
    return false;
  }
  const idx = skipLeadingTrivia(source, shebangEnd);
  if (idx === undefined || idx >= source.length) {
    return false;
  }
  return hasAmbientPrefixAt(source, idx);
};

const skipWhitespace = (source: string, pos: number): number => {
  let cursor = pos;
  while (cursor < source.length && isWhitespace(source.charCodeAt(cursor))) {
    cursor++;
  }
  return cursor;
};

const isReExportAt = (source: string, afterExport: number): boolean => {
  if (afterExport >= source.length) {
    return false;
  }

  const c0 = source.charCodeAt(afterExport);
  if (c0 === CHAR_CODE_OPEN_BRACE || c0 === CHAR_CODE_ASTERISK) {
    return true;
  }

  if (
    c0 !== CHAR_CODE_LOWER_T ||
    afterExport + TYPE_KEYWORD_LENGTH > source.length ||
    source.slice(afterExport, afterExport + TYPE_KEYWORD_LENGTH) !== 'type '
  ) {
    return false;
  }

  const afterType = afterExport + TYPE_KEYWORD_LENGTH;
  return afterType < source.length && source.charCodeAt(afterType) === CHAR_CODE_OPEN_BRACE;
};

interface ModifierScanResult {
  hasSawDefault: boolean;
  pos: number;
}

interface ModifierSpec {
  charCode: number;
  isDefault: boolean;
  length: number;
  shouldStop: boolean;
  text: string;
}

const modifierSpecs: readonly ModifierSpec[] = [
  {
    charCode: CHAR_CODE_LOWER_D,
    isDefault: true,
    length: DEFAULT_KEYWORD_LENGTH,
    shouldStop: false,
    text: 'default ',
  },
  {
    charCode: CHAR_CODE_LOWER_A,
    isDefault: false,
    length: ASYNC_KEYWORD_LENGTH,
    shouldStop: false,
    text: 'async ',
  },
  {
    charCode: CHAR_CODE_LOWER_A,
    isDefault: false,
    length: ABSTRACT_KEYWORD_LENGTH,
    shouldStop: false,
    text: 'abstract ',
  },
  {
    charCode: CHAR_CODE_LOWER_T,
    isDefault: false,
    length: TYPE_KEYWORD_LENGTH,
    shouldStop: false,
    text: 'type ',
  },
  {
    charCode: CHAR_CODE_LOWER_N,
    isDefault: false,
    length: 0,
    shouldStop: true,
    text: 'namespace ',
  },
];

const modifierSpecMatches = (source: string, pos: number, spec: ModifierSpec): boolean =>
  source.charCodeAt(pos) === spec.charCode &&
  pos + spec.text.length <= source.length &&
  source.slice(pos, pos + spec.text.length) === spec.text;

const modifierLengthAt = (source: string, pos: number): ModifierSpec | undefined => {
  for (const spec of modifierSpecs) {
    if (modifierSpecMatches(source, pos, spec)) {
      return spec;
    }
  }
  return undefined;
};

const scanExportModifiers = (source: string, start: number): ModifierScanResult => {
  let hasSawDefault = false;
  let pos = start;
  while (true) {
    const modifier = modifierLengthAt(source, pos);
    if (modifier === undefined || modifier.shouldStop) {
      return { hasSawDefault, pos };
    }
    hasSawDefault ||= modifier.isDefault;
    pos = skipWhitespace(source, pos + modifier.length);
  }
};

const declarationStartCodes = new Set([
  CHAR_CODE_LOWER_F,
  CHAR_CODE_UPPER_F,
  CHAR_CODE_LOWER_C,
  CHAR_CODE_UPPER_C,
  CHAR_CODE_LOWER_I,
  CHAR_CODE_UPPER_I,
  CHAR_CODE_LOWER_E,
  CHAR_CODE_UPPER_E,
  CHAR_CODE_LOWER_L,
  CHAR_CODE_UPPER_L,
  CHAR_CODE_LOWER_V,
  CHAR_CODE_UPPER_V,
  CHAR_CODE_LOWER_N,
  CHAR_CODE_UPPER_N,
]);

const isDeclarationStartCode = (code: number): boolean => declarationStartCodes.has(code);

const canSkipDocumentedExport = (source: string, modifiers: ModifierScanResult): boolean => {
  if (modifiers.pos >= source.length) {
    return true;
  }
  const next = source.charCodeAt(modifiers.pos);
  if (!isDeclarationStartCode(next)) {
    return true;
  }
  return modifiers.hasSawDefault && !isDefaultDeclaration(source, modifiers.pos);
};

const documentedLocalExportListResult = (
  source: string,
  after: number,
  exp: number,
  sourceIndex: IgnoredTextIndex,
): boolean | undefined =>
  isDocumentedLocalExportList(source, after, exp, (candidateSource, declarationPOS): boolean =>
    hasJSDocBefore(candidateSource, declarationPOS, sourceIndex.jsdocStarts),
  );

const earlyExportDocResult = (
  source: string,
  after: number,
  exp: number,
  sourceIndex: IgnoredTextIndex,
): boolean | undefined => {
  if (after >= source.length) {
    return true;
  }

  const localExportList = documentedLocalExportListResult(source, after, exp, sourceIndex);
  if (localExportList !== undefined) {
    return localExportList;
  }

  if (isReExportAt(source, after)) {
    return true;
  }
  return undefined;
};

const isDocumentedExportDeclaration = (
  source: string,
  exp: number,
  sourceIndex: IgnoredTextIndex,
): boolean | undefined => {
  const after = skipWhitespace(source, exp + EXPORT_KEYWORD_LENGTH);
  const earlyResult = earlyExportDocResult(source, after, exp, sourceIndex);
  if (earlyResult !== undefined) {
    return earlyResult;
  }

  const modifiers = scanExportModifiers(source, after);
  if (canSkipDocumentedExport(source, modifiers)) {
    return true;
  }
  return hasJSDocBefore(source, exp, sourceIndex.jsdocStarts);
};

const isUndocumentedExportAt = (
  source: string,
  exp: number,
  sourceIndex: IgnoredTextIndex,
): boolean => {
  if (
    sourceIndex.isInside(exp) ||
    (exp !== 0 && !isWhitespace(source.charCodeAt(exp - 1))) ||
    (exp >= DECLARE_KEYWORD_LENGTH &&
      source.slice(exp - DECLARE_KEYWORD_LENGTH, exp) === 'declare ')
  ) {
    return false;
  }
  return isDocumentedExportDeclaration(source, exp, sourceIndex) === false;
};

/**
 * Location details for the first exported declaration missing JSDoc.
 */
export interface RequiredFunctionDocFailure {
  line: number;
  snippet: string;
}

const lineNumberAt = (source: string, pos: number): number => {
  let line = 1;
  let newline = source.indexOf('\n');
  while (newline !== -1 && newline < pos) {
    line += 1;
    newline = source.indexOf('\n', newline + 1);
  }
  return line;
};

const snippetEndAt = (source: string, pos: number): number =>
  (source.indexOf('\n', pos) + 1 || source.length + 1) - 1;

const failureAt = (source: string, pos: number): RequiredFunctionDocFailure => ({
  line: lineNumberAt(source, pos),
  snippet: source.slice(source.lastIndexOf('\n', pos - 1) + 1, snippetEndAt(source, pos)).trim(),
});

const firstUndocumentedExport = (
  source: string,
  sourceIndex: IgnoredTextIndex,
): number | undefined => {
  let searchFrom = 0;
  while (true) {
    const exportPOS = source.indexOf('export', searchFrom);
    if (exportPOS === -1) {
      return undefined;
    }
    const afterExport = exportPOS + EXPORT_KEYWORD_LENGTH - 1;
    if (
      isWhitespace(source.charCodeAt(afterExport)) &&
      isUndocumentedExportAt(source, exportPOS, sourceIndex)
    ) {
      return exportPOS;
    }
    searchFrom = afterExport;
  }
};

/**
 * Finds the first public exported declaration that lacks declaration JSDoc.
 */
export const findRequiredFunctionDocFailure = (
  source: string,
): RequiredFunctionDocFailure | undefined => {
  if (!source.includes('export')) {
    return undefined;
  }

  if (isAmbientDeclarationFile(source)) {
    return undefined;
  }

  const sourceIndex = createIgnoredTextIndex(source);
  const exportPOS = firstUndocumentedExport(source, sourceIndex);
  if (exportPOS === undefined) {
    return undefined;
  }
  return failureAt(source, exportPOS);
};

/**
 * Checks whether exported declarations have meaningful JSDoc comments.
 */
export default function hasRequiredFunctionDocs(source: string): boolean {
  return findRequiredFunctionDocFailure(source) === undefined;
}
