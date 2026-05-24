/* -------------------------------------------------------------------------- */
/*          Ignored source-region helpers for exported JSDoc checks.          */
/* -------------------------------------------------------------------------- */

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

const quoteCharacters = new Set(['"', "'", '`']);

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
  if (quoteCharacters.has(char)) {
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

/**
 * Checks whether a source offset is inside a comment or string literal.
 *
 * @internal
 */
export const isInsideIgnoredText = (source: string, pos: number): boolean => {
  let state = initialState;
  for (let index = 0; index < pos; index++) {
    state = nextIgnoredState(state, source[index] ?? '', source[index + 1]);
  }
  return state.isBlockComment || state.isLineComment || state.quote !== undefined;
};
