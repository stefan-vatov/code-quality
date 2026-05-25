/* -------------------------------------------------------------------------- */
/*  AST-backed codemod for correcting repeatable acronym casing violations.   */
/* -------------------------------------------------------------------------- */
import type { Identifier, ObjectProperty, Statement } from 'jscodeshift';
import findMisCasedAcronyms, { fixAcronymCase } from '../rules/acronym-case';
import jscodeshift from 'jscodeshift';

interface Replacement {
  end: number;
  start: number;
  text: string;
}

interface ProgramLike {
  body: readonly Statement[];
}

interface RenameContext {
  protectedNames: ReadonlySet<string>;
  protectedRanges: ReadonlySet<string>;
}

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

const nodeRangeKey = (node: unknown): string => `${nodeStart(node)}:${nodeEnd(node)}`;

const isIdentifier = (node: unknown): node is Identifier =>
  isObjectRecord(node) && node.type === 'Identifier' && typeof node.name === 'string';

const collectObjectPatternNames = (name: Record<string, unknown>, names: Set<string>): void => {
  const { properties } = name;
  if (!Array.isArray(properties)) {
    return;
  }
  for (const property of properties) {
    collectPropertyBindingName(property, names);
  }
};

const collectArrayPatternNames = (name: Record<string, unknown>, names: Set<string>): void => {
  const { elements } = name;
  if (!Array.isArray(elements)) {
    return;
  }
  for (const element of elements) {
    collectBindingNames(element, names);
  }
};

const collectPropertyBindingName = (property: unknown, names: Set<string>): void => {
  if (!isObjectRecord(property)) {
    return;
  }
  if (property.type === 'ObjectProperty') {
    collectBindingNames(property.value, names);
  } else if (property.type === 'RestElement') {
    collectBindingNames(property.argument, names);
  }
};

const collectBindingNames = (name: unknown, names: Set<string>): void => {
  if (!isObjectRecord(name)) {
    return;
  }
  if (isIdentifier(name)) {
    names.add(name.name);
    return;
  }
  if (name.type === 'ObjectPattern') {
    collectObjectPatternNames(name, names);
  } else if (name.type === 'ArrayPattern') {
    collectArrayPatternNames(name, names);
  } else if (name.type === 'AssignmentPattern') {
    collectBindingNames(name.left, names);
  } else if (name.type === 'RestElement') {
    collectBindingNames(name.argument, names);
  }
};

const collectImportProtectedNames = (statement: Statement, names: Set<string>): void => {
  if (!isObjectRecord(statement) || !Array.isArray(statement.specifiers)) {
    return;
  }
  for (const specifier of statement.specifiers) {
    if (isObjectRecord(specifier) && isIdentifier(specifier.local)) {
      names.add(specifier.local.name);
    }
  }
};

const collectExportedVariableNames = (declaration: unknown, names: Set<string>): void => {
  if (!isObjectRecord(declaration) || !Array.isArray(declaration.declarations)) {
    return;
  }
  for (const variableDeclarator of declaration.declarations) {
    if (isObjectRecord(variableDeclarator)) {
      collectBindingNames(variableDeclarator.id, names);
    }
  }
};

const collectExportedDeclarationName = (declaration: unknown, names: Set<string>): void => {
  if (!isObjectRecord(declaration)) {
    return;
  }
  if (declaration.type === 'VariableDeclaration') {
    collectExportedVariableNames(declaration, names);
    return;
  }
  if (isIdentifier(declaration.id)) {
    names.add(declaration.id.name);
  }
};

const collectExportSpecifierNames = (statement: Statement, names: Set<string>): void => {
  if (!isObjectRecord(statement) || !Array.isArray(statement.specifiers)) {
    return;
  }
  for (const specifier of statement.specifiers) {
    if (isObjectRecord(specifier)) {
      collectBindingNames(specifier.local, names);
      collectBindingNames(specifier.exported, names);
    }
  }
};

const collectProtectedNameFromStatement = (statement: Statement, names: Set<string>): void => {
  if (statement.type === 'ImportDeclaration') {
    collectImportProtectedNames(statement, names);
  } else if (statement.type === 'ExportNamedDeclaration' && isObjectRecord(statement)) {
    collectExportedDeclarationName(statement.declaration, names);
    collectExportSpecifierNames(statement, names);
  }
};

const sourceProgram = (source: string): ProgramLike | undefined => {
  const [programPath] = codemodAPI(source).find(codemodAPI.Program).paths();
  if (!programPath) {
    return undefined;
  }
  return programPath.value;
};

const collectProtectedNames = (source: string): Set<string> => {
  const protectedNames = new Set<string>();
  const program = sourceProgram(source);
  if (!program) {
    return protectedNames;
  }

  for (const statement of program.body) {
    collectProtectedNameFromStatement(statement, protectedNames);
  }
  return protectedNames;
};

const addObjectPropertyKeyRange = (ranges: Set<string>, property: ObjectProperty): void => {
  if (property.shorthand === true) {
    ranges.add(nodeRangeKey(property.key));
    ranges.add(nodeRangeKey(property.value));
    return;
  }
  ranges.add(nodeRangeKey(property.key));
};

const collectProtectedRanges = (source: string): Set<string> => {
  const ranges = new Set<string>();

  codemodAPI(source)
    .find(codemodAPI.ObjectProperty)
    .forEach((path): void => {
      addObjectPropertyKeyRange(ranges, path.value);
    });

  return ranges;
};

const shouldSkipIdentifier = (node: Identifier, context: RenameContext): boolean =>
  context.protectedNames.has(node.name) || context.protectedRanges.has(nodeRangeKey(node));

const collectIdentifierReplacements = (source: string): Replacement[] => {
  const context: RenameContext = {
    protectedNames: collectProtectedNames(source),
    protectedRanges: collectProtectedRanges(source),
  };
  const replacements: Replacement[] = [];

  codemodAPI(source)
    .find(codemodAPI.Identifier)
    .forEach((path): void => {
      const { name } = path.value;
      if (!shouldSkipIdentifier(path.value, context) && findMisCasedAcronyms(name).length > 0) {
        replacements.push({
          end: nodeEnd(path.value),
          start: nodeStart(path.value),
          text: fixAcronymCase(name),
        });
      }
    });

  return replacements;
};

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const renameMisCasedAcronyms = (source: string): string =>
  applyReplacements(source, collectIdentifierReplacements(source));

export default renameMisCasedAcronyms;
