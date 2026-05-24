/**
 * Conservative codemod for local export-list rewrites.
 *
 * @internal
 */
import ts from 'typescript';

interface Replacement {
  end: number;
  start: number;
  text: string;
}

interface ExportList {
  names: readonly string[];
  range: Replacement;
}

const exportKeyword = 'export ';

const applyReplacements = (source: string, replacements: readonly Replacement[]): string =>
  [...replacements]
    .sort((left, right) => right.start - left.start)
    .reduce(
      (current, replacement) =>
        current.slice(0, replacement.start) + replacement.text + current.slice(replacement.end),
      source,
    );

const hasExportModifier = (node: ts.Node): boolean =>
  Boolean(
    ts.canHaveModifiers(node) &&
    ts
      .getModifiers(node)
      ?.some((modifier): boolean => modifier.kind === ts.SyntaxKind.ExportKeyword),
  );

const lineEndAfter = (source: string, position: number): number => {
  const newline = source.indexOf('\n', position);
  if (newline === -1) {
    return source.length;
  }
  return newline + 1;
};

const localExportListFor = (
  source: string,
  sourceFile: ts.SourceFile,
  node: ts.ExportDeclaration,
): ExportList | undefined => {
  if (node.moduleSpecifier || !node.exportClause || !ts.isNamedExports(node.exportClause)) {
    return undefined;
  }

  const names: string[] = [];
  for (const element of node.exportClause.elements) {
    if (element.propertyName) {
      return undefined;
    }
    names.push(element.name.text);
  }

  return {
    names,
    range: {
      end: lineEndAfter(source, node.getEnd()),
      start: node.getStart(sourceFile),
      text: '',
    },
  };
};

const variableStatementNames = (node: ts.VariableStatement): readonly string[] =>
  node.declarationList.declarations.flatMap((declaration): string[] => {
    if (ts.isIdentifier(declaration.name)) {
      return [declaration.name.text];
    }
    return [];
  });

const declarationName = (node: ts.Node): string | undefined => {
  if (
    (ts.isFunctionDeclaration(node) ||
      ts.isClassDeclaration(node) ||
      ts.isInterfaceDeclaration(node) ||
      ts.isTypeAliasDeclaration(node) ||
      ts.isEnumDeclaration(node)) &&
    node.name
  ) {
    return node.name.text;
  }
  return undefined;
};

const declarationNames = (node: ts.Statement): readonly string[] => {
  if (ts.isVariableStatement(node)) {
    return variableStatementNames(node);
  }
  const name = declarationName(node);
  if (name) {
    return [name];
  }
  return [];
};

const inlineExportReplacement = (
  sourceFile: ts.SourceFile,
  statement: ts.Statement,
): Replacement | undefined => {
  if (hasExportModifier(statement)) {
    return undefined;
  }
  return {
    end: statement.getStart(sourceFile),
    start: statement.getStart(sourceFile),
    text: exportKeyword,
  };
};

const collectExportListReplacements = (
  source: string,
  sourceFile: ts.SourceFile,
): Replacement[] => {
  const exportLists = sourceFile.statements.flatMap((statement): ExportList[] => {
    if (ts.isExportDeclaration(statement)) {
      const exportList = localExportListFor(source, sourceFile, statement);
      if (exportList) {
        return [exportList];
      }
      return [];
    }
    return [];
  });
  const names = new Set(exportLists.flatMap((exportList) => [...exportList.names]));
  const replacements: Replacement[] = exportLists.map((exportList) => exportList.range);

  for (const statement of sourceFile.statements) {
    if (declarationNames(statement).some((name) => names.has(name))) {
      const replacement = inlineExportReplacement(sourceFile, statement);
      if (replacement) {
        replacements.push(replacement);
      }
    }
  }

  return replacements;
};

/**
 * Rewrites safe local export lists into inline exported declarations.
 *
 * @internal
 */
export const inlineLocalExportLists = (source: string): string => {
  const sourceFile = ts.createSourceFile('codemod.ts', source, ts.ScriptTarget.Latest, true);
  return applyReplacements(source, collectExportListReplacements(source, sourceFile));
};
