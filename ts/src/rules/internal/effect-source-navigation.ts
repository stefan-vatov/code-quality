import { Match, Option, pipe } from 'effect';
import { findMatchingBrace, stripCommentsAndStrings } from './effect-source-scan';
import type { SourceNavigationIndex } from './effect-source-navigation-index';
import { sourceNavigationIndex } from './effect-source-navigation-index';

const CHAR_CODE_SEMICOLON = 59;
const EFFECT_CALL_PATTERN = /\bEffect\.(?:gen|fn)\s*\(/g;

const lazySourceNavigationIndex = (source: string): (() => SourceNavigationIndex) => {
  let navigationIndex: SourceNavigationIndex | undefined = undefined;
  return (): SourceNavigationIndex => {
    if (navigationIndex !== undefined) {
      return navigationIndex;
    }
    navigationIndex = sourceNavigationIndex(source);
    return navigationIndex;
  };
};

export const isInsideCall = (source: string, targetIndex: number, callPattern: RegExp): boolean => {
  const code = stripCommentsAndStrings(source);
  const getNavigationIndex = lazySourceNavigationIndex(source);
  for (const match of source.matchAll(callPattern)) {
    const matchIndex = match.index;
    const openParenIndex = source.indexOf('(', matchIndex);
    const isCandidate =
      code.startsWith(match[0], matchIndex) &&
      openParenIndex !== -1 &&
      openParenIndex <= targetIndex;
    if (isCandidate && targetIndex <= getNavigationIndex().matchingCall(openParenIndex)) {
      return true;
    }
  }
  return false;
};

interface StatementEnd {
  endIndex: number;
  isEnd: boolean;
}

const scanStatementEnd = (source: string, startIndex: number): StatementEnd => {
  const endIndex = sourceNavigationIndex(source).statementEnd(startIndex);
  return { endIndex, isEnd: source.charCodeAt(endIndex) === CHAR_CODE_SEMICOLON };
};

export const findStatementEnd = (source: string, startIndex: number): number =>
  scanStatementEnd(source, startIndex).endIndex;

export const statementAfter = (source: string, targetIndex: number, maxLength = 320): string => {
  const statementEnd = scanStatementEnd(source, targetIndex);
  return Match.value(statementEnd).pipe(
    Match.when(
      ({ isEnd }): boolean => isEnd,
      ({ endIndex }): string => source.slice(targetIndex, endIndex + 1),
    ),
    Match.orElse((): string => source.slice(targetIndex, targetIndex + maxLength)),
  );
};

const effectCallTailForMatch = (
  source: string,
  code: string,
  targetIndex: number,
  getNavigationIndex: () => SourceNavigationIndex,
  match: RegExpMatchArray,
): string | undefined => {
  const matchIndex = match.index;
  const openParenIndex = source.indexOf('(', matchIndex);
  const isCandidate =
    code.startsWith(match[0], matchIndex) && openParenIndex !== -1 && openParenIndex <= targetIndex;
  if (!isCandidate) {
    return undefined;
  }
  const endIndex = getNavigationIndex().matchingCall(openParenIndex);
  if (targetIndex > endIndex) {
    return undefined;
  }
  return source.slice(targetIndex, endIndex + 1);
};

const enclosingEffectCallTail = (source: string, targetIndex: number): string | undefined => {
  const code = stripCommentsAndStrings(source);
  const getNavigationIndex = lazySourceNavigationIndex(source);
  for (const match of source.matchAll(EFFECT_CALL_PATTERN)) {
    const tail = effectCallTailForMatch(source, code, targetIndex, getNavigationIndex, match);
    if (tail !== undefined) {
      return tail;
    }
  }
  return undefined;
};

const enclosingBraceTail = (source: string, targetIndex: number): string | undefined => {
  const openBrace = sourceNavigationIndex(source).enclosingBraceOpen(targetIndex);
  return Match.value(openBrace).pipe(
    Match.when(-1, (): undefined => undefined),
    Match.orElse((braceIndex): string | undefined => {
      const closeBrace = findMatchingBrace(source, braceIndex);
      return Match.value(closeBrace).pipe(
        Match.when(-1, (): undefined => undefined),
        Match.orElse((closeIndex): string => source.slice(targetIndex, closeIndex + 1)),
      );
    }),
  );
};

const tailUntilNextFunction = (source: string, targetIndex: number): string => {
  const tail = source.slice(targetIndex);
  const nextFunction = tail
    .slice(1)
    .search(
      /\n\s*(?:export\s+)?(?:(?:async\s+)?function\b|const\s+[A-Za-z_$][\w$]*\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)?\s*=>)/,
    );
  return Match.value(nextFunction).pipe(
    Match.when(-1, (): string => tail),
    Match.orElse((index): string => tail.slice(0, index + 1)),
  );
};

export const sameFunctionTail = (source: string, targetIndex: number): string => {
  const effectTail = enclosingEffectCallTail(source, targetIndex);
  return pipe(
    Option.fromNullable(effectTail),
    Option.match({
      onNone: (): string =>
        pipe(
          Option.fromNullable(enclosingBraceTail(source, targetIndex)),
          Option.getOrElse((): string => tailUntilNextFunction(source, targetIndex)),
        ),
      onSome: (value): string => value,
    }),
  );
};
