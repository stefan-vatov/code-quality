/* -------------------------------------------------------------------------- */
/*            Oxlint plugin rule for removing commented-out code.             */
/* -------------------------------------------------------------------------- */
import { Array, HashSet, Match, Option, pipe } from 'effect';
import { diagnosticMessage } from './diagnostic-guidance';
import isCommentedOutCode from './no-commented-out-code';
import { readCachedSource } from './source-cache';

interface Fix {
  range: [number, number];
  text: string;
}

interface Fixer {
  removeRange(range: [number, number]): Fix;
}

type FixFunction = (fixer: Fixer) => Fix;

interface ReportDescriptor {
  fix?: FixFunction;
  message: string;
  node: object;
}

interface Context {
  report: (descriptor: ReportDescriptor) => void;
  filename?: string;
}

type VisitorMap = Record<string, ((node: never) => void) | undefined>;

interface CommentStart {
  index: number;
  kind: 'block' | 'line';
}

const quoteCharacters = HashSet.make("'", '"', '`');

const scanIndexes = (startIndex: number, endIndex: number): readonly number[] =>
  Match.value(startIndex).pipe(
    Match.when(
      (value): boolean => value > endIndex,
      () => [],
    ),
    Match.orElse((value): readonly number[] => Array.range(value, endIndex)),
  );

const readSource = (context: Context): string => readCachedSource(context);

const removeRangeFix =
  (range: [number, number]): FixFunction =>
  (fixer: Fixer) =>
    fixer.removeRange(range);

const nextIndexInQuote = (
  char: string,
  quote: string,
  index: number,
): { index: number; quote: string } =>
  Match.value(char).pipe(
    Match.when('\\', (): { index: number; quote: string } => ({ index: index + 2, quote })),
    Match.when(
      (value): boolean => value === quote,
      (): { index: number; quote: string } => ({ index: index + 1, quote: '' }),
    ),
    Match.orElse((): { index: number; quote: string } => ({ index: index + 1, quote })),
  );

const quoteStart = (char: string): string | undefined =>
  Match.value(char).pipe(
    Match.when(
      (value): boolean => HashSet.has(quoteCharacters, value),
      (value): string => value,
    ),
    Match.orElse((): undefined => undefined),
  );

const commentStartAt = (source: string, index: number): CommentStart | undefined =>
  Match.value({ char: source[index], nextChar: source[index + 1] }).pipe(
    Match.when(
      ({ char, nextChar }): boolean => char === '/' && nextChar === '/',
      (): CommentStart => ({ index, kind: 'line' }),
    ),
    Match.when(
      ({ char, nextChar }): boolean => char === '/' && nextChar === '*',
      (): CommentStart => ({ index, kind: 'block' }),
    ),
    Match.orElse((): undefined => undefined),
  );

const nextCommentScanStep = (
  source: string,
  index: number,
  quote: string,
): { commentStart?: CommentStart; index: number; quote: string } => {
  const char = source[index];
  return Match.value(quote).pipe(
    Match.when(
      (value): boolean => value !== '',
      (value): { commentStart?: CommentStart; index: number; quote: string } =>
        nextIndexInQuote(char, value, index),
    ),
    Match.orElse((): { commentStart?: CommentStart; index: number; quote: string } =>
      pipe(
        Option.fromNullable(quoteStart(char)),
        Option.match({
          onNone: (): { commentStart?: CommentStart; index: number; quote: string } =>
            pipe(
              Option.fromNullable(commentStartAt(source, index)),
              Option.match({
                onNone: (): { commentStart?: CommentStart; index: number; quote: string } => ({
                  index: index + 1,
                  quote,
                }),
                onSome: (
                  commentStart,
                ): {
                  commentStart?: CommentStart;
                  index: number;
                  quote: string;
                } => ({
                  commentStart,
                  index,
                  quote,
                }),
              }),
            ),
          onSome: (nextQuote): { commentStart?: CommentStart; index: number; quote: string } => ({
            index: index + 1,
            quote: nextQuote,
          }),
        }),
      ),
    ),
  );
};

const findNextCommentStart = (source: string, start: number): CommentStart | undefined =>
  pipe(
    scanIndexes(start, source.length - 1),
    Array.reduce(
      { commentStart: undefined as CommentStart | undefined, index: start, quote: '' },
      (
        state,
        scanIndex,
      ): { commentStart: CommentStart | undefined; index: number; quote: string } =>
        Match.value(state.commentStart !== undefined || scanIndex < state.index).pipe(
          Match.when(true, () => state),
          Match.orElse(() => {
            const step = nextCommentScanStep(source, scanIndex, state.quote);
            return {
              commentStart: step.commentStart,
              index: step.index,
              quote: step.quote,
            };
          }),
        ),
    ),
    (state): CommentStart | undefined => state.commentStart,
  );

const withCreateOnce = <
  RuleWithCreateOnce extends { createOnce: (context: Context) => VisitorMap },
>(
  rule: RuleWithCreateOnce,
): RuleWithCreateOnce & { create: RuleWithCreateOnce['createOnce'] } =>
  Object.assign(rule, { create: rule.createOnce });

const rangeEndForComment = (bodyEnd: number, sourceLength: number, suffixLength: number): number =>
  Match.value(bodyEnd).pipe(
    Match.when(-1, (): number => sourceLength),
    Match.orElse((end): number => end + suffixLength),
  );

const nextSearchStart = (bodyEnd: number, sourceLength: number, suffixLength: number): number =>
  rangeEndForComment(bodyEnd, sourceLength, suffixLength);

const reportBlockCommentedOutCode = (
  context: Context,
  node: object,
  source: string,
  start: number,
): number => {
  const bodyStart = start + 2;
  const bodyEnd = source.indexOf('*/', bodyStart);
  const commentEnd = rangeEndForComment(bodyEnd, source.length, 0);
  pipe(
    Match.value(isCommentedOutCode(source.slice(bodyStart, commentEnd))),
    Match.when(true, (): void => {
      context.report({
        fix: removeRangeFix([start, rangeEndForComment(bodyEnd, source.length, 2)]),
        message: diagnosticMessage({
          example: 'const live = computeValue();',
          fix: 'Delete the commented code. If it is still needed, restore it as live code with tests.',
          summary: 'Commented-out code is dead code and wastes agent context.',
        }),
        node,
      });
    }),
    Match.orElse((): void => undefined),
  );
  return nextSearchStart(bodyEnd, source.length, 2);
};

const reportLineCommentedOutCode = (
  context: Context,
  node: object,
  source: string,
  start: number,
): number => {
  const bodyStart = start + 2;
  const bodyEnd = source.indexOf('\n', bodyStart);
  const commentEnd = rangeEndForComment(bodyEnd, source.length, 0);
  pipe(
    Match.value(isCommentedOutCode(source.slice(bodyStart, commentEnd))),
    Match.when(true, (): void => {
      context.report({
        fix: removeRangeFix([start, rangeEndForComment(bodyEnd, source.length, 1)]),
        message: diagnosticMessage({
          example: 'const live = computeValue();',
          fix: 'Delete the commented code. If it is still needed, restore it as live code with tests.',
          summary: 'Commented-out code is dead code and wastes agent context.',
        }),
        node,
      });
    }),
    Match.orElse((): void => undefined),
  );
  return nextSearchStart(bodyEnd, source.length, 1);
};

const reportNextCommentedOutCode = (
  context: Context,
  node: object,
  source: string,
  start: number,
): { isDone: boolean; searchStart: number } =>
  pipe(
    Option.fromNullable(findNextCommentStart(source, start)),
    Option.match({
      onNone: (): { isDone: boolean; searchStart: number } => ({
        isDone: true,
        searchStart: start,
      }),
      onSome: (commentStart): { isDone: boolean; searchStart: number } => ({
        isDone: false,
        searchStart: Match.value(commentStart.kind).pipe(
          Match.when('block', (): number =>
            reportBlockCommentedOutCode(context, node, source, commentStart.index),
          ),
          Match.orElse((): number =>
            reportLineCommentedOutCode(context, node, source, commentStart.index),
          ),
        ),
      }),
    }),
  );

const reportCommentedOutCode = (context: Context, node: object, source: string): void =>
  void pipe(
    scanIndexes(0, source.length - 1),
    Array.reduce(
      { isDone: false, searchStart: 0 },
      (
        state,
        scanIndex,
      ): {
        isDone: boolean;
        searchStart: number;
      } =>
        Match.value(state.isDone || scanIndex < state.searchStart).pipe(
          Match.when(true, () => state),
          Match.orElse(() => reportNextCommentedOutCode(context, node, source, scanIndex)),
        ),
    ),
  );

const noCommentedOutCodeRule = withCreateOnce({
  createOnce(context: Context) {
    return {
      Program(node: object): void {
        const source = readSource(context);
        pipe(
          Match.value(source),
          Match.when('', (): void => undefined),
          Match.orElse((value): void => {
            reportCommentedOutCode(context, node, value);
          }),
        );
      },
    };
  },
  meta: {
    fixable: 'code',
    type: 'problem',
  },
});

export default noCommentedOutCodeRule;
