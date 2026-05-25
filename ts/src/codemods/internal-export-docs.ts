/* -------------------------------------------------------------------------- */
/*          Codemod for internal exported declaration documentation.          */
/* -------------------------------------------------------------------------- */
import { Array, Option, Order, Predicate, pipe } from 'effect';
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
  Predicate.isObject(value);

const nodeStart = (node: unknown): number =>
  pipe(
    Option.some(node),
    Option.filter(isObjectRecord),
    Option.flatMapNullable((value) => value.start),
    Option.filter(Predicate.isNumber),
    Option.getOrThrowWith(() => new Error('jscodeshift node is missing a start offset')),
  );

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

const commentStart = (comment: unknown): number | undefined =>
  pipe(
    Option.some(comment),
    Option.filter(isObjectRecord),
    Option.flatMapNullable((value) => value.start),
    Option.filter(Predicate.isNumber),
    Option.getOrUndefined,
  );

const commentEnd = (comment: unknown): number | undefined =>
  pipe(
    Option.some(comment),
    Option.filter(isObjectRecord),
    Option.flatMapNullable((value) => value.end),
    Option.filter(Predicate.isNumber),
    Option.getOrUndefined,
  );

const isJSDocComment = (source: string, comment: unknown): boolean => {
  const start = commentStart(comment);
  return pipe(
    Option.some(comment),
    Option.filter(isObjectRecord),
    Option.filter((value): boolean => value.type === 'CommentBlock'),
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
  const program = codemodAPI(source).find(codemodAPI.Program).paths()[0]?.value;
  return pipe(
    Option.fromNullable(program),
    Option.map((value) =>
      pipe(
        value.body,
        Array.filter(
          (statement): statement is ExportNamedDeclaration =>
            isExportedDeclarationStatement(statement) && !hasDeclarationJSDoc(source, statement),
        ),
        Array.map(
          (statement): Insertion => ({ position: nodeStart(statement), text: internalExportDoc }),
        ),
      ),
    ),
    Option.getOrElse((): readonly Insertion[] => []),
  );
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
