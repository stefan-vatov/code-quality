/* -------------------------------------------------------------------------- */
/*            Conservative codemod for local export-list rewrites.            */
/* -------------------------------------------------------------------------- */
import type {
  Declaration,
  ExportNamedDeclaration,
  Identifier,
  Statement,
  VariableDeclaration,
  VariableDeclarator,
} from 'jscodeshift';
import jscodeshift from 'jscodeshift';

interface Replacement {
  end: number;
  start: number;
  text: string;
}

interface ExportList {
  names: readonly string[];
  range: Replacement;
}

interface ProgramLike {
  body: readonly Statement[];
}

const exportKeyword = 'export ';
const codemodAPI = jscodeshift.withParser('ts');

const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const applyReplacements = (source: string, replacements: readonly Replacement[]): string =>
  [...replacements]
    .sort((left, right) => right.start - left.start)
    .reduce(
      (current, replacement) =>
        current.slice(0, replacement.start) + replacement.text + current.slice(replacement.end),
      source,
    );

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

const lineEndAfter = (source: string, position: number): number => {
  const newline = source.indexOf('\n', position);
  if (newline === -1) {
    return source.length;
  }
  return newline + 1;
};

const isIdentifier = (node: unknown): node is Identifier =>
  isObjectRecord(node) && node.type === 'Identifier' && typeof node.name === 'string';

const isExportNamedDeclaration = (statement: Statement): statement is ExportNamedDeclaration =>
  statement.type === 'ExportNamedDeclaration';

const isVariableDeclaration = (declaration: Declaration): declaration is VariableDeclaration =>
  declaration.type === 'VariableDeclaration';

const isVariableDeclarator = (declaration: unknown): declaration is VariableDeclarator =>
  isObjectRecord(declaration) && 'id' in declaration;

const exportSpecifierName = (specifier: unknown): string | undefined => {
  if (!isObjectRecord(specifier) || specifier.type !== 'ExportSpecifier') {
    return undefined;
  }
  const { exported, local } = specifier;
  if (!isIdentifier(local) || !isIdentifier(exported)) {
    return undefined;
  }
  if (local.name !== exported.name) {
    return undefined;
  }
  return local.name;
};

const exportSpecifierNames = (specifiers: readonly unknown[]): string[] | undefined => {
  const names: string[] = [];
  for (const specifier of specifiers) {
    const name = exportSpecifierName(specifier);
    if (!name) {
      return undefined;
    }
    names.push(name);
  }
  return names;
};

const localExportListFor = (
  source: string,
  node: ExportNamedDeclaration,
): ExportList | undefined => {
  const specifiers = node.specifiers ?? [];
  if (node.source || node.declaration || specifiers.length === 0) {
    return undefined;
  }

  const names = exportSpecifierNames(specifiers);
  if (!names) {
    return undefined;
  }

  return {
    names,
    range: {
      end: lineEndAfter(source, nodeEnd(node)),
      start: nodeStart(node),
      text: '',
    },
  };
};

const variableStatementNames = (node: VariableDeclaration): readonly string[] =>
  node.declarations.flatMap((declaration): string[] => {
    if (isVariableDeclarator(declaration) && isIdentifier(declaration.id)) {
      return [declaration.id.name];
    }
    return [];
  });

const declarationName = (node: Declaration): string | undefined => {
  if (!isObjectRecord(node) || !isIdentifier(node.id)) {
    return undefined;
  }
  return node.id.name;
};

const unwrappedDeclaration = (node: Statement): Declaration | undefined => {
  if (isExportNamedDeclaration(node)) {
    return node.declaration ?? undefined;
  }
  if (node.type === 'VariableDeclaration' || (isObjectRecord(node) && 'id' in node)) {
    return node;
  }
  return undefined;
};

const declarationNames = (node: Statement): readonly string[] => {
  const declaration = unwrappedDeclaration(node);
  if (!declaration) {
    return [];
  }
  if (isVariableDeclaration(declaration)) {
    return variableStatementNames(declaration);
  }
  const name = declarationName(declaration);
  if (name) {
    return [name];
  }
  return [];
};

const inlineExportReplacement = (statement: Statement): Replacement | undefined => {
  if (isExportNamedDeclaration(statement)) {
    return undefined;
  }
  return {
    end: nodeStart(statement),
    start: nodeStart(statement),
    text: exportKeyword,
  };
};

const collectExportLists = (
  source: string,
  statements: readonly Statement[],
): readonly ExportList[] =>
  statements.flatMap((statement): ExportList[] => {
    if (!isExportNamedDeclaration(statement)) {
      return [];
    }
    const exportList = localExportListFor(source, statement);
    if (exportList) {
      return [exportList];
    }
    return [];
  });

const sourceProgram = (source: string): ProgramLike | undefined => {
  const [programPath] = codemodAPI(source).find(codemodAPI.Program).paths();
  if (!programPath) {
    return undefined;
  }
  return programPath.value;
};

const appendInlineExportReplacements = (
  replacements: Replacement[],
  statements: readonly Statement[],
  names: ReadonlySet<string>,
): void => {
  for (const statement of statements) {
    if (declarationNames(statement).some((name) => names.has(name))) {
      const replacement = inlineExportReplacement(statement);
      if (replacement) {
        replacements.push(replacement);
      }
    }
  }
};

const collectExportListReplacements = (source: string): Replacement[] => {
  const program = sourceProgram(source);
  if (!program) {
    return [];
  }
  const exportLists = collectExportLists(source, program.body);
  const names = new Set(exportLists.flatMap((exportList) => [...exportList.names]));
  const replacements: Replacement[] = exportLists.map((exportList) => exportList.range);
  appendInlineExportReplacements(replacements, program.body, names);
  return replacements;
};

/**
 * Rewrites safe local export lists into inline exported declarations.
 *
 * @internal
 */
export const inlineLocalExportLists = (source: string): string =>
  applyReplacements(source, collectExportListReplacements(source));
