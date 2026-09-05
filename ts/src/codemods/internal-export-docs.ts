/* -------------------------------------------------------------------------- */
/*          Codemod for internal exported declaration documentation.          */
/* -------------------------------------------------------------------------- */
import { Array, Option, Order, Predicate, pipe } from 'effect';
import type { Comment, ExportNamedDeclaration, Statement } from 'jscodeshift';
import { formatJSDoc } from './comment-format';
import jscodeshift from 'jscodeshift';
import { nodeStart } from './ast-helpers';

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

const hasInternalFileHeader = (source: string): boolean => {
  const trimmedStart = source
    .trimStart()
    .replace(/^#![^\n]*(?:\n|$)/u, '')
    .trimStart();
  return (
    (trimmedStart.startsWith('/**') &&
      trimmedStart.slice(0, internalHeaderScanLength).includes('@internal')) ||
    (trimmedStart.startsWith('/*') &&
      trimmedStart.slice(0, internalHeaderScanLength).toLocaleLowerCase().includes('internal'))
  );
};

const isExportedDeclarationStatement = (
  statement: Statement,
): statement is ExportNamedDeclaration =>
  statement.type === 'ExportNamedDeclaration' &&
  'declaration' in statement &&
  statement.declaration !== null &&
  statement.declaration !== undefined;

const commentStart = (comment: Comment): number | undefined => {
  const start = 'start' in comment ? comment.start : undefined;
  return Predicate.isNumber(start) ? start : undefined;
};

const commentEnd = (comment: Comment): number | undefined => {
  const end = 'end' in comment ? comment.end : undefined;
  return Predicate.isNumber(end) ? end : undefined;
};

const isJSDocComment = (source: string, comment: Comment): boolean => {
  const start = commentStart(comment);
  return pipe(
    Option.some(comment),
    Option.filter((value): boolean => 'type' in value && value.type === 'CommentBlock'),
    Option.flatMap(() => Option.fromNullable(start)),
    Option.exists((value): boolean => source[value + 2] === '*'),
  );
};

const hasDeclarationJSDoc = (source: string, statement: Statement): boolean => {
  const comments = statement.comments ?? [];
  const declarationStart = nodeStart(statement);
  return pipe(
    comments,
    Array.some((comment): boolean => {
      const start = commentStart(comment);
      const end = commentEnd(comment);
      return pipe(
        Option.all({
          end: Option.fromNullable(end),
          start: Option.fromNullable(start),
        }),
        Option.filter(({ start: value }): boolean => value !== 0),
        Option.exists(
          ({ end: value }): boolean =>
            isJSDocComment(source, comment) && source.slice(value, declarationStart).trim() === '',
        ),
      );
    }),
  );
};

const applyInsertions = (source: string, insertions: readonly Insertion[]): string =>
  pipe(
    insertions,
    Array.sortWith((insertion) => -insertion.position, Order.number),
    Array.reduce(
      source,
      (current, insertion): string =>
        current.slice(0, insertion.position) + insertion.text + current.slice(insertion.position),
    ),
  );

const internalExportDocInsertions = (source: string): readonly Insertion[] => {
  const insertions: Insertion[] = [];

  codemodAPI(source)
    .find(codemodAPI.ExportNamedDeclaration)
    .forEach((path): void => {
      if (isExportedDeclarationStatement(path.value) && !hasDeclarationJSDoc(source, path.value)) {
        insertions.push({ position: nodeStart(path.value), text: internalExportDoc });
      }
    });

  return insertions;
};

/**
 * Adds explicit declaration-level `@internal` JSDoc to exports in internal files.
 *
 * @internal
 */
export const addInternalExportDocs = (source: string): string =>
  pipe(
    Option.some(source),
    Option.filter((value): boolean => hasInternalFileHeader(value) && value.includes('export ')),
    Option.match({
      onNone: (): string => source,
      onSome: (value): string => applyInsertions(value, internalExportDocInsertions(value)),
    }),
  );
