/* -------------------------------------------------------------------------- */
/*      Source navigation helpers for Effect lint rule implementations.       */
/* -------------------------------------------------------------------------- */
import { Array, HashSet, Match, Option, pipe } from 'effect';
import {
  findBalancedCallEnd,
  findMatchingBrace,
  findREGEXLiteralEnd,
  isREGEXLiteralStart,
} from './effect-source-scan';

const quoteCharacters = HashSet.make('"', "'", '`');

const scanIndexes = (startIndex: number, endIndex: number): readonly number[] =>
  Match.value(startIndex).pipe(
    Match.when(
      (value): boolean => value > endIndex,
      () => [],
    ),
    Match.orElse((value): readonly number[] => Array.range(value, endIndex)),
  );

const indexOrFallback = (index: number, fallback: number): number =>
  Match.value(index).pipe(
    Match.when(-1, (): number => fallback),
    Match.orElse((value): number => value),
  );

const skipLineCommentIndex = (source: string, index: number, fallback: number): number =>
  indexOrFallback(source.indexOf('\n', index + 2), fallback);

const skipBlockCommentIndex = (source: string, index: number, fallback: number): number =>
  Match.value(source.indexOf('*/', index + 2)).pipe(
    Match.when(-1, (): number => fallback),
    Match.orElse((commentEnd): number => commentEnd + 1),
  );

interface QuoteState {
  isEscaped: boolean;
  quote: string;
}

const nextQuoteState = (state: QuoteState, char: string): QuoteState =>
  Match.value({ char, state }).pipe(
    Match.when(
      ({ state: currentState }): boolean => currentState.isEscaped,
      ({ state: currentState }): QuoteState => ({ ...currentState, isEscaped: false }),
    ),
    Match.when(
      ({ char: value }): boolean => value === '\\',
      ({ state: currentState }): QuoteState => ({ ...currentState, isEscaped: true }),
    ),
    Match.when(
      ({ char: value, state: currentState }): boolean => value === currentState.quote,
      (): QuoteState => ({ isEscaped: false, quote: '' }),
    ),
    Match.orElse(({ state: currentState }): QuoteState => currentState),
  );

const quoteStart = (char: string): string =>
  Match.value(char).pipe(
    Match.when(
      (value): boolean => HashSet.has(quoteCharacters, value),
      (value): string => value,
    ),
    Match.orElse((): string => ''),
  );

const scanNonCodeIndex = (source: string, index: number, fallback: number): number | undefined =>
  Match.value({ char: source[index], nextChar: source[index + 1] }).pipe(
    Match.when(
      ({ char, nextChar }): boolean => char === '/' && nextChar === '/',
      (): number => skipLineCommentIndex(source, index, fallback),
    ),
    Match.when(
      ({ char, nextChar }): boolean => char === '/' && nextChar === '*',
      (): number => skipBlockCommentIndex(source, index, fallback),
    ),
    Match.when(
      (): boolean => isREGEXLiteralStart(source, index),
      (): number => findREGEXLiteralEnd(source, index),
    ),
    Match.orElse((): undefined => undefined),
  );

const scanBraceIndex = (
  source: string,
  index: number,
  targetIndex: number,
  stack: number[],
): number => {
  const char = source[index];
  const nonCodeIndex = scanNonCodeIndex(source, index, targetIndex);
  return pipe(
    Option.fromNullable(nonCodeIndex),
    Option.match({
      onNone: (): number =>
        Match.value(char).pipe(
          Match.when('{', (): number => {
            stack.push(index);
            return index;
          }),
          Match.when('}', (): number => {
            stack.pop();
            return index;
          }),
          Match.orElse((): number => index),
        ),
      onSome: (value): number => value,
    }),
  );
};

const nextBraceScanIndex = (
  source: string,
  index: number,
  targetIndex: number,
  stack: number[],
  quoteState: QuoteState,
): { index: number; quoteState: QuoteState } => {
  const char = source[index];
  return Match.value(quoteState.quote).pipe(
    Match.when(
      (quote): boolean => quote !== '',
      (): { index: number; quoteState: QuoteState } => ({
        index,
        quoteState: nextQuoteState(quoteState, char),
      }),
    ),
    Match.orElse((): { index: number; quoteState: QuoteState } => {
      const quote = quoteStart(char);
      return Match.value(quote).pipe(
        Match.when(
          (value): boolean => value !== '',
          (value): { index: number; quoteState: QuoteState } => ({
            index,
            quoteState: { isEscaped: false, quote: value },
          }),
        ),
        Match.orElse((): { index: number; quoteState: QuoteState } => ({
          index: scanBraceIndex(source, index, targetIndex, stack),
          quoteState,
        })),
      );
    }),
  );
};

const findEnclosingBraceOpen = (source: string, targetIndex: number): number => {
  const stack: number[] = [];
  pipe(
    scanIndexes(0, targetIndex - 1),
    Array.reduce(
      { index: 0, quoteState: { isEscaped: false, quote: '' } },
      (state, scanIndex): { index: number; quoteState: QuoteState } =>
        Match.value(scanIndex < state.index).pipe(
          Match.when(true, (): { index: number; quoteState: QuoteState } => state),
          Match.orElse((): { index: number; quoteState: QuoteState } =>
            nextBraceScanIndex(source, scanIndex, targetIndex, stack, state.quoteState),
          ),
        ),
    ),
  );

  return stack.at(-1) ?? -1;
};

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const isInsideCall = (source: string, targetIndex: number, callPattern: RegExp): boolean =>
  pipe(
    Array.fromIterable(source.matchAll(callPattern)),
    Array.some((match): boolean => {
      const openParenIndex = source.indexOf('(', match.index);
      return (
        openParenIndex !== -1 &&
        openParenIndex <= targetIndex &&
        targetIndex <= findBalancedCallEnd(source, openParenIndex)
      );
    }),
  );

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const statementAfter = (source: string, targetIndex: number, maxLength = 320): string => {
  const end = source.indexOf(';', targetIndex);
  return Match.value(end).pipe(
    Match.when(-1, (): string => source.slice(targetIndex, targetIndex + maxLength)),
    Match.orElse((statementEnd): string => source.slice(targetIndex, statementEnd + 1)),
  );
};

interface StatementDepth {
  brace: number;
  bracket: number;
  paren: number;
}

const isStatementDepthZero = (depth: StatementDepth): boolean =>
  depth.brace === 0 && depth.bracket === 0 && depth.paren === 0;

const updateParenDepth = (depth: StatementDepth, char: string): StatementDepth | undefined =>
  Match.value(char).pipe(
    Match.when('(', (): StatementDepth => ({ ...depth, paren: depth.paren + 1 })),
    Match.when(')', (): StatementDepth => ({ ...depth, paren: depth.paren - 1 })),
    Match.orElse((): undefined => undefined),
  );

const updateBraceDepth = (depth: StatementDepth, char: string): StatementDepth | undefined =>
  Match.value(char).pipe(
    Match.when('{', (): StatementDepth => ({ ...depth, brace: depth.brace + 1 })),
    Match.when('}', (): StatementDepth => ({ ...depth, brace: depth.brace - 1 })),
    Match.orElse((): undefined => undefined),
  );

const updateBracketDepth = (depth: StatementDepth, char: string): StatementDepth | undefined =>
  Match.value(char).pipe(
    Match.when('[', (): StatementDepth => ({ ...depth, bracket: depth.bracket + 1 })),
    Match.when(']', (): StatementDepth => ({ ...depth, bracket: depth.bracket - 1 })),
    Match.orElse((): undefined => undefined),
  );

const updateStatementDepth = (depth: StatementDepth, char: string): StatementDepth =>
  pipe(
    Option.fromNullable(updateParenDepth(depth, char)),
    Option.orElse(() => Option.fromNullable(updateBraceDepth(depth, char))),
    Option.orElse(() => Option.fromNullable(updateBracketDepth(depth, char))),
    Option.getOrElse((): StatementDepth => depth),
  );

const skipStatementNonCode = (source: string, index: number): number | undefined =>
  scanNonCodeIndex(source, index, source.length);

const quoteOrStatementNonCodeScan = (
  source: string,
  index: number,
  quoteState: QuoteState,
): { index: number; quoteState: QuoteState } | undefined => {
  const char = source[index];
  return Match.value(quoteState.quote).pipe(
    Match.when(
      (quote): boolean => quote !== '',
      (): { index: number; quoteState: QuoteState } => ({
        index,
        quoteState: nextQuoteState(quoteState, char),
      }),
    ),
    Match.orElse((): { index: number; quoteState: QuoteState } | undefined => {
      const quote = quoteStart(char);
      return Match.value(quote).pipe(
        Match.when(
          (value): boolean => value !== '',
          (value): { index: number; quoteState: QuoteState } => ({
            index,
            quoteState: { isEscaped: false, quote: value },
          }),
        ),
        Match.orElse((): { index: number; quoteState: QuoteState } | undefined =>
          pipe(
            Option.fromNullable(skipStatementNonCode(source, index)),
            Option.map((nonCodeIndex): { index: number; quoteState: QuoteState } => ({
              index: nonCodeIndex,
              quoteState,
            })),
            Option.getOrUndefined,
          ),
        ),
      );
    }),
  );
};

const nextStatementScan = (
  source: string,
  index: number,
  depth: StatementDepth,
  quoteState: QuoteState,
): { depth: StatementDepth; index: number; isEnd: boolean; quoteState: QuoteState } => {
  const char = source[index];
  return Match.value(char === ';' && isStatementDepthZero(depth)).pipe(
    Match.when(
      true,
      (): { depth: StatementDepth; index: number; isEnd: boolean; quoteState: QuoteState } => ({
        depth,
        index,
        isEnd: true,
        quoteState,
      }),
    ),
    Match.orElse(
      (): { depth: StatementDepth; index: number; isEnd: boolean; quoteState: QuoteState } =>
        pipe(
          Option.fromNullable(quoteOrStatementNonCodeScan(source, index, quoteState)),
          Option.match({
            onNone: (): {
              depth: StatementDepth;
              index: number;
              isEnd: boolean;
              quoteState: QuoteState;
            } => ({
              depth: updateStatementDepth(depth, char),
              index,
              isEnd: false,
              quoteState,
            }),
            onSome: (
              quoteOrNonCode,
            ): {
              depth: StatementDepth;
              index: number;
              isEnd: boolean;
              quoteState: QuoteState;
            } => ({ ...quoteOrNonCode, depth, isEnd: false }),
          }),
        ),
    ),
  );
};

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const findStatementEnd = (source: string, startIndex: number): number =>
  pipe(
    scanIndexes(startIndex, source.length - 1),
    Array.reduce(
      {
        depth: { brace: 0, bracket: 0, paren: 0 },
        endIndex: source.length - 1,
        index: startIndex,
        isEnd: false,
        quoteState: { isEscaped: false, quote: '' },
      },
      (
        state,
        scanIndex,
      ): {
        depth: StatementDepth;
        endIndex: number;
        index: number;
        isEnd: boolean;
        quoteState: QuoteState;
      } =>
        Match.value(state.isEnd || scanIndex < state.index).pipe(
          Match.when(true, () => state),
          Match.orElse(() => {
            const next = nextStatementScan(source, scanIndex, state.depth, state.quoteState);
            return {
              ...next,
              endIndex: Match.value(next.isEnd).pipe(
                Match.when(true, (): number => scanIndex),
                Match.orElse((): number => state.endIndex),
              ),
            };
          }),
        ),
    ),
    (state): number => state.endIndex,
  );

const enclosingEffectCallTail = (source: string, targetIndex: number): string | undefined =>
  pipe(
    Array.fromIterable(source.matchAll(/\bEffect\.(?:gen|fn)\s*\(/g)),
    Array.findFirst((match): boolean => {
      const openParenIndex = source.indexOf('(', match.index);
      return (
        openParenIndex !== -1 &&
        openParenIndex <= targetIndex &&
        targetIndex <= findBalancedCallEnd(source, openParenIndex)
      );
    }),
    Option.map((match): string => {
      const openParenIndex = source.indexOf('(', match.index);
      const endIndex = findBalancedCallEnd(source, openParenIndex);
      return source.slice(targetIndex, endIndex + 1);
    }),
    Option.getOrUndefined,
  );

const enclosingBraceTail = (source: string, targetIndex: number): string | undefined => {
  const openBrace = findEnclosingBraceOpen(source, targetIndex);
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

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
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
