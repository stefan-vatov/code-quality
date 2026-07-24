/* -------------------------------------------------------------------------- */
/*      Source navigation helpers for Effect lint rule implementations.       */
/* -------------------------------------------------------------------------- */
import { Array, Match, Option, pipe } from 'effect';
import { findBalancedCallEnd, findMatchingBrace } from './effect-source-scan';
import { nextSourceLexicalIndex } from './effect-source-navigation-lexer';

const CHAR_CODE_BRACE_CLOSE = 125;
const CHAR_CODE_BRACE_OPEN = 123;
const CHAR_CODE_BRACKET_CLOSE = 93;
const CHAR_CODE_BRACKET_OPEN = 91;
const CHAR_CODE_PAREN_CLOSE = 41;
const CHAR_CODE_PAREN_OPEN = 40;
const CHAR_CODE_SEMICOLON = 59;

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

interface StatementEnd {
  endIndex: number;
  isEnd: boolean;
}

const nextEnclosingBraceScanIndex = (
  source: string,
  targetIndex: number,
  stack: number[],
  index: number,
): number => {
  const charCode = source.charCodeAt(index);
  const nextIndex = nextSourceLexicalIndex(source, index, targetIndex, charCode);
  if (nextIndex !== index) {
    return nextIndex;
  }
  if (charCode === CHAR_CODE_BRACE_OPEN) {
    stack.push(index);
  } else if (charCode === CHAR_CODE_BRACE_CLOSE) {
    stack.pop();
  }
  return index + 1;
};

const findEnclosingBraceOpen = (source: string, targetIndex: number): number => {
  const stack: number[] = [];
  let index = 0;
  while (index < targetIndex) {
    index = nextEnclosingBraceScanIndex(source, targetIndex, stack, index);
  }
  return stack.at(-1) ?? -1;
};

const isDelimiterOpen = (charCode: number): boolean =>
  charCode === CHAR_CODE_BRACE_OPEN ||
  charCode === CHAR_CODE_BRACKET_OPEN ||
  charCode === CHAR_CODE_PAREN_OPEN;

const isDelimiterClose = (charCode: number): boolean =>
  charCode === CHAR_CODE_BRACE_CLOSE ||
  charCode === CHAR_CODE_BRACKET_CLOSE ||
  charCode === CHAR_CODE_PAREN_CLOSE;

const hasTargetStackPrefix = (
  stack: readonly number[],
  targetStack: readonly number[],
): boolean => {
  if (stack.length > targetStack.length) {
    return false;
  }
  for (let index = 0; index < stack.length; index += 1) {
    if (stack[index] !== targetStack[index]) {
      return false;
    }
  }
  return true;
};

interface StatementScanState {
  delimiterStack: number[];
  index: number;
  targetStack: readonly number[] | undefined;
}

interface StatementScanStep {
  state: StatementScanState;
  statementEnd: StatementEnd | undefined;
}

const captureTargetStack = (
  state: StatementScanState,
  startIndex: number,
  nextIndex: number,
): readonly number[] | undefined => {
  if (state.targetStack !== undefined) {
    return state.targetStack;
  }
  if (state.index === startIndex || (startIndex >= state.index && startIndex < nextIndex)) {
    return [...state.delimiterStack];
  }
  return undefined;
};

const updateDelimiterStack = (delimiterStack: number[], charCode: number, index: number): void => {
  if (isDelimiterOpen(charCode)) {
    delimiterStack.push(index);
  } else if (isDelimiterClose(charCode)) {
    delimiterStack.pop();
  }
};

const nextStatementScanStep = (
  source: string,
  sourceLength: number,
  startIndex: number,
  state: StatementScanState,
): StatementScanStep => {
  const charCode = source.charCodeAt(state.index);
  const nextIndex = nextSourceLexicalIndex(source, state.index, sourceLength, charCode);
  const targetStack = captureTargetStack(state, startIndex, nextIndex);
  if (nextIndex !== state.index) {
    return { state: { ...state, index: nextIndex, targetStack }, statementEnd: undefined };
  }
  if (
    charCode === CHAR_CODE_SEMICOLON &&
    state.index >= startIndex &&
    hasTargetStackPrefix(state.delimiterStack, targetStack ?? state.delimiterStack)
  ) {
    return {
      state,
      statementEnd: { endIndex: state.index, isEnd: true },
    };
  }
  updateDelimiterStack(state.delimiterStack, charCode, state.index);
  return {
    state: { ...state, index: state.index + 1, targetStack },
    statementEnd: undefined,
  };
};

const scanStatementEnd = (source: string, startIndex: number): StatementEnd => {
  const sourceLength = source.length;
  let state: StatementScanState = { delimiterStack: [], index: 0, targetStack: undefined };
  while (state.index < sourceLength) {
    const step = nextStatementScanStep(source, sourceLength, startIndex, state);
    if (step.statementEnd !== undefined) {
      return step.statementEnd;
    }
    ({ state } = step);
  }
  return { endIndex: sourceLength - 1, isEnd: false };
};

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const findStatementEnd = (source: string, startIndex: number): number =>
  scanStatementEnd(source, startIndex).endIndex;

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
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
