/* -------------------------------------------------------------------------- */
/*       Comment stripping helper for source-backed Effect lint rules.        */
/* -------------------------------------------------------------------------- */
import { Array, HashSet, Match, Option, pipe } from 'effect';
import { CHAR_CLASS, CLS_DIGIT, CLS_LOWER, CLS_UNDER, CLS_UPPER } from './char-class';

const regexPrefixChars = HashSet.make('(', '[', '{', '=', ':', ',', ';', '!', '?', '&', '|');
const regexPrefixWords = HashSet.make(
  'case',
  'delete',
  'return',
  'throw',
  'typeof',
  'void',
  'yield',
);
const quoteCharacters = HashSet.make('"', "'", '`');
const COMMENT_CACHE_MAX = 256;
const commentCache = new Map<string, string>();
const IDENTIFIER_MASK = CLS_UPPER | CLS_LOWER | CLS_DIGIT | CLS_UNDER;
const CHAR_CODE_SPACE = 32;
const CHAR_CODE_TAB = 9;
const CHAR_CODE_NEWLINE = 10;
const CHAR_CODE_CARRIAGE_RETURN = 13;
const CHAR_CODE_VERTICAL_TAB = 11;
const CHAR_CODE_FORM_FEED = 12;
const CHAR_CODE_DOLLAR = 36;

const appendNewlineOrBlank = (output: string, char: string): string =>
  Match.value(char).pipe(
    Match.when(
      (value): boolean => value === '\n',
      (value): string => output + value,
    ),
    Match.orElse((): string => `${output} `),
  );

const isWhitespaceCode = (code: number): boolean =>
  code === CHAR_CODE_SPACE ||
  code === CHAR_CODE_TAB ||
  code === CHAR_CODE_NEWLINE ||
  code === CHAR_CODE_CARRIAGE_RETURN ||
  code === CHAR_CODE_VERTICAL_TAB ||
  code === CHAR_CODE_FORM_FEED;

const isASCIIIdentifierChar = (source: string, index: number): boolean => {
  const charCode = source.charCodeAt(index);
  return charCode === CHAR_CODE_DOLLAR || (CHAR_CLASS[charCode] & IDENTIFIER_MASK) !== 0;
};

const isASCIILetter = (source: string, index: number): boolean => {
  const charCode = source.charCodeAt(index);
  return (CHAR_CLASS[charCode] & (CLS_UPPER | CLS_LOWER)) !== 0;
};

interface QuoteState {
  isEscaped: boolean;
  quote: string;
}

const quoteStart = (char: string): string =>
  Match.value(char).pipe(
    Match.when(
      (value): boolean => HashSet.has(quoteCharacters, value),
      (value): string => value,
    ),
    Match.orElse((): string => ''),
  );

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

const cacheResult = (source: string, value: string): string => {
  pipe(
    Match.value(commentCache.size),
    Match.when(
      (size): boolean => size >= COMMENT_CACHE_MAX,
      (): void => {
        pipe(
          Option.fromNullable(commentCache.keys().next().value),
          Option.match({
            onNone: (): void => undefined,
            onSome: (firstKey): void => {
              commentCache.delete(firstKey);
            },
          }),
        );
      },
    ),
    Match.orElse((): void => undefined),
  );
  commentCache.set(source, value);
  return value;
};

const scanIndexesBefore = (index: number): readonly number[] =>
  Match.value(index).pipe(
    Match.when(
      (value): boolean => value <= 0,
      () => [],
    ),
    Match.orElse((value): readonly number[] => Array.range(0, value - 1)),
  );

const scanIndexesFrom = (startIndex: number, endIndex: number): readonly number[] =>
  Match.value(startIndex).pipe(
    Match.when(
      (value): boolean => value > endIndex,
      () => [],
    ),
    Match.orElse((value): readonly number[] => Array.range(value, endIndex)),
  );

const previousSignificantIndex = (source: string, index: number): number =>
  pipe(
    scanIndexesBefore(index),
    Array.reduce(-1, (current, sourceIndex): number =>
      Match.value(isWhitespaceCode(source.charCodeAt(sourceIndex))).pipe(
        Match.when(true, (): number => current),
        Match.orElse((): number => sourceIndex),
      ),
    ),
  );

const wordStartBefore = (source: string, index: number): number =>
  Match.value(index).pipe(
    Match.when(
      (start): boolean => start <= 0 || !isASCIILetter(source, start - 1),
      (start): number => start,
    ),
    Match.orElse((start): number => wordStartBefore(source, start - 1)),
  );

const wordBefore = (source: string, index: number): string =>
  source.slice(wordStartBefore(source, index), index);

const isREGEXPrefixChar = (source: string, index: number): boolean =>
  HashSet.has(regexPrefixChars, source[index]);

const isREGEXPrefixWord = (source: string, index: number): boolean =>
  isASCIIIdentifierChar(source, index) &&
  HashSet.has(regexPrefixWords, wordBefore(source, index + 1));

const isREGEXLiteralStart = (source: string, index: number): boolean =>
  Match.value(source[index] === '/' && source[index + 1] !== '/' && source[index + 1] !== '*').pipe(
    Match.when(false, (): boolean => false),
    Match.orElse((): boolean => {
      const previousIndex = previousSignificantIndex(source, index);
      return Match.value(previousIndex).pipe(
        Match.when(-1, (): boolean => true),
        Match.orElse(
          (sourceIndex): boolean =>
            isREGEXPrefixChar(source, sourceIndex) || isREGEXPrefixWord(source, sourceIndex),
        ),
      );
    }),
  );

const regexFlagsEndIndex = (source: string, index: number): number =>
  Match.value(index).pipe(
    Match.when(
      (endIndex): boolean => endIndex + 1 >= source.length || !isASCIILetter(source, endIndex + 1),
      (endIndex): number => endIndex,
    ),
    Match.orElse((endIndex): number => regexFlagsEndIndex(source, endIndex + 1)),
  );

const scanREGEXDelimiter = (
  source: string,
  index: number,
  isEscaped: boolean,
  isCharacterClass: boolean,
): { index: number; isEscaped: boolean; isEnd: boolean } | undefined =>
  Match.value(source[index]).pipe(
    Match.when(
      (char): boolean => !isEscaped && !isCharacterClass && char === '/',
      (): { index: number; isEscaped: boolean; isEnd: boolean } => ({
        index: regexFlagsEndIndex(source, index),
        isEnd: true,
        isEscaped: false,
      }),
    ),
    Match.when(
      (): boolean => isEscaped,
      (): { index: number; isEscaped: boolean; isEnd: boolean } => ({
        index,
        isEnd: false,
        isEscaped: false,
      }),
    ),
    Match.when(
      (char): boolean => char === '\\',
      (): { index: number; isEscaped: boolean; isEnd: boolean } => ({
        index,
        isEnd: false,
        isEscaped: true,
      }),
    ),
    Match.orElse((): undefined => undefined),
  );

const scanREGEXCharacterClass = (
  source: string,
  index: number,
  isEscaped: boolean,
  isCharacterClass: boolean,
): boolean =>
  Match.value(source[index]).pipe(
    Match.when(
      (): boolean => isEscaped,
      (): boolean => isCharacterClass,
    ),
    Match.when('[', (): boolean => true),
    Match.when(']', (): boolean => false),
    Match.orElse((): boolean => isCharacterClass),
  );

const findREGEXLiteralEnd = (source: string, startIndex: number): number => {
  const result = pipe(
    scanIndexesFrom(startIndex + 1, source.length - 1),
    Array.reduce(
      {
        endIndex: startIndex,
        isCharacterClass: false,
        isDone: false,
        isEscaped: false,
      },
      (
        state,
        index,
      ): {
        endIndex: number;
        isCharacterClass: boolean;
        isDone: boolean;
        isEscaped: boolean;
      } =>
        Match.value(state.isDone).pipe(
          Match.when(true, () => state),
          Match.orElse(() => {
            const delimiter = scanREGEXDelimiter(
              source,
              index,
              state.isEscaped,
              state.isCharacterClass,
            );
            return pipe(
              Option.fromNullable(delimiter),
              Option.match({
                onNone: () => ({
                  ...state,
                  isCharacterClass: scanREGEXCharacterClass(
                    source,
                    index,
                    false,
                    state.isCharacterClass,
                  ),
                  isEscaped: false,
                }),
                onSome: (value) =>
                  Match.value(value.isEnd).pipe(
                    Match.when(true, () => ({
                      ...state,
                      endIndex: value.index,
                      isDone: true,
                      isEscaped: value.isEscaped,
                    })),
                    Match.orElse(() => ({
                      ...state,
                      isCharacterClass: scanREGEXCharacterClass(
                        source,
                        index,
                        value.isEscaped,
                        state.isCharacterClass,
                      ),
                      isEscaped: value.isEscaped,
                    })),
                  ),
              }),
            );
          }),
        ),
    ),
  );

  return result.endIndex;
};

interface StripCommentState {
  index: number;
  isBlockComment: boolean;
  isEscaped: boolean;
  isLineComment: boolean;
  quote: string;
  stripped: string;
}

const lineCommentStripStep = (state: StripCommentState, char: string): StripCommentState =>
  Match.value(char).pipe(
    Match.when(
      (value): boolean => value === '\n',
      (value): StripCommentState => ({
        ...state,
        isLineComment: false,
        stripped: state.stripped + value,
      }),
    ),
    Match.orElse((): StripCommentState => ({ ...state, stripped: `${state.stripped} ` })),
  );

const blockCommentStripStep = (
  state: StripCommentState,
  char: string,
  nextChar: string | undefined,
): StripCommentState =>
  Match.value(char === '*' && nextChar === '/').pipe(
    Match.when(
      true,
      (): StripCommentState => ({
        ...state,
        index: state.index + 1,
        isBlockComment: false,
        stripped: `${state.stripped}  `,
      }),
    ),
    Match.orElse(
      (): StripCommentState => ({ ...state, stripped: appendNewlineOrBlank(state.stripped, char) }),
    ),
  );

const quotedStripStep = (state: StripCommentState, char: string): StripCommentState => ({
  ...state,
  ...nextQuoteState(state, char),
  stripped: state.stripped + char,
});

const codeStripStep = (
  source: string,
  state: StripCommentState,
  char: string,
  nextChar: string | undefined,
): StripCommentState =>
  Match.value({ char, nextChar }).pipe(
    Match.when(
      ({ char: value, nextChar: nextValue }): boolean => value === '/' && nextValue === '/',
      (): StripCommentState => ({
        ...state,
        index: state.index + 1,
        isLineComment: true,
        stripped: `${state.stripped}  `,
      }),
    ),
    Match.when(
      ({ char: value, nextChar: nextValue }): boolean => value === '/' && nextValue === '*',
      (): StripCommentState => ({
        ...state,
        index: state.index + 1,
        isBlockComment: true,
        stripped: `${state.stripped}  `,
      }),
    ),
    Match.when(
      (): boolean => isREGEXLiteralStart(source, state.index),
      (): StripCommentState => {
        const endIndex = findREGEXLiteralEnd(source, state.index);
        return {
          ...state,
          index: endIndex,
          stripped: state.stripped + source.slice(state.index, endIndex + 1),
        };
      },
    ),
    Match.orElse(
      ({ char: value }): StripCommentState => ({
        ...state,
        quote: quoteStart(value),
        stripped: state.stripped + value,
      }),
    ),
  );

const stripCommentStep = (source: string, state: StripCommentState): StripCommentState => {
  const char = source[state.index];
  const nextChar = source[state.index + 1];
  return Match.value(state).pipe(
    Match.when(
      (currentState): boolean => currentState.isLineComment,
      (currentState): StripCommentState => lineCommentStripStep(currentState, char),
    ),
    Match.when(
      (currentState): boolean => currentState.isBlockComment,
      (currentState): StripCommentState => blockCommentStripStep(currentState, char, nextChar),
    ),
    Match.when(
      (currentState): boolean => currentState.quote !== '',
      (currentState): StripCommentState => quotedStripStep(currentState, char),
    ),
    Match.orElse(
      (currentState): StripCommentState => codeStripStep(source, currentState, char, nextChar),
    ),
  );
};

const initialStripCommentState = (): StripCommentState => ({
  index: 0,
  isBlockComment: false,
  isEscaped: false,
  isLineComment: false,
  quote: '',
  stripped: '',
});

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const stripComments = (source: string): string => {
  const cachedValue = commentCache.get(source);
  return pipe(
    Option.fromNullable(cachedValue),
    Option.match({
      onNone: (): string => {
        const state = pipe(
          scanIndexesFrom(0, source.length - 1),
          Array.reduce(
            initialStripCommentState(),
            (currentState, index): StripCommentState =>
              Match.value(index < currentState.index).pipe(
                Match.when(true, (): StripCommentState => currentState),
                Match.orElse((): StripCommentState => {
                  const stepped = stripCommentStep(source, { ...currentState, index });
                  return { ...stepped, index: stepped.index + 1 };
                }),
              ),
          ),
        );

        return cacheResult(source, state.stripped);
      },
      onSome: (value): string => value,
    }),
  );
};
