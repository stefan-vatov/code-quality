/* -------------------------------------------------------------------------- */
/*      Conservative codemod for sorting top-level import declarations.       */
/* -------------------------------------------------------------------------- */
import type { ImportDeclaration, Statement } from 'jscodeshift';
import jscodeshift from 'jscodeshift';

interface Replacement {
  end: number;
  start: number;
  text: string;
}

interface ImportSpecifierNode {
  imported?: unknown;
  importKind?: string;
  local?: unknown;
  type: string;
}

interface ImportNode {
  importKind?: string;
  source: unknown;
  specifiers: readonly ImportSpecifierNode[];
}

const syntaxOrder = {
  all: 1,
  multiple: 2,
  none: 0,
  single: 3,
} as const;
const codemodAPI = jscodeshift.withParser('ts');

const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isImportDeclaration = (statement: Statement): statement is ImportDeclaration =>
  statement.type === 'ImportDeclaration';

const nodeStart = (node: unknown): number => {
  if (isObjectRecord(node)) {
    const { start } = node;
    if (typeof start === 'number') {
      return start;
    }
  }
  throw new Error('jscodeshift node is missing a start offset');
};

const nodeEnd = (node: unknown): number => {
  if (isObjectRecord(node)) {
    const { end } = node;
    if (typeof end === 'number') {
      return end;
    }
  }
  throw new Error('jscodeshift node is missing an end offset');
};

const sourceForNode = (source: string, node: unknown): string =>
  source.slice(nodeStart(node), nodeEnd(node));

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

const importNode = (statement: ImportDeclaration): ImportNode => ({
  importKind: statement.importKind,
  source: statement.source,
  specifiers: statement.specifiers ?? [],
});

const isImportSpecifier = (specifier: ImportSpecifierNode | undefined): boolean =>
  specifier?.type === 'ImportSpecifier';

const isDefaultSpecifier = (specifier: ImportSpecifierNode | undefined): boolean =>
  specifier?.type === 'ImportDefaultSpecifier';

const isNamespaceSpecifier = (specifier: ImportSpecifierNode | undefined): boolean =>
  specifier?.type === 'ImportNamespaceSpecifier';

const localName = (identifier: unknown): string => {
  if (
    isObjectRecord(identifier) &&
    identifier.type === 'Identifier' &&
    typeof identifier.name === 'string'
  ) {
    return identifier.name;
  }
  return '';
};

const importedName = (node: unknown): string => {
  if (isObjectRecord(node) && node.type === 'Identifier' && typeof node.name === 'string') {
    return node.name;
  }
  if (isObjectRecord(node)) {
    const { value } = node;
    return String(value);
  }
  return '';
};

const importSpecifiers = (statement: ImportDeclaration): readonly ImportSpecifierNode[] =>
  importNode(statement).specifiers.filter(isImportSpecifier);

const defaultSpecifier = (statement: ImportDeclaration): ImportSpecifierNode | undefined =>
  importNode(statement).specifiers.find(isDefaultSpecifier);

const namespaceSpecifier = (statement: ImportDeclaration): ImportSpecifierNode | undefined =>
  importNode(statement).specifiers.find(isNamespaceSpecifier);

const importSyntaxKind = (statement: ImportDeclaration): keyof typeof syntaxOrder => {
  const { specifiers } = importNode(statement);
  if (specifiers.length === 0) {
    return 'none';
  }
  if (namespaceSpecifier(statement)) {
    return 'all';
  }
  if (defaultSpecifier(statement) && importSpecifiers(statement).length > 0) {
    return 'multiple';
  }
  if (importSpecifiers(statement).length > 1) {
    return 'multiple';
  }
  return 'single';
};

const importSpecifierKey = (specifier: ImportSpecifierNode): string =>
  importedName(specifier.imported);

const namedImportSortKey = (statement: ImportDeclaration): string => {
  const namespaceImport = namespaceSpecifier(statement);
  if (namespaceImport) {
    return localName(namespaceImport.local);
  }
  const [firstSpecifier] = importSpecifiers(statement);
  if (firstSpecifier) {
    return importSpecifierKey(firstSpecifier);
  }
  return '';
};

const importSortKey = (statement: ImportDeclaration): string => {
  const defaultImport = defaultSpecifier(statement);
  if (defaultImport) {
    return localName(defaultImport.local);
  }
  return namedImportSortKey(statement);
};

const importSpecifierText = (specifier: ImportSpecifierNode): string => {
  const typePrefix = ((): string => {
    if (specifier.importKind === 'type') {
      return 'type ';
    }
    return '';
  })();
  const imported = importedName(specifier.imported);
  const local = localName(specifier.local);
  if (imported !== local) {
    return `${typePrefix}${imported} as ${local}`;
  }
  return `${typePrefix}${local}`;
};

const sortedNamedImportText = (
  specifiers: readonly ImportSpecifierNode[],
  isMultiline: boolean,
): string => {
  const sorted = [...specifiers].sort((left, right) =>
    compareText(importSpecifierKey(left), importSpecifierKey(right)),
  );
  const texts = sorted.map(importSpecifierText);

  if (isMultiline) {
    return `{\n  ${texts.join(',\n  ')},\n}`;
  }
  return `{ ${texts.join(', ')} }`;
};

const typePrefixForImport = (statement: ImportDeclaration): string => {
  if (statement.importKind === 'type') {
    return 'type ';
  }
  return '';
};

const defaultPrefixForImport = (statement: ImportDeclaration): string => {
  const specifier = defaultSpecifier(statement);
  if (specifier) {
    return `${localName(specifier.local)}, `;
  }
  return '';
};

const importWithNamespaceText = (
  statement: ImportDeclaration,
  namespaceImport: ImportSpecifierNode,
  moduleText: string,
): string =>
  `import ${typePrefixForImport(statement)}${defaultPrefixForImport(statement)}* as ${localName(namespaceImport.local)} from ${moduleText};`;

const importWithNamedText = (
  source: string,
  statement: ImportDeclaration,
  specifiers: readonly ImportSpecifierNode[],
  moduleText: string,
): string => {
  const originalText = sourceForNode(source, statement);
  const isMultiline = originalText.includes('\n');
  return [
    `import ${typePrefixForImport(statement)}${defaultPrefixForImport(statement)}`,
    `${sortedNamedImportText(specifiers, isMultiline)} from ${moduleText};`,
  ].join('');
};

const importText = (source: string, statement: ImportDeclaration): string => {
  if (importNode(statement).specifiers.length === 0) {
    return sourceForNode(source, statement);
  }

  const moduleText = sourceForNode(source, importNode(statement).source);
  const namespaceImport = namespaceSpecifier(statement);
  if (namespaceImport) {
    return importWithNamespaceText(statement, namespaceImport, moduleText);
  }

  const specifiers = importSpecifiers(statement);
  if (specifiers.length === 0) {
    return `import ${typePrefixForImport(statement)}${localName(defaultSpecifier(statement)?.local)} from ${moduleText};`;
  }

  return importWithNamedText(source, statement, specifiers, moduleText);
};

interface SortableImport {
  order: number;
  sortKey: string;
  text: string;
}

const sortableImport = (source: string, statement: ImportDeclaration): SortableImport => ({
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

const sortedImportBlock = (source: string, imports: readonly ImportDeclaration[]): string =>
  imports
    .map((statement) => sortableImport(source, statement))
    .sort(compareSortableImports)
    .map((entry) => entry.text)
    .join('\n');

const collectLeadingImports = (statements: readonly Statement[]): ImportDeclaration[] => {
  const imports: ImportDeclaration[] = [];

  for (const statement of statements) {
    if (!isImportDeclaration(statement)) {
      break;
    }
    if (importNode(statement).specifiers.length === 0) {
      return [];
    }
    imports.push(statement);
  }

  return imports;
};

const leadingImportSpan = (
  imports: readonly ImportDeclaration[],
): { end: number; start: number } | undefined => {
  const [firstImport] = imports;
  const lastImport = imports.at(-1);
  if (!firstImport || !lastImport) {
    return undefined;
  }

  return { end: nodeEnd(lastImport), start: nodeStart(firstImport) };
};

const replacementForSortedImports = (
  source: string,
  imports: readonly ImportDeclaration[],
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
  const program = codemodAPI(source).find(codemodAPI.Program).paths()[0]?.value;
  if (!program) {
    return undefined;
  }
  const imports = collectLeadingImports(program.body);
  const span = leadingImportSpan(imports);
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
