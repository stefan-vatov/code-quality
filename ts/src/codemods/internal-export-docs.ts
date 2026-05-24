/** @internal Codemod for internal exported declaration documentation. */
import ts from 'typescript';

interface Insertion {
  position: number;
  text: string;
}

const internalExportDoc = `/** Internal helper exported for package-local composition.
 *
 * @internal
 */
`;
const internalHeaderScanLength = 240;

const hasInternalFileHeader = (source: string): boolean => {
  const trimmedStart = source.trimStart();
  return (
    trimmedStart.startsWith('/**') &&
    trimmedStart.slice(0, internalHeaderScanLength).includes('@internal')
  );
};

const hasExportModifier = (node: ts.Node): boolean =>
  Boolean(
    ts.canHaveModifiers(node) &&
    ts
      .getModifiers(node)
      ?.some((modifier): boolean => modifier.kind === ts.SyntaxKind.ExportKeyword),
  );

const isExportedDeclarationStatement = (statement: ts.Statement): boolean =>
  (ts.isVariableStatement(statement) ||
    ts.isFunctionDeclaration(statement) ||
    ts.isClassDeclaration(statement) ||
    ts.isInterfaceDeclaration(statement) ||
    ts.isTypeAliasDeclaration(statement) ||
    ts.isEnumDeclaration(statement)) &&
  hasExportModifier(statement);

const hasDeclarationJSDoc = (source: string, statement: ts.Statement): boolean => {
  const comments = ts.getLeadingCommentRanges(source, statement.pos) ?? [];
  const declarationStart = statement.getStart();
  return comments.some((comment): boolean => {
    if (comment.kind !== ts.SyntaxKind.MultiLineCommentTrivia || source[comment.pos + 2] !== '*') {
      return false;
    }
    if (comment.pos === 0) {
      return false;
    }
    return source.slice(comment.end, declarationStart).trim() === '';
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

/**
 * Adds explicit declaration-level `@internal` JSDoc to exports in internal files.
 *
 * @internal
 */
export const addInternalExportDocs = (source: string): string => {
  if (!hasInternalFileHeader(source) || !source.includes('export ')) {
    return source;
  }

  const sourceFile = ts.createSourceFile('codemod.ts', source, ts.ScriptTarget.Latest, true);
  const insertions = sourceFile.statements.flatMap((statement): Insertion[] => {
    if (!isExportedDeclarationStatement(statement) || hasDeclarationJSDoc(source, statement)) {
      return [];
    }
    return [{ position: statement.getStart(sourceFile), text: internalExportDoc }];
  });

  return applyInsertions(source, insertions);
};
