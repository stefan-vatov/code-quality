/* -------------------------------------------------------------------------- */
/*      Conservative codemod for sorting top-level import declarations.       */
/* -------------------------------------------------------------------------- */
import { Array, Option, Order, Predicate, pipe } from 'effect';
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
  Predicate.isObject(value);

const isImportDeclaration = (statement: Statement): statement is ImportDeclaration =>
  statement.type === 'ImportDeclaration';

const nodeStart = (node: unknown): number =>
  pipe(
    Option.some(node),
    Option.filter(isObjectRecord),
    Option.flatMapNullable((value) => value.start),
    Option.filter(Predicate.isNumber),
    Option.getOrThrowWith(() => new Error('jscodeshift node is missing a start offset')),
  );

const nodeEnd = (node: unknown): number =>
  pipe(
    Option.some(node),
    Option.filter(isObjectRecord),
    Option.flatMapNullable((value) => value.end),
    Option.filter(Predicate.isNumber),
    Option.getOrThrowWith(() => new Error('jscodeshift node is missing an end offset')),
  );

const sourceForNode = (source: string, node: unknown): string =>
  source.slice(nodeStart(node), nodeEnd(node));

const compareText = Order.string;

const applyReplacement = (source: string, replacement: Replacement | undefined): string =>
  pipe(
    Option.fromNullable(replacement),
    Option.match({
      onNone: (): string => source,
      onSome: (value): string =>
        source.slice(0, value.start) + value.text + source.slice(value.end),
    }),
  );

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

const localName = (identifier: unknown): string =>
  pipe(
    Option.some(identifier),
    Option.filter(isObjectRecord),
    Option.filter((value): boolean => value.type === 'Identifier'),
    Option.flatMapNullable((value) => value.name),
    Option.filter(Predicate.isString),
    Option.getOrElse((): string => ''),
  );

const importedName = (node: unknown): string =>
  pipe(
    Option.some(node),
    Option.filter(isObjectRecord),
    Option.match({
      onNone: (): string => '',
      onSome: (value): string => {
        if (value.type === 'Identifier' && typeof value.name === 'string') {
          return value.name;
        }
        return String(value.value);
      },
    }),
  );

const importSpecifiers = (statement: ImportDeclaration): readonly ImportSpecifierNode[] =>
  pipe(importNode(statement).specifiers, Array.filter(isImportSpecifier));

const defaultSpecifier = (statement: ImportDeclaration): ImportSpecifierNode | undefined =>
  pipe(
    importNode(statement).specifiers,
    Array.findFirst(isDefaultSpecifier),
    Option.getOrUndefined,
  );

const namespaceSpecifier = (statement: ImportDeclaration): ImportSpecifierNode | undefined =>
  pipe(
    importNode(statement).specifiers,
    Array.findFirst(isNamespaceSpecifier),
    Option.getOrUndefined,
  );

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
  return pipe(
    importSpecifiers(statement),
    Array.head,
    Option.map((specifier): string => localName(specifier.local) || importSpecifierKey(specifier)),
    Option.getOrElse((): string => ''),
  );
};

const importSortKey = (statement: ImportDeclaration): string => {
  const defaultImport = defaultSpecifier(statement);
  if (defaultImport) {
    return localName(defaultImport.local);
  }
  return namedImportSortKey(statement);
};

const importSpecifierText = (specifier: ImportSpecifierNode): string => {
  const typePrefix = pipe(
    Option.some(specifier.importKind),
    Option.filter((importKind): boolean => importKind === 'type'),
    Option.match({
      onNone: (): string => '',
      onSome: (): string => 'type ',
    }),
  );
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
  const sorted = pipe(specifiers, Array.sortWith(importSpecifierKey, Order.string));
  const texts = pipe(sorted, Array.map(importSpecifierText));

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
  importKindOrder: number;
  order: number;
  sortKey: string;
  text: string;
}

const importKindOrder = (statement: ImportDeclaration): number => {
  if (statement.importKind === 'type') {
    return 0;
  }
  return 1;
};

const sortableImport = (source: string, statement: ImportDeclaration): SortableImport => ({
  importKindOrder: importKindOrder(statement),
  order: syntaxOrder[importSyntaxKind(statement)],
  sortKey: importSortKey(statement),
  text: importText(source, statement),
});

const compareSortableImports: Order.Order<SortableImport> = (left, right) => {
  if (left.order !== right.order) {
    return Order.number(left.order, right.order);
  }
  const keyOrder = compareText(left.sortKey, right.sortKey);
  if (keyOrder !== 0) {
    return keyOrder;
  }
  if (left.importKindOrder !== right.importKindOrder) {
    return Order.number(left.importKindOrder, right.importKindOrder);
  }
  return compareText(left.text, right.text);
};

const sortedImportBlock = (source: string, imports: readonly ImportDeclaration[]): string =>
  pipe(
    imports,
    Array.map((statement) => sortableImport(source, statement)),
    Array.sort(compareSortableImports),
    Array.map((entry) => entry.text),
    (entries) => entries.join('\n'),
  );

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
): { end: number; start: number } | undefined =>
  pipe(
    Option.all({
      firstImport: Array.head(imports),
      lastImport: Array.last(imports),
    }),
    Option.map(({ firstImport, lastImport }) => ({
      end: nodeEnd(lastImport),
      start: nodeStart(firstImport),
    })),
    Option.getOrUndefined,
  );

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

const importSortReplacement = (source: string): Replacement | undefined =>
  pipe(
    codemodAPI(source).find(codemodAPI.Program).paths(),
    Array.head,
    Option.map((program) => collectLeadingImports(program.value.body)),
    Option.flatMap((imports) =>
      pipe(
        Option.fromNullable(leadingImportSpan(imports)),
        Option.flatMap((span) =>
          Option.fromNullable(replacementForSortedImports(source, imports, { ...span, text: '' })),
        ),
      ),
    ),
    Option.getOrUndefined,
  );

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const sortImportDeclarations = (source: string): string =>
  applyReplacement(source, importSortReplacement(source));
