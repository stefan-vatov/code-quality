/* -------------------------------------------------------------------------- */
/*            Conservative codemod for local export-list rewrites.            */
/* -------------------------------------------------------------------------- */
import { Array, HashSet, Option, Order, Predicate, pipe } from 'effect';
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
  Predicate.isObject(value);

const applyReplacements = (source: string, replacements: readonly Replacement[]): string =>
  pipe(
    replacements,
    Array.sortWith((replacement) => -replacement.start, Order.number),
    Array.reduce(
      source,
      (current, replacement) =>
        current.slice(0, replacement.start) + replacement.text + current.slice(replacement.end),
    ),
  );

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

const lineEndAfter = (source: string, position: number): number => {
  const newline = source.indexOf('\n', position);
  return pipe(
    Option.some(newline),
    Option.map((value): number => {
      if (value === -1) {
        return source.length;
      }
      return value + 1;
    }),
    Option.getOrElse((): number => source.length),
  );
};

const isIdentifier = (node: unknown): node is Identifier =>
  isObjectRecord(node) && node.type === 'Identifier' && typeof node.name === 'string';

const isExportNamedDeclaration = (statement: Statement): statement is ExportNamedDeclaration =>
  statement.type === 'ExportNamedDeclaration';

const isVariableDeclaration = (declaration: Declaration): declaration is VariableDeclaration =>
  declaration.type === 'VariableDeclaration';

const isVariableDeclarator = (declaration: unknown): declaration is VariableDeclarator =>
  isObjectRecord(declaration) && 'id' in declaration;

const exportSpecifierName = (specifier: unknown): string | undefined =>
  pipe(
    Option.some(specifier),
    Option.filter(isObjectRecord),
    Option.filter((value): boolean => value.type === 'ExportSpecifier'),
    Option.flatMap((value) =>
      pipe(
        Option.all({
          exported: Option.fromNullable(value.exported),
          local: Option.fromNullable(value.local),
        }),
        Option.filter(
          ({ exported, local }): boolean => isIdentifier(local) && isIdentifier(exported),
        ),
        Option.filter(({ exported, local }): boolean => {
          if (!isIdentifier(local) || !isIdentifier(exported)) {
            return false;
          }
          return local.name === exported.name;
        }),
        Option.map(({ local }): string => {
          if (!isIdentifier(local)) {
            return '';
          }
          return local.name;
        }),
        Option.filter((name): boolean => name.length > 0),
      ),
    ),
    Option.getOrUndefined,
  );

const exportSpecifierNames = (specifiers: readonly unknown[]): string[] | undefined => {
  const names = pipe(
    specifiers,
    Array.map((specifier) => Option.fromNullable(exportSpecifierName(specifier))),
  );
  if (names.some(Option.isNone)) {
    return undefined;
  }
  return pipe(
    names,
    Array.filterMap((name) => name),
  );
};

const localExportListFor = (
  source: string,
  node: ExportNamedDeclaration,
): ExportList | undefined => {
  const specifiers = node.specifiers ?? [];
  if (node.source || node.declaration || specifiers.length === 0) {
    return undefined;
  }

  return pipe(
    Option.fromNullable(exportSpecifierNames(specifiers)),
    Option.map(
      (names): ExportList => ({
        names,
        range: {
          end: lineEndAfter(source, nodeEnd(node)),
          start: nodeStart(node),
          text: '',
        },
      }),
    ),
    Option.getOrUndefined,
  );
};

const variableStatementNames = (node: VariableDeclaration): readonly string[] =>
  pipe(
    node.declarations,
    Array.filterMap((declaration) => {
      if (isVariableDeclarator(declaration) && isIdentifier(declaration.id)) {
        return Option.some(declaration.id.name);
      }
      return Option.none<string>();
    }),
  );

const declarationName = (node: Declaration): string | undefined =>
  pipe(
    Option.some(node as unknown),
    Option.filter(isObjectRecord),
    Option.flatMap((value) => Option.fromNullable(value.id)),
    Option.filter(isIdentifier),
    Option.map((value): string => value.name),
    Option.getOrUndefined,
  );

const unwrappedDeclaration = (node: Statement): Declaration | undefined => {
  if (isExportNamedDeclaration(node)) {
    return node.declaration ?? undefined;
  }
  if (node.type === 'VariableDeclaration' || (isObjectRecord(node) && 'id' in node)) {
    return node;
  }
  return undefined;
};

const declarationNames = (node: Statement): readonly string[] =>
  pipe(
    Option.fromNullable(unwrappedDeclaration(node)),
    Option.match({
      onNone: (): readonly string[] => [],
      onSome: (declaration): readonly string[] => {
        if (isVariableDeclaration(declaration)) {
          return variableStatementNames(declaration);
        }
        return pipe(
          Option.fromNullable(declarationName(declaration)),
          Option.match({
            onNone: (): readonly string[] => [],
            onSome: (name): readonly string[] => [name],
          }),
        );
      },
    }),
  );

const inlineExportReplacement = (statement: Statement): Replacement | undefined =>
  pipe(
    Option.some(statement),
    Option.filter((value): boolean => !isExportNamedDeclaration(value)),
    Option.map(
      (value): Replacement => ({
        end: nodeStart(value),
        start: nodeStart(value),
        text: exportKeyword,
      }),
    ),
    Option.getOrUndefined,
  );

const collectExportLists = (
  source: string,
  statements: readonly Statement[],
): readonly ExportList[] =>
  pipe(
    statements,
    Array.filterMap((statement) => {
      if (isExportNamedDeclaration(statement)) {
        return Option.fromNullable(localExportListFor(source, statement));
      }
      return Option.none<ExportList>();
    }),
  );

const sourceProgram = (source: string): ProgramLike | undefined =>
  pipe(
    codemodAPI(source).find(codemodAPI.Program).paths(),
    Array.head,
    Option.map((programPath): ProgramLike => programPath.value),
    Option.getOrUndefined,
  );

const appendInlineExportReplacements = (
  replacements: Replacement[],
  statements: readonly Statement[],
  names: HashSet.HashSet<string>,
): void => {
  pipe(
    statements,
    Array.filter((statement): boolean =>
      pipe(
        declarationNames(statement),
        Array.some((name): boolean => HashSet.has(names, name)),
      ),
    ),
    Array.filterMap((statement) => Option.fromNullable(inlineExportReplacement(statement))),
    Array.map((replacement): number => replacements.push(replacement)),
  );
};

const collectExportListReplacements = (source: string): Replacement[] => {
  const program = sourceProgram(source);
  if (!program) {
    return [];
  }
  const exportLists = collectExportLists(source, program.body);
  const names = HashSet.fromIterable(
    pipe(
      exportLists,
      Array.flatMap((exportList) => exportList.names),
    ),
  );
  const replacements: Replacement[] = pipe(
    exportLists,
    Array.map((exportList) => exportList.range),
  );
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
