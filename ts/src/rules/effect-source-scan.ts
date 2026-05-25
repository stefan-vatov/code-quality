/* -------------------------------------------------------------------------- */
/*              Source scanning utilities for Effect lint rules.              */
/* -------------------------------------------------------------------------- */
import { Array, Option, pipe } from 'effect';
import { findREGEXLiteralEnd, isREGEXLiteralStart } from './effect-source-regex-scan';

export { findREGEXLiteralEnd, isREGEXLiteralStart } from './effect-source-regex-scan';

const STRIP_CACHE_MAX = 256;
const codeOnlyCache = new Map<string, string>();

interface StripState {
  index: number;
  isBlockComment: boolean;
  isEscaped: boolean;
  isLineComment: boolean;
  quote: string;
  stripped: string;
  templateExpressionDepth: number;
}

interface QuoteState {
  isEscaped: boolean;
  quote: string;
}

interface QuoteOrNonCodeScanResult {
  index: number;
  quoteState: QuoteState;
}

interface DepthScanResult {
  depth: number;
  index: number;
  isEnd: boolean;
  quoteState: QuoteState;
}

type DepthReduceState = DepthScanResult & { endIndex: number };

const scanIndexes = (startIndex: number, endIndex: number): readonly number[] => {
  if (startIndex > endIndex) {
    return [];
  }
  return Array.range(startIndex, endIndex);
};

const appendNewlineOrBlank = (output: string, char: string): string => {
  if (char === '\n') {
    return output + char;
  }
  return `${output} `;
};

const appendPreservedOrBlank = (output: string, shouldPreserve: boolean, char: string): string => {
  if (shouldPreserve) {
    return output + char;
  }
  return `${output} `;
};

const lineCommentStep = (state: StripState, char: string): StripState => {
  if (char === '\n') {
    return { ...state, isLineComment: false, stripped: state.stripped + char };
  }
  return { ...state, stripped: `${state.stripped} ` };
};

const blockCommentStep = (
  state: StripState,
  char: string,
  nextChar: string | undefined,
): StripState => {
  if (char === '*' && nextChar === '/') {
    return {
      ...state,
      index: state.index + 1,
      isBlockComment: false,
      stripped: `${state.stripped}  `,
    };
  }
  return { ...state, stripped: appendNewlineOrBlank(state.stripped, char) };
};

const templateInterpolationStartStep = (state: StripState): StripState => ({
  ...state,
  index: state.index + 1,
  quote: '',
  stripped: `${state.stripped}  `,
  templateExpressionDepth: state.templateExpressionDepth + 1,
});

const quotedStep = (state: StripState, char: string, nextChar: string | undefined): StripState => {
  if (state.quote === '`' && char === '$' && nextChar === '{' && !state.isEscaped) {
    return templateInterpolationStartStep(state);
  }
  if (state.isEscaped) {
    return { ...state, isEscaped: false, stripped: appendNewlineOrBlank(state.stripped, char) };
  }
  if (char === '\\') {
    return { ...state, isEscaped: true, stripped: appendNewlineOrBlank(state.stripped, char) };
  }
  if (char === state.quote) {
    return { ...state, quote: '', stripped: state.stripped + char };
  }
  return {
    ...state,
    stripped: appendPreservedOrBlank(state.stripped, char === '\n' || char === state.quote, char),
  };
};

const templateBraceStep = (state: StripState, char: string): StripState | undefined => {
  if (state.templateExpressionDepth <= 0) {
    return undefined;
  }
  if (char === '{') {
    return {
      ...state,
      stripped: state.stripped + char,
      templateExpressionDepth: state.templateExpressionDepth + 1,
    };
  }
  if (char !== '}') {
    return undefined;
  }

  const templateExpressionDepth = state.templateExpressionDepth - 1;
  if (templateExpressionDepth === 0) {
    return { ...state, quote: '`', stripped: `${state.stripped} `, templateExpressionDepth };
  }
  return { ...state, stripped: state.stripped + char, templateExpressionDepth };
};

const codeStep = (
  source: string,
  state: StripState,
  char: string,
  nextChar: string | undefined,
): StripState => {
  if (char === '/' && nextChar === '/') {
    return {
      ...state,
      index: state.index + 1,
      isLineComment: true,
      stripped: `${state.stripped}  `,
    };
  }
  if (char === '/' && nextChar === '*') {
    return {
      ...state,
      index: state.index + 1,
      isBlockComment: true,
      stripped: `${state.stripped}  `,
    };
  }
  if (isREGEXLiteralStart(source, state.index)) {
    const endIndex = findREGEXLiteralEnd(source, state.index);
    return {
      ...state,
      index: endIndex,
      stripped: state.stripped + ' '.repeat(endIndex - state.index + 1),
    };
  }
  if (char === '"' || char === "'" || char === '`') {
    return { ...state, quote: char, stripped: state.stripped + char };
  }
  return { ...state, stripped: state.stripped + char };
};

const stripCodeOnlyStep = (source: string, state: StripState): StripState => {
  const char = source[state.index];
  const nextChar = source[state.index + 1];
  if (state.isLineComment) {
    return lineCommentStep(state, char);
  }
  if (state.isBlockComment) {
    return blockCommentStep(state, char, nextChar);
  }
  if (state.quote) {
    return quotedStep(state, char, nextChar);
  }
  return pipe(
    Option.fromNullable(templateBraceStep(state, char)),
    Option.getOrElse((): StripState => codeStep(source, state, char, nextChar)),
  );
};

const initialStripState = (): StripState => ({
  index: 0,
  isBlockComment: false,
  isEscaped: false,
  isLineComment: false,
  quote: '',
  stripped: '',
  templateExpressionDepth: 0,
});

const quoteStart = (char: string): string => {
  if (char === '"' || char === "'" || char === '`') {
    return char;
  }
  return '';
};

const nextQuoteState = (state: QuoteState, char: string): QuoteState => {
  if (state.isEscaped) {
    return { ...state, isEscaped: false };
  }
  if (char === '\\') {
    return { ...state, isEscaped: true };
  }
  if (char === state.quote) {
    return { isEscaped: false, quote: '' };
  }
  return state;
};

const cacheResult = (cache: Map<string, string>, source: string, value: string): string => {
  if (cache.size >= STRIP_CACHE_MAX) {
    pipe(
      Option.fromNullable(cache.keys().next().value),
      Option.map((firstKey): boolean => cache.delete(firstKey)),
    );
  }
  cache.set(source, value);
  return value;
};

const skipLineCommentIndex = (source: string, index: number): number =>
  pipe(
    Option.fromNullable(source.indexOf('\n', index + 2)),
    Option.map((newlineIndex): number => {
      if (newlineIndex === -1) {
        return source.length;
      }
      return newlineIndex;
    }),
    Option.getOrElse((): number => source.length),
  );

const skipBlockCommentIndex = (source: string, index: number): number =>
  pipe(
    Option.fromNullable(source.indexOf('*/', index + 2)),
    Option.map((commentEnd): number => {
      if (commentEnd === -1) {
        return source.length;
      }
      return commentEnd + 1;
    }),
    Option.getOrElse((): number => source.length),
  );

const skipNonCodeIndex = (source: string, index: number): number | undefined => {
  const char = source[index];
  const nextChar = source[index + 1];
  if (char === '/' && nextChar === '/') {
    return skipLineCommentIndex(source, index);
  }
  if (char === '/' && nextChar === '*') {
    return skipBlockCommentIndex(source, index);
  }
  if (isREGEXLiteralStart(source, index)) {
    return findREGEXLiteralEnd(source, index);
  }
  return undefined;
};

const quoteOrNonCodeScan = (
  source: string,
  index: number,
  quoteState: QuoteState,
): QuoteOrNonCodeScanResult | undefined => {
  const char = source[index];
  if (quoteState.quote) {
    return { index, quoteState: nextQuoteState(quoteState, char) };
  }
  const quote = quoteStart(char);
  if (quote) {
    return { index, quoteState: { isEscaped: false, quote } };
  }
  return pipe(
    Option.fromNullable(skipNonCodeIndex(source, index)),
    Option.map((nonCodeIndex): QuoteOrNonCodeScanResult => ({ index: nonCodeIndex, quoteState })),
    Option.getOrUndefined,
  );
};

const nextBalancedCallScan = (
  source: string,
  index: number,
  depth: number,
  quoteState: QuoteState,
): DepthScanResult =>
  pipe(
    Option.fromNullable(quoteOrNonCodeScan(source, index, quoteState)),
    Option.match({
      onNone: (): DepthScanResult => {
        const char = source[index];
        if (char === '(') {
          return { depth: depth + 1, index, isEnd: false, quoteState };
        }
        if (char === ')') {
          return { depth: depth - 1, index, isEnd: depth - 1 === 0, quoteState };
        }
        return { depth, index, isEnd: false, quoteState };
      },
      onSome: (quoteOrNonCode): DepthScanResult => ({ ...quoteOrNonCode, depth, isEnd: false }),
    }),
  );

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const findBalancedCallEnd = (source: string, openParenIndex: number): number =>
  pipe(
    scanIndexes(openParenIndex, source.length - 1),
    Array.reduce(
      {
        depth: 0,
        endIndex: source.length - 1,
        index: openParenIndex,
        isEnd: false,
        quoteState: { isEscaped: false, quote: '' },
      },
      (state, scanIndex): DepthReduceState => {
        if (state.isEnd || scanIndex < state.index) {
          return state;
        }
        const next = nextBalancedCallScan(source, scanIndex, state.depth, state.quoteState);
        if (next.isEnd) {
          return { ...next, endIndex: scanIndex };
        }
        return { ...next, endIndex: state.endIndex };
      },
    ),
    (state): number => state.endIndex,
  );

const nextBraceScan = (
  source: string,
  index: number,
  depth: number,
  quoteState: QuoteState,
): DepthScanResult =>
  pipe(
    Option.fromNullable(quoteOrNonCodeScan(source, index, quoteState)),
    Option.match({
      onNone: (): DepthScanResult => {
        const char = source[index];
        if (char === '{') {
          return { depth: depth + 1, index, isEnd: false, quoteState };
        }
        if (char === '}') {
          return { depth: depth - 1, index, isEnd: depth - 1 === 0, quoteState };
        }
        return { depth, index, isEnd: false, quoteState };
      },
      onSome: (quoteOrNonCode): DepthScanResult => ({ ...quoteOrNonCode, depth, isEnd: false }),
    }),
  );

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const stripCommentsAndStrings = (source: string): string =>
  pipe(
    Option.fromNullable(codeOnlyCache.get(source)),
    Option.match({
      onNone: (): string => {
        const state = pipe(
          scanIndexes(0, source.length - 1),
          Array.reduce(initialStripState(), (currentState, scanIndex): StripState => {
            if (scanIndex < currentState.index) {
              return currentState;
            }
            const stepped = stripCodeOnlyStep(source, currentState);
            return { ...stepped, index: stepped.index + 1 };
          }),
        );
        return cacheResult(codeOnlyCache, source, state.stripped);
      },
      onSome: (value): string => value,
    }),
  );

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const findMatchingBrace = (source: string, openIndex: number): number =>
  pipe(
    scanIndexes(openIndex, source.length - 1),
    Array.reduce(
      {
        depth: 0,
        endIndex: -1,
        index: openIndex,
        isEnd: false,
        quoteState: { isEscaped: false, quote: '' },
      },
      (state, scanIndex): DepthReduceState => {
        if (state.isEnd || scanIndex < state.index) {
          return state;
        }
        const next = nextBraceScan(source, scanIndex, state.depth, state.quoteState);
        if (next.isEnd) {
          return { ...next, endIndex: scanIndex };
        }
        return { ...next, endIndex: state.endIndex };
      },
    ),
    (state): number => state.endIndex,
  );
