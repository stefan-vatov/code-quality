/* -------------------------------------------------------------------------- */
/*            Oxlint plugin rule for removing commented-out code.             */
/* -------------------------------------------------------------------------- */
import { CHAR_CLASS, CLS_DIGIT, CLS_LOWER, CLS_UNDER, CLS_UPPER } from './char-class';
import { Match, pipe } from 'effect';
import {
  indexAfterLineEnding,
  isECMAScriptLineEnding,
  scanSourceComments,
} from './plugin-commented-out-code-source-scanner';
import type { ScannedComment } from './plugin-commented-out-code-source-scanner';
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

interface CommentToken {
  end?: number;
  range?: readonly number[];
  start?: number;
  type?: string;
  value?: string;
}

interface SourceCode {
  getAllComments?: () => readonly CommentToken[];
  getText?: () => string;
  text?: string;
}

interface Context {
  report: (descriptor: ReportDescriptor) => void;
  filename?: string;
  sourceCode?: SourceCode;
}

type VisitorMap = Record<string, ((node: never) => void) | undefined>;

const readSource = (context: Context): string => readCachedSource(context);

const removeRangeFix =
  (range: [number, number]): FixFunction =>
  (fixer: Fixer) =>
    fixer.removeRange(range);

const COMMENT_DIAGNOSTIC = diagnosticMessage({
  example: 'const live = computeValue();',
  fix: 'Delete the commented code. If it is still needed, restore it as live code with tests.',
  summary: 'Commented-out code is dead code and wastes agent context.',
});

const CHAR_CODE_FORM_FEED = 12;
const CHAR_CODE_DOLLAR = 36;
const CHAR_CODE_DOT = 46;
const CHAR_CODE_SPACE = 32;
const CHAR_CODE_STAR = 42;
const CHAR_CODE_TAB = 9;
const CHAR_CODE_VERTICAL_TAB = 11;
const IDENTIFIER_CLASS = CLS_UPPER | CLS_LOWER | CLS_DIGIT | CLS_UNDER;
const TOKEN_JOINING_PAIRS = new Set([
  '!=',
  '%=',
  '&&',
  '&=',
  '**',
  '*=',
  '++',
  '+=',
  '--',
  '-=',
  '->',
  '/*',
  '//',
  '/=',
  '<<',
  '<=',
  '==',
  '=>',
  '>=',
  '>>',
  '?.',
  '??',
  '^=',
  '|=',
  '||',
]);

const lineStartBefore = (source: string, start: number): number => {
  let index = start;
  while (index > 0) {
    if (isECMAScriptLineEnding(source.charCodeAt(index - 1))) {
      return index;
    }
    index -= 1;
  }
  return 0;
};

const isHorizontalWhitespace = (code: number): boolean =>
  code === CHAR_CODE_TAB ||
  code === CHAR_CODE_VERTICAL_TAB ||
  code === CHAR_CODE_FORM_FEED ||
  code === CHAR_CODE_SPACE;

const standaloneLineStart = (source: string, start: number): number | undefined => {
  const lineStart = lineStartBefore(source, start);
  for (let index = lineStart; index < start; index += 1) {
    if (!isHorizontalWhitespace(source.charCodeAt(index))) {
      return undefined;
    }
  }
  return lineStart;
};

const lineFixRange = (source: string, start: number, end: number): [number, number] => {
  const standaloneStart = standaloneLineStart(source, start);
  if (standaloneStart === undefined) {
    return [start, end];
  }
  return [standaloneStart, indexAfterLineEnding(source, end)];
};

const isIdentifierLike = (code: number): boolean =>
  (CHAR_CLASS[code] & IDENTIFIER_CLASS) !== 0 ||
  code === CHAR_CODE_DOLLAR ||
  code >= CHAR_CLASS.length;

const isDigit = (code: number): boolean => (CHAR_CLASS[code] & CLS_DIGIT) !== 0;

const isTokenJoiningOperator = (left: number, right: number): boolean =>
  TOKEN_JOINING_PAIRS.has(String.fromCharCode(left, right)) ||
  (left === CHAR_CODE_DOT && isDigit(right)) ||
  (isDigit(left) && right === CHAR_CODE_DOT);

const wouldMergeTokens = (source: string, start: number, end: number): boolean => {
  if (start === 0 || end === source.length) {
    return false;
  }
  const left = source.charCodeAt(start - 1);
  const right = source.charCodeAt(end);
  return (isIdentifierLike(left) && isIdentifierLike(right)) || isTokenJoiningOperator(left, right);
};

const containsLineEnding = (source: string, start: number, end: number): boolean => {
  for (let index = start; index < end; index += 1) {
    if (isECMAScriptLineEnding(source.charCodeAt(index))) {
      return true;
    }
  }
  return false;
};

const blockFixRange = (
  source: string,
  start: number,
  end: number,
): [number, number] | undefined => {
  if (containsLineEnding(source, start, end) || wouldMergeTokens(source, start, end)) {
    return undefined;
  }
  return [start, end];
};

const reportDescriptor = (node: object, range: [number, number] | undefined): ReportDescriptor => {
  if (range === undefined) {
    return { message: COMMENT_DIAGNOSTIC, node };
  }
  return { fix: removeRangeFix(range), message: COMMENT_DIAGNOSTIC, node };
};

const reportComment = (
  context: Context,
  node: object,
  body: string,
  range: [number, number] | undefined,
): void => {
  if (isCommentedOutCode(body)) {
    context.report(reportDescriptor(node, range));
  }
};

const withCreateOnce = <
  RuleWithCreateOnce extends { createOnce: (context: Context) => VisitorMap },
>(
  rule: RuleWithCreateOnce,
): RuleWithCreateOnce & { create: RuleWithCreateOnce['createOnce'] } =>
  Object.assign(rule, { create: rule.createOnce });

const fallbackFixRange = (
  source: string,
  comment: ScannedComment,
): [number, number] | undefined => {
  if (comment.type === 'Line') {
    return lineFixRange(source, comment.start, comment.end);
  }
  return blockFixRange(source, comment.start, comment.end);
};

const reportScannedComment = (
  context: Context,
  node: object,
  source: string,
  comment: ScannedComment,
): void => {
  reportComment(
    context,
    node,
    source.slice(comment.bodyStart, comment.bodyEnd),
    fallbackFixRange(source, comment),
  );
};

const reportCommentedOutCode = (context: Context, node: object, source: string): void => {
  scanSourceComments(source, (comment): void => {
    reportScannedComment(context, node, source, comment);
  });
};

const tokenBoundary = (
  directBoundary: number | undefined,
  rangeBoundary: number | undefined,
): number | undefined => directBoundary ?? rangeBoundary;

const isValidCommentRange = (
  start: number | undefined,
  end: number | undefined,
  sourceLength: number,
): start is number =>
  start !== undefined && end !== undefined && start >= 0 && end >= start && end <= sourceLength;

const isCommentType = (type: string | undefined): type is 'Block' | 'Line' =>
  type === 'Block' || type === 'Line';

const tokenBodyEnd = (source: string, end: number, type: 'Block' | 'Line'): number => {
  if (type === 'Block' && source.charCodeAt(end - 2) === CHAR_CODE_STAR) {
    return end - 2;
  }
  return end;
};

const tokenBody = (
  source: string,
  token: CommentToken,
  start: number,
  end: number,
  type: 'Block' | 'Line',
): string => {
  if (token.value !== undefined) {
    return token.value;
  }
  return source.slice(start + 2, tokenBodyEnd(source, end, type));
};

const tokenFixRange = (
  source: string,
  start: number,
  end: number,
  type: 'Block' | 'Line',
): [number, number] | undefined => {
  if (type === 'Line') {
    return lineFixRange(source, start, end);
  }
  return blockFixRange(source, start, end);
};

const reportNativeComment = (
  context: Context,
  node: object,
  source: string,
  token: CommentToken,
): void => {
  const start = tokenBoundary(token.start, token.range?.[0]);
  const end = tokenBoundary(token.end, token.range?.[1]);
  if (!isValidCommentRange(start, end, source.length) || end === undefined) {
    return;
  }

  const { type } = token;
  if (!isCommentType(type)) {
    return;
  }

  reportComment(
    context,
    node,
    tokenBody(source, token, start, end, type),
    tokenFixRange(source, start, end, type),
  );
};

const reportNativeComments = (
  context: Context,
  node: object,
  source: string,
  comments: readonly CommentToken[],
): void => {
  for (const token of comments) {
    reportNativeComment(context, node, source, token);
  }
};

const reportAvailableComments = (context: Context, node: object, source: string): void => {
  const { sourceCode } = context;
  if (sourceCode?.getAllComments === undefined) {
    reportCommentedOutCode(context, node, source);
    return;
  }
  reportNativeComments(context, node, source, sourceCode.getAllComments());
};

const noCommentedOutCodeRule = withCreateOnce({
  createOnce(context: Context) {
    return {
      Program(node: object): void {
        const source = readSource(context);
        pipe(
          Match.value(source),
          Match.when('', (): void => undefined),
          Match.orElse((value): void => {
            reportAvailableComments(context, node, value);
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
