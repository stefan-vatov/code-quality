/**
 * Conservative codemod for sorting top-level import declarations.
 *
 * @internal
 */
import ts from 'typescript';

interface Replacement {
  end: number;
  start: number;
  text: string;
}

const syntaxOrder = {
  all: 1,
  multiple: 2,
  none: 0,
  single: 3,
} as const;

const compareText = (left: string, right: string): number => {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
};

const applyReplacement = (source: string, replacement: Replacement | undefined): string => {
  if (!replacement) {
    return source;
  }
  return source.slice(0, replacement.start) + replacement.text + source.slice(replacement.end);
};

const importSyntaxKind = (statement: ts.ImportDeclaration): keyof typeof syntaxOrder => {
  const clause = statement.importClause;
  if (!clause) {
    return 'none';
  }
  if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) {
    return 'all';
  }
  if (
    clause.namedBindings &&
    ts.isNamedImports(clause.namedBindings) &&
    (clause.name || clause.namedBindings.elements.length > 1)
  ) {
    return 'multiple';
  }
  return 'single';
};

const importSpecifierKey = (specifier: ts.ImportSpecifier): string =>
  (specifier.propertyName ?? specifier.name).text;

const namedImportSortKey = (namedBindings: ts.NamedImportBindings): string => {
  if (ts.isNamespaceImport(namedBindings)) {
    return namedBindings.name.text;
  }
  const [firstSpecifier] = namedBindings.elements;
  if (firstSpecifier) {
    return importSpecifierKey(firstSpecifier);
  }
  return '';
};

const importSortKey = (statement: ts.ImportDeclaration): string => {
  const clause = statement.importClause;
  if (!clause) {
    return '';
  }
  if (clause.name) {
    return clause.name.text;
  }
  const { namedBindings } = clause;
  if (!namedBindings) {
    return '';
  }
  return namedImportSortKey(namedBindings);
};

const importSpecifierText = (specifier: ts.ImportSpecifier): string => {
  const typePrefix = ((): string => {
    if (specifier.isTypeOnly) {
      return 'type ';
    }
    return '';
  })();
  const importedName = specifier.propertyName?.text;
  const localName = specifier.name.text;
  if (importedName && importedName !== localName) {
    return `${typePrefix}${importedName} as ${localName}`;
  }
  return `${typePrefix}${localName}`;
};

const sortedNamedImportText = (bindings: ts.NamedImports, isMultiline: boolean): string => {
  const sorted = [...bindings.elements].sort((left, right) =>
    compareText(importSpecifierKey(left), importSpecifierKey(right)),
  );
  const specifiers = sorted.map(importSpecifierText);

  if (isMultiline) {
    return `{\n  ${specifiers.join(',\n  ')},\n}`;
  }
  return `{ ${specifiers.join(', ')} }`;
};

const typePrefixForClause = (clause: ts.ImportClause): string => {
  if (clause.isTypeOnly) {
    return 'type ';
  }
  return '';
};

const defaultPrefixForClause = (clause: ts.ImportClause): string => {
  if (clause.name) {
    return `${clause.name.text}, `;
  }
  return '';
};

const importWithNamespaceText = (
  typePrefix: string,
  defaultPrefix: string,
  namedBindings: ts.NamespaceImport,
  moduleText: string,
): string =>
  `import ${typePrefix}${defaultPrefix}* as ${namedBindings.name.text} from ${moduleText};`;

interface NamedImportTextInput {
  source: string;
  statement: ts.ImportDeclaration;
  typePrefix: string;
  defaultPrefix: string;
  namedBindings: ts.NamedImports;
  moduleText: string;
}

const importWithNamedText = (input: NamedImportTextInput): string => {
  const { defaultPrefix, moduleText, namedBindings, source, statement, typePrefix } = input;
  const originalText = source.slice(statement.getStart(), statement.getEnd());
  const isMultiline = originalText.includes('\n');
  return `import ${typePrefix}${defaultPrefix}${sortedNamedImportText(namedBindings, isMultiline)} from ${moduleText};`;
};

const importTextParts = (
  source: string,
  statement: ts.ImportDeclaration,
): Omit<NamedImportTextInput, 'namedBindings'> & {
  clause: ts.ImportClause;
} => {
  const clause = statement.importClause;
  if (!clause) {
    throw new Error('Import clause is required for import text parts');
  }
  return {
    clause,
    defaultPrefix: defaultPrefixForClause(clause),
    moduleText: source.slice(
      statement.moduleSpecifier.getStart(),
      statement.moduleSpecifier.getEnd(),
    ),
    source,
    statement,
    typePrefix: typePrefixForClause(clause),
  };
};

const importText = (source: string, statement: ts.ImportDeclaration): string => {
  const clause = statement.importClause;
  if (!clause) {
    return source.slice(statement.getStart(), statement.getEnd());
  }

  const parts = importTextParts(source, statement);
  const { namedBindings } = clause;

  if (!namedBindings) {
    return `import ${parts.typePrefix}${clause.name?.text ?? ''} from ${parts.moduleText};`;
  }
  if (ts.isNamespaceImport(namedBindings)) {
    return importWithNamespaceText(
      parts.typePrefix,
      parts.defaultPrefix,
      namedBindings,
      parts.moduleText,
    );
  }

  return importWithNamedText({ ...parts, namedBindings });
};

interface SortableImport {
  order: number;
  sortKey: string;
  text: string;
}

const sortableImport = (source: string, statement: ts.ImportDeclaration): SortableImport => ({
  order: syntaxOrder[importSyntaxKind(statement)],
  sortKey: importSortKey(statement),
  text: importText(source, statement),
});

const compareSortableImports = (left: SortableImport, right: SortableImport): number => {
  if (left.order !== right.order) {
    return left.order - right.order;
  }
  const keyOrder = compareText(left.sortKey, right.sortKey);
  if (keyOrder !== 0) {
    return keyOrder;
  }
  return compareText(left.text, right.text);
};

const sortedImportBlock = (source: string, imports: readonly ts.ImportDeclaration[]): string =>
  imports
    .map((statement) => sortableImport(source, statement))
    .sort(compareSortableImports)
    .map((entry) => entry.text)
    .join('\n');

const collectLeadingImports = (sourceFile: ts.SourceFile): ts.ImportDeclaration[] => {
  const imports: ts.ImportDeclaration[] = [];

  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)) {
      break;
    }
    if (!statement.importClause) {
      return [];
    }
    imports.push(statement);
  }

  return imports;
};

const leadingImportSpan = (
  sourceFile: ts.SourceFile,
  imports: readonly ts.ImportDeclaration[],
): { end: number; start: number } | undefined => {
  if (imports.length === 0) {
    return undefined;
  }

  const [firstImport] = imports;
  const lastImport = imports.at(-1);
  if (!firstImport || !lastImport) {
    return undefined;
  }

  const start = firstImport.getStart(sourceFile);
  const end = lastImport.getEnd();
  return { end, start };
};

const replacementForSortedImports = (
  source: string,
  imports: readonly ts.ImportDeclaration[],
  span: Replacement,
): Replacement | undefined => {
  const before = source.slice(span.start, span.end);
  const after = sortedImportBlock(source, imports);

  if (before === after) {
    return undefined;
  }

  return { ...span, text: after };
};

const importSortReplacement = (source: string): Replacement | undefined => {
  const sourceFile = ts.createSourceFile('codemod.ts', source, ts.ScriptTarget.Latest, true);
  const imports = collectLeadingImports(sourceFile);
  const span = leadingImportSpan(sourceFile, imports);
  if (!span) {
    return undefined;
  }
  return replacementForSortedImports(source, imports, { ...span, text: '' });
};

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const sortImportDeclarations = (source: string): string =>
  applyReplacement(source, importSortReplacement(source));
