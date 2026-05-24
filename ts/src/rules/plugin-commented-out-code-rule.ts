/* -------------------------------------------------------------------------- */
/*            Oxlint plugin rule for removing commented-out code.             */
/* -------------------------------------------------------------------------- */
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

const readSource = (context: Context): string => readCachedSource(context);

const removeRangeFix =
  (range: [number, number]): FixFunction =>
  (fixer: Fixer) =>
    fixer.removeRange(range);

const nextIndexInQuote = (
  char: string,
  quote: string,
  index: number,
): { index: number; quote: string } => {
  if (char === '\\') {
    return { index: index + 2, quote };
  }
  if (char === quote) {
    return { index: index + 1, quote: '' };
  }
  return { index: index + 1, quote };
};

const quoteStart = (char: string): string | undefined => {
  if (char === "'" || char === '"' || char === '`') {
    return char;
  }
  return undefined;
};

const commentStartAt = (source: string, index: number): CommentStart | undefined => {
  if (source[index] === '/' && source[index + 1] === '/') {
    return { index, kind: 'line' };
  }
  if (source[index] === '/' && source[index + 1] === '*') {
    return { index, kind: 'block' };
  }
  return undefined;
};

const nextCommentScanStep = (
  source: string,
  index: number,
  quote: string,
): { commentStart?: CommentStart; index: number; quote: string } => {
  const char = source[index];
  if (quote !== '') {
    return nextIndexInQuote(char, quote, index);
  }
  const nextQuote = quoteStart(char);
  if (nextQuote) {
    return { index: index + 1, quote: nextQuote };
  }
  const commentStart = commentStartAt(source, index);
  if (commentStart) {
    return { commentStart, index, quote };
  }
  return { index: index + 1, quote };
};

const findNextCommentStart = (source: string, start: number): CommentStart | undefined => {
  let index = start;
  let quote = '';

  while (index < source.length) {
    const step = nextCommentScanStep(source, index, quote);
    if (step.commentStart) {
      return step.commentStart;
    }
    ({ index, quote } = step);
  }

  return undefined;
};

const withCreateOnce = <
  RuleWithCreateOnce extends { createOnce: (context: Context) => VisitorMap },
>(
  rule: RuleWithCreateOnce,
): RuleWithCreateOnce & { create: RuleWithCreateOnce['createOnce'] } =>
  Object.assign(rule, { create: rule.createOnce });

const rangeEndForComment = (
  bodyEnd: number,
  sourceLength: number,
  suffixLength: number,
): number => {
  if (bodyEnd === -1) {
    return sourceLength;
  }
  return bodyEnd + suffixLength;
};

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
  if (isCommentedOutCode(source.slice(bodyStart, commentEnd))) {
    context.report({
      fix: removeRangeFix([start, rangeEndForComment(bodyEnd, source.length, 2)]),
      message: 'Remove this commented-out code instead of leaving it dead.',
      node,
    });
  }
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
  if (isCommentedOutCode(source.slice(bodyStart, commentEnd))) {
    context.report({
      fix: removeRangeFix([start, rangeEndForComment(bodyEnd, source.length, 1)]),
      message: 'Remove this commented-out code instead of leaving it dead.',
      node,
    });
  }
  return nextSearchStart(bodyEnd, source.length, 1);
};

const reportCommentedOutCode = (context: Context, node: object, source: string): void => {
  let searchStart = 0;
  while (searchStart < source.length) {
    const commentStart = findNextCommentStart(source, searchStart);
    if (!commentStart) {
      return;
    }

    if (commentStart.kind === 'block') {
      searchStart = reportBlockCommentedOutCode(context, node, source, commentStart.index);
    } else {
      searchStart = reportLineCommentedOutCode(context, node, source, commentStart.index);
    }
  }
};

const noCommentedOutCodeRule = withCreateOnce({
  createOnce(context: Context) {
    return {
      Program(node: object): void {
        const source = readSource(context);
        if (!source) {
          return;
        }

        reportCommentedOutCode(context, node, source);
      },
    };
  },
  meta: {
    fixable: 'code',
    type: 'problem',
  },
});

export default noCommentedOutCodeRule;
