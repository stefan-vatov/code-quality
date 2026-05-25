/* -------------------------------------------------------------------------- */
/*  Exported-declaration documentation requirement helper for custom Oxlint   */
/*                                   Rules.                                   */
/* -------------------------------------------------------------------------- */
import { Array, HashSet, Match, Option, String, pipe } from 'effect';
import { isDocumentedLocalExportList } from './require-function-doc-local-exports';
import { isInsideIgnoredText } from './require-function-doc-ignored-text';

const CHAR_CODE_SPACE = 32;
const CHAR_CODE_TAB = 9;
const CHAR_CODE_NEWLINE = 10;
const CHAR_CODE_CARRIAGE_RETURN = 13;
const CHAR_CODE_ASTERISK = 42;
const CHAR_CODE_SLASH = 47;
const CHAR_CODE_HASH = 35;
const CHAR_CODE_AT_SIGN = 64;
const CHAR_CODE_OPEN_PAREN = 40;
const CHAR_CODE_OPEN_BRACE = 123;
const CHAR_CODE_SEMICOLON = 59;
const CHAR_CODE_LESS_THAN = 60;
const CHAR_CODE_LOWER_A = 97;
const CHAR_CODE_LOWER_C = 99;
const CHAR_CODE_LOWER_D = 100;
const CHAR_CODE_LOWER_E = 101;
const CHAR_CODE_LOWER_F = 102;
const CHAR_CODE_LOWER_I = 105;
const CHAR_CODE_LOWER_L = 108;
const CHAR_CODE_LOWER_N = 110;
const CHAR_CODE_LOWER_T = 116;
const CHAR_CODE_LOWER_V = 118;
const CHAR_CODE_UPPER_C = 67;
const CHAR_CODE_UPPER_E = 69;
const CHAR_CODE_UPPER_F = 70;
const CHAR_CODE_UPPER_I = 73;
const CHAR_CODE_UPPER_L = 76;
const CHAR_CODE_UPPER_N = 78;
const CHAR_CODE_UPPER_V = 86;
const ASYNC_KEYWORD_LENGTH = 'async '.length;
const TYPE_KEYWORD_LENGTH = 'type '.length;
const EXPORT_KEYWORD_LENGTH = 'export '.length;
const DEFAULT_KEYWORD_LENGTH = 'default '.length;
const DECLARE_KEYWORD_LENGTH = 'declare '.length;
const ABSTRACT_KEYWORD_LENGTH = 'abstract '.length;

const sourceIncludes =
  (needle: string) =>
  (source: string): boolean =>
    pipe(source, String.includes(needle));

const indexesBetween = (start: number, endExclusive: number): readonly number[] => {
  if (start >= endExclusive) {
    return Array.empty();
  }
  return Array.range(start, endExclusive - 1);
};

const matchesIn = (source: string, pattern: RegExp): readonly RegExpExecArray[] =>
  pipe(source.matchAll(pattern), Array.fromIterable);

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
): number =>
  pipe(
    indexesBetween(start, endExclusive),
    Array.findFirst((index): boolean => !predicate(source.charCodeAt(index))),
    Option.getOrElse((): number => endExclusive),
  );

const skipLinePrefix = (source: string, pos: number, lineEnd: number): number => {
  const contentStart = firstIndexNotMatching(source, pos, lineEnd, isWhitespace);
  const afterAsterisk = Match.value(contentStart).pipe(
    Match.when(
      (cursor): boolean => cursor < lineEnd && source.charCodeAt(cursor) === CHAR_CODE_ASTERISK,
      (cursor): number => cursor + 1,
    ),
    Match.orElse((cursor): number => cursor),
  );
  return firstIndexNotMatching(source, afterAsterisk, lineEnd, isWhitespace);
};

const isJSDocTagLine = (source: string, pos: number, lineEnd: number): boolean =>
  pos < lineEnd && source.charCodeAt(pos) === CHAR_CODE_AT_SIGN;

const lineEndFor = (source: string, lineStart: number): number =>
  Match.value(source.indexOf('\n', lineStart)).pipe(
    Match.when(
      (index): boolean => index === -1,
      (): number => source.length,
    ),
    Match.orElse((index): number => index),
  );

const lineHasDescriptionContent = (source: string, lineStart: number, lineEnd: number): boolean => {
  const pos = skipLinePrefix(source, lineStart, lineEnd);
  if (isJSDocTagLine(source, pos, lineEnd)) {
    return false;
  }
  return pipe(
    indexesBetween(pos, lineEnd),
    Array.some((index): boolean => !isWhitespace(source.charCodeAt(index))),
  );
};

const descriptionLineStarts = (jsdocBody: string): readonly number[] =>
  pipe(
    matchesIn(jsdocBody, /\n/g),
    Array.map((match): number => match.index + 1),
    Array.prepend(0),
  );

const hasDescriptionContent = (jsdocBody: string): boolean =>
  pipe(
    descriptionLineStarts(jsdocBody),
    Array.some((lineStart): boolean =>
      lineHasDescriptionContent(jsdocBody, lineStart, lineEndFor(jsdocBody, lineStart)),
    ),
  );

const skipWhitespaceBack = (source: string, pos: number): number =>
  pipe(
    indexesBetween(0, pos),
    Array.reverse,
    Array.findFirst((index): boolean => !isWhitespace(source.charCodeAt(index))),
    Option.match({
      onNone: (): number => 0,
      onSome: (index): number => index + 1,
    }),
  );

const hasBlockCommentCloseAt = (source: string, pos: number): boolean =>
  pos >= '*/'.length &&
  source.charCodeAt(pos - '*/'.length) === CHAR_CODE_ASTERISK &&
  source.charCodeAt(pos - 1) === CHAR_CODE_SLASH;

const jsdocContentBeforeClose = (
  source: string,
  open: number,
  closeStar: number,
): string | undefined => {
  if (open + 1 < closeStar && source.charCodeAt(open + 1) === CHAR_CODE_ASTERISK) {
    return source.slice(open + '/**'.length, closeStar).trim();
  }
  return undefined;
};

const previousJSDocContent = (source: string, closeStar: number): string | undefined =>
  pipe(
    indexesBetween(1, closeStar),
    Array.reverse,
    Array.filterMap((open): Option.Option<string> => {
      if (
        source.charCodeAt(open) === CHAR_CODE_ASTERISK &&
        source.charCodeAt(open - 1) === CHAR_CODE_SLASH
      ) {
        return Option.fromNullable(jsdocContentBeforeClose(source, open, closeStar));
      }
      return Option.none();
    }),
    Array.head,
    Option.getOrUndefined,
  );

const hasJSDocBefore = (source: string, exportPOS: number): boolean => {
  const pos = skipWhitespaceBack(source, exportPOS);

  if (!hasBlockCommentCloseAt(source, pos)) {
    return false;
  }

  const closeStar = pos - '*/'.length;
  const content = previousJSDocContent(source, closeStar);
  return content !== undefined && hasDescriptionContent(content);
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

const isDefaultDeclaration = (source: string, pos: number, _len: number): boolean => {
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
  const scan = (cursor: number): number | undefined =>
    Match.value(cursor).pipe(
      Match.when(
        (position): boolean =>
          position < source.length && source.charCodeAt(position) === CHAR_CODE_HASH,
        (position): number | undefined =>
          pipe(
            Option.some(source.indexOf('\n', position)),
            Option.filter((newlineIndex): boolean => newlineIndex !== -1),
            Option.flatMap(
              (newlineIndex): Option.Option<number> => Option.fromNullable(scan(newlineIndex + 1)),
            ),
            Option.getOrUndefined,
          ),
      ),
      Match.orElse((position): number => position),
    );
  return scan(idx);
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
  const scan = (cursor: number): number | undefined => {
    if (cursor >= source.length) {
      return cursor;
    }
    const next = skipTriviaToken(source, cursor);
    if (next === undefined) {
      return undefined;
    }
    if (next === cursor) {
      return cursor;
    }
    return scan(next);
  };
  return scan(idx);
};

const hasAmbientPrefixAt = (source: string, idx: number): boolean =>
  pipe(
    AMBIENT_DECLARE_PREFIXES,
    Array.some(
      (prefix): boolean =>
        idx + prefix.length <= source.length && source.slice(idx, idx + prefix.length) === prefix,
    ),
  );

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

const isStandaloneExportKeyword = (source: string, exp: number): boolean => {
  if (exp === 0) {
    return true;
  }
  return isWhitespace(source.charCodeAt(exp - 1));
};

const isDeclareExport = (source: string, exp: number): boolean =>
  exp >= DECLARE_KEYWORD_LENGTH && source.slice(exp - DECLARE_KEYWORD_LENGTH, exp) === 'declare ';

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

const modifierSpecs: readonly ModifierSpec[] = Array.make(
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
);

const modifierSpecMatches = (source: string, pos: number, spec: ModifierSpec): boolean =>
  source.charCodeAt(pos) === spec.charCode &&
  pos + spec.text.length <= source.length &&
  source.slice(pos, pos + spec.text.length) === spec.text;

const modifierLengthAt = (
  source: string,
  pos: number,
): { length: number; isDefault: boolean; shouldStop: boolean } | undefined =>
  pipe(
    modifierSpecs,
    Array.findFirst((spec): boolean => modifierSpecMatches(source, pos, spec)),
    Option.getOrUndefined,
  );

const scanExportModifiers = (source: string, start: number): ModifierScanResult => {
  const scan = (state: ModifierScanResult): ModifierScanResult =>
    pipe(
      Option.fromNullable(modifierLengthAt(source, state.pos)),
      Option.match({
        onNone: (): ModifierScanResult => state,
        onSome: (modifier): ModifierScanResult => {
          if (modifier.shouldStop) {
            return state;
          }
          return scan({
            hasSawDefault: state.hasSawDefault || modifier.isDefault,
            pos: skipWhitespace(source, state.pos + modifier.length),
          });
        },
      }),
    );

  return scan({ hasSawDefault: false, pos: start });
};

const declarationStartCodes = HashSet.make(
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
);

const isDeclarationStartCode = (code: number): boolean => HashSet.has(declarationStartCodes, code);

const canSkipDocumentedExport = (source: string, modifiers: ModifierScanResult): boolean => {
  if (modifiers.pos >= source.length) {
    return true;
  }
  const next = source.charCodeAt(modifiers.pos);
  if (!isDeclarationStartCode(next)) {
    return true;
  }
  return modifiers.hasSawDefault && !isDefaultDeclaration(source, modifiers.pos, source.length);
};

const documentedLocalExportListResult = (
  source: string,
  after: number,
  exp: number,
): boolean | undefined => isDocumentedLocalExportList(source, after, exp, hasJSDocBefore);

const exhaustedExportDocResult = (source: string, after: number): boolean | undefined => {
  if (after >= source.length) {
    return true;
  }
  return undefined;
};

const earlyExportDocResult = (source: string, after: number, exp: number): boolean | undefined => {
  const exhaustedExport = exhaustedExportDocResult(source, after);
  if (exhaustedExport !== undefined) {
    return exhaustedExport;
  }

  const localExportList = documentedLocalExportListResult(source, after, exp);
  if (localExportList !== undefined) {
    return localExportList;
  }

  if (isReExportAt(source, after)) {
    return true;
  }
  return undefined;
};

const isDocumentedExportDeclaration = (source: string, exp: number): boolean | undefined => {
  const after = skipWhitespace(source, exp + EXPORT_KEYWORD_LENGTH);
  const earlyResult = earlyExportDocResult(source, after, exp);
  if (earlyResult !== undefined) {
    return earlyResult;
  }

  const modifiers = scanExportModifiers(source, after);
  if (canSkipDocumentedExport(source, modifiers)) {
    return true;
  }
  return hasJSDocBefore(source, exp);
};

const isUndocumentedExportAt = (source: string, exp: number): boolean => {
  if (
    isInsideIgnoredText(source, exp) ||
    !isStandaloneExportKeyword(source, exp) ||
    isDeclareExport(source, exp)
  ) {
    return false;
  }
  return isDocumentedExportDeclaration(source, exp) === false;
};

/**
 * Location details for the first exported declaration missing JSDoc.
 */
export interface RequiredFunctionDocFailure {
  line: number;
  snippet: string;
}

const failureAt = (source: string, pos: number): RequiredFunctionDocFailure => {
  const snippetEnd = (source.indexOf('\n', pos) + 1 || source.length + 1) - 1;
  return {
    line: matchesIn(source.slice(0, pos), /\n/g).length + 1,
    snippet: source.slice(source.lastIndexOf('\n', pos - 1) + 1, snippetEnd).trim(),
  };
};

/**
 * Finds the first public exported declaration that lacks declaration JSDoc.
 */
export const findRequiredFunctionDocFailure = (
  source: string,
): RequiredFunctionDocFailure | undefined => {
  if (!sourceIncludes('export ')(source)) {
    return undefined;
  }

  if (isAmbientDeclarationFile(source)) {
    return undefined;
  }

  return pipe(
    matchesIn(source, /\bexport\s/g),
    Array.findFirst((match): boolean => isUndocumentedExportAt(source, match.index)),
    Option.map((match): RequiredFunctionDocFailure => failureAt(source, match.index)),
    Option.getOrUndefined,
  );
};

/**
 * Checks whether exported declarations have meaningful JSDoc comments.
 */
export default function hasRequiredFunctionDocs(source: string): boolean {
  return findRequiredFunctionDocFailure(source) === undefined;
}
