/* -------------------------------------------------------------------------- */
/*          Ignored source-region helpers for exported JSDoc checks.          */
/* -------------------------------------------------------------------------- */
import { Array, HashSet, Match, pipe } from 'effect';

interface ScanState {
  isBlockComment: boolean;
  isEscaped: boolean;
  isLineComment: boolean;
  quote: string | undefined;
}

const initialState: ScanState = {
  isBlockComment: false,
  isEscaped: false,
  isLineComment: false,
  quote: undefined,
};

const quoteCharacters = HashSet.make('"', "'", '`');

const lineCommentState = (state: ScanState, char: string): ScanState => ({
  ...state,
  isLineComment: char !== '\n',
});

const blockCommentState = (
  state: ScanState,
  char: string,
  nextChar: string | undefined,
): ScanState => ({
  ...state,
  isBlockComment: !(char === '*' && nextChar === '/'),
});

const quotedState = (state: ScanState, char: string): ScanState => {
  if (state.isEscaped) {
    return { ...state, isEscaped: false };
  }
  if (char === '\\') {
    return { ...state, isEscaped: true };
  }
  if (char === state.quote) {
    return { ...state, quote: undefined };
  }
  return state;
};

const unquotedState = (state: ScanState, char: string, nextChar: string | undefined): ScanState => {
  if (char === '/' && nextChar === '/') {
    return { ...state, isLineComment: true };
  }
  if (char === '/' && nextChar === '*') {
    return { ...state, isBlockComment: true };
  }
  if (HashSet.has(quoteCharacters, char)) {
    return { ...state, quote: char };
  }
  return state;
};

const nextIgnoredState = (
  state: ScanState,
  char: string,
  nextChar: string | undefined,
): ScanState => {
  if (state.isLineComment) {
    return lineCommentState(state, char);
  }
  if (state.isBlockComment) {
    return blockCommentState(state, char, nextChar);
  }
  if (state.quote) {
    return quotedState(state, char);
  }
  return unquotedState(state, char, nextChar);
};

const scanIndexesBefore = (pos: number): readonly number[] =>
  Match.value(pos).pipe(
    Match.when(
      (position): boolean => position <= 0,
      () => [],
    ),
    Match.orElse((position) => Array.range(0, position - 1)),
  );

const scanStateBefore = (source: string, pos: number): ScanState =>
  pipe(
    scanIndexesBefore(pos),
    Array.reduce(initialState, (state, index) =>
      nextIgnoredState(state, source[index] ?? '', source[index + 1]),
    ),
  );

/**
 * Checks whether a source offset is inside a comment or string literal.
 *
 * @internal
 */
export const isInsideIgnoredText = (source: string, pos: number): boolean =>
  pipe(
    scanStateBefore(source, pos),
    (state) => state.isBlockComment || state.isLineComment || state.quote !== undefined,
  );
