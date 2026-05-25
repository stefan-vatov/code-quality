/* -------------------------------------------------------------------------- */
/*          Codemod for internal exported declaration documentation.          */
/* -------------------------------------------------------------------------- */
import type { ExportNamedDeclaration, Statement } from 'jscodeshift';
import { formatJSDoc } from './comment-format';
import jscodeshift from 'jscodeshift';

interface Insertion {
  position: number;
  text: string;
}

const internalExportDoc = formatJSDoc({
  summary: 'Internal helper exported for package-local composition.',
  tags: ['@internal'],
});
const internalHeaderScanLength = 240;
const codemodAPI = jscodeshift.withParser('ts');

const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const nodeStart = (node: unknown): number => {
  if (isObjectRecord(node)) {
    const { start } = node;
    if (typeof start === 'number') {
      return start;
    }
  }
  throw new Error('jscodeshift node is missing a start offset');
};

const hasInternalFileHeader = (source: string): boolean => {
  const trimmedStart = source.trimStart();
  return (
    trimmedStart.startsWith('/**') &&
    trimmedStart.slice(0, internalHeaderScanLength).includes('@internal')
  );
};

const isExportedDeclarationStatement = (
  statement: Statement,
): statement is ExportNamedDeclaration =>
  statement.type === 'ExportNamedDeclaration' &&
  isObjectRecord(statement) &&
  Boolean(statement.declaration);

const commentStart = (comment: unknown): number | undefined => {
  if (isObjectRecord(comment)) {
    const { start } = comment;
    if (typeof start === 'number') {
      return start;
    }
  }
  return undefined;
};

const commentEnd = (comment: unknown): number | undefined => {
  if (isObjectRecord(comment)) {
    const { end } = comment;
    if (typeof end === 'number') {
      return end;
    }
  }
  return undefined;
};

const isJSDocComment = (source: string, comment: unknown): boolean => {
  const start = commentStart(comment);
  if (!isObjectRecord(comment) || comment.type !== 'CommentBlock' || start === undefined) {
    return false;
  }
  return source[start + 2] === '*';
};

const hasDeclarationJSDoc = (source: string, statement: Statement): boolean => {
  const comments = statement.comments ?? [];
  const declarationStart = nodeStart(statement);
  return comments.some((comment): boolean => {
    const start = commentStart(comment);
    const end = commentEnd(comment);
    if (start === undefined || end === undefined || !isJSDocComment(source, comment)) {
      return false;
    }
    if (start === 0) {
      return false;
    }
    return source.slice(end, declarationStart).trim() === '';
  });
};

const applyInsertions = (source: string, insertions: readonly Insertion[]): string =>
  [...insertions]
    .sort((left, right) => right.position - left.position)
    .reduce(
      (current, insertion): string =>
        current.slice(0, insertion.position) + insertion.text + current.slice(insertion.position),
      source,
    );

const internalExportDocInsertions = (source: string): readonly Insertion[] => {
  const program = codemodAPI(source).find(codemodAPI.Program).paths()[0]?.value;
  if (!program) {
    return [];
  }
  return program.body.flatMap((statement): Insertion[] => {
    if (!isExportedDeclarationStatement(statement) || hasDeclarationJSDoc(source, statement)) {
      return [];
    }
    return [{ position: nodeStart(statement), text: internalExportDoc }];
  });
};

/**
 * Adds explicit declaration-level `@internal` JSDoc to exports in internal files.
 *
 * @internal
 */
export const addInternalExportDocs = (source: string): string => {
  if (!hasInternalFileHeader(source) || !source.includes('export ')) {
    return source;
  }

  return applyInsertions(source, internalExportDocInsertions(source));
};
