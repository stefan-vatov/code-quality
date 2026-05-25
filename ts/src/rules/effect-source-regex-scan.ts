/* -------------------------------------------------------------------------- */
/*          Regex literal scanning utilities for Effect lint rules.           */
/* -------------------------------------------------------------------------- */
import { Array, HashSet, Option, pipe } from 'effect';
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
const CHAR_CODE_SPACE = 32;
const CHAR_CODE_TAB = 9;
const CHAR_CODE_NEWLINE = 10;
const CHAR_CODE_CARRIAGE_RETURN = 13;
const CHAR_CODE_VERTICAL_TAB = 11;
const CHAR_CODE_FORM_FEED = 12;
const whitespaceCodes = HashSet.make(
  CHAR_CODE_SPACE,
  CHAR_CODE_TAB,
  CHAR_CODE_NEWLINE,
  CHAR_CODE_CARRIAGE_RETURN,
  CHAR_CODE_VERTICAL_TAB,
  CHAR_CODE_FORM_FEED,
);
const IDENTIFIER_MASK = CLS_UPPER | CLS_LOWER | CLS_DIGIT | CLS_UNDER;
const CHAR_CODE_DOLLAR = 36;

interface REGEXScanResult {
  endIndex?: number;
  isCharacterClass: boolean;
  isEscaped: boolean;
}

type REGEXReduceState = REGEXScanResult & { endIndex: number; isDone: boolean };

const scanIndexes = (startIndex: number, endIndex: number): readonly number[] => {
  if (startIndex > endIndex) {
    return [];
  }
  return Array.range(startIndex, endIndex);
};

const isWhitespaceCode = (code: number): boolean => HashSet.has(whitespaceCodes, code);

const isASCIIIdentifierChar = (source: string, index: number): boolean => {
  const code = source.charCodeAt(index);
  return (
    code === CHAR_CODE_DOLLAR ||
    (code < CHAR_CLASS.length && (CHAR_CLASS[code] & IDENTIFIER_MASK) !== 0)
  );
};

const isASCIILetter = (source: string, index: number): boolean => {
  const code = source.charCodeAt(index);
  return code < CHAR_CLASS.length && (CHAR_CLASS[code] & (CLS_UPPER | CLS_LOWER)) !== 0;
};

const previousSignificantIndex = (source: string, index: number): number =>
  pipe(
    scanIndexes(0, index - 1),
    Array.reduce(-1, (significantIndex, cursor): number => {
      if (isWhitespaceCode(source.charCodeAt(cursor))) {
        return significantIndex;
      }
      return cursor;
    }),
  );

const wordBefore = (source: string, index: number): string => {
  const endIndex = previousSignificantIndex(source, index);
  if (endIndex === -1 || !isASCIIIdentifierChar(source, endIndex)) {
    return '';
  }

  const lastSeparatorIndex = pipe(
    scanIndexes(0, endIndex),
    Array.reduce(-1, (separatorIndex, cursor): number => {
      if (isASCIIIdentifierChar(source, cursor)) {
        return separatorIndex;
      }
      return cursor;
    }),
  );
  return source.slice(lastSeparatorIndex + 1, endIndex + 1);
};

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const isREGEXLiteralStart = (source: string, index: number): boolean => {
  if (source[index] !== '/' || source[index + 1] === '/' || source[index + 1] === '*') {
    return false;
  }

  const previousIndex = previousSignificantIndex(source, index);
  return (
    previousIndex === -1 ||
    HashSet.has(regexPrefixChars, source[previousIndex]) ||
    HashSet.has(regexPrefixWords, wordBefore(source, index))
  );
};

const regexFlagsEndIndex = (source: string, index: number): number =>
  pipe(
    scanIndexes(index + 1, source.length - 1),
    Array.reduce(
      { flagsEndIndex: index, isDone: false },
      (state, cursor): { flagsEndIndex: number; isDone: boolean } => {
        if (state.isDone || !isASCIILetter(source, cursor)) {
          return { flagsEndIndex: state.flagsEndIndex, isDone: true };
        }
        return { flagsEndIndex: cursor, isDone: false };
      },
    ),
    (state): number => state.flagsEndIndex,
  );

const scanREGEXDelimiter = (
  source: string,
  index: number,
  isCharacterClass: boolean,
): REGEXScanResult | undefined => {
  const char = source[index];
  if (char === '\n') {
    return { endIndex: -1, isCharacterClass, isEscaped: false };
  }
  if (char === '/' && !isCharacterClass) {
    return { endIndex: regexFlagsEndIndex(source, index), isCharacterClass, isEscaped: false };
  }
  return undefined;
};

const scanREGEXCharacterClass = (char: string, isCharacterClass: boolean): REGEXScanResult => {
  if (char === '[') {
    return { isCharacterClass: true, isEscaped: false };
  }
  if (char === ']') {
    return { isCharacterClass: false, isEscaped: false };
  }
  return { isCharacterClass, isEscaped: false };
};

const scanREGEXLiteralChar = (
  source: string,
  index: number,
  isEscaped: boolean,
  isCharacterClass: boolean,
): REGEXScanResult => {
  const char = source[index];
  if (isEscaped) {
    return { isCharacterClass, isEscaped: false };
  }
  if (char === '\\') {
    return { isCharacterClass, isEscaped: true };
  }
  return pipe(
    Option.fromNullable(scanREGEXDelimiter(source, index, isCharacterClass)),
    Option.getOrElse((): REGEXScanResult => scanREGEXCharacterClass(char, isCharacterClass)),
  );
};

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const findREGEXLiteralEnd = (source: string, startIndex: number): number =>
  pipe(
    scanIndexes(startIndex + 1, source.length - 1),
    Array.reduce(
      { endIndex: startIndex, isCharacterClass: false, isDone: false, isEscaped: false },
      (state, index): REGEXReduceState => {
        if (state.isDone) {
          return state;
        }
        const result = scanREGEXLiteralChar(source, index, state.isEscaped, state.isCharacterClass);
        return pipe(
          Option.fromNullable(result.endIndex),
          Option.match({
            onNone: (): REGEXReduceState => ({
              endIndex: startIndex,
              isCharacterClass: result.isCharacterClass,
              isDone: false,
              isEscaped: result.isEscaped,
            }),
            onSome: (endIndex): REGEXReduceState => {
              if (endIndex === -1) {
                return { ...state, endIndex: startIndex, isDone: true };
              }
              return { ...state, endIndex, isDone: true };
            },
          }),
        );
      },
    ),
    (state): number => state.endIndex,
  );
