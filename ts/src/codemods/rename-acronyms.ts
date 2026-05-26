/* -------------------------------------------------------------------------- */
/*  AST-backed codemod for correcting repeatable acronym casing violations.   */
/* -------------------------------------------------------------------------- */
import { Array, HashSet, Option, Order, Predicate, pipe } from 'effect';
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
  protectedNames: HashSet.HashSet<string>;
  protectedRanges: HashSet.HashSet<string>;
}

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

const nodeRangeKey = (node: unknown): string => `${nodeStart(node)}:${nodeEnd(node)}`;

const isIdentifier = (node: unknown): node is Identifier =>
  isObjectRecord(node) && node.type === 'Identifier' && typeof node.name === 'string';

const collectObjectPatternNames = (
  name: Record<string, unknown>,
  names: HashSet.HashSet<string>,
): HashSet.HashSet<string> => {
  const { properties } = name;
  if (!globalThis.Array.isArray(properties)) {
    return names;
  }
  return pipe(
    properties,
    Array.reduce(names, (currentNames, property) =>
      collectPropertyBindingName(property, currentNames),
    ),
  );
};

const collectArrayPatternNames = (
  name: Record<string, unknown>,
  names: HashSet.HashSet<string>,
): HashSet.HashSet<string> => {
  const { elements } = name;
  if (!globalThis.Array.isArray(elements)) {
    return names;
  }
  return pipe(
    elements,
    Array.reduce(names, (currentNames, element) => collectBindingNames(element, currentNames)),
  );
};

const collectPropertyBindingName = (
  property: unknown,
  names: HashSet.HashSet<string>,
): HashSet.HashSet<string> => {
  if (!isObjectRecord(property)) {
    return names;
  }
  if (property.type === 'ObjectProperty') {
    return collectBindingNames(property.value, names);
  }
  if (property.type === 'RestElement') {
    return collectBindingNames(property.argument, names);
  }
  return names;
};

const collectPatternBindingNames = (
  name: Record<string, unknown>,
  names: HashSet.HashSet<string>,
): HashSet.HashSet<string> => {
  if (name.type === 'ObjectPattern') {
    return collectObjectPatternNames(name, names);
  }
  if (name.type === 'ArrayPattern') {
    return collectArrayPatternNames(name, names);
  }
  if (name.type === 'AssignmentPattern') {
    return collectBindingNames(name.left, names);
  }
  if (name.type === 'RestElement') {
    return collectBindingNames(name.argument, names);
  }
  return names;
};

const collectBindingNames = (
  name: unknown,
  names: HashSet.HashSet<string>,
): HashSet.HashSet<string> => {
  if (!isObjectRecord(name)) {
    return names;
  }
  if (isIdentifier(name)) {
    return HashSet.add(names, name.name);
  }
  return collectPatternBindingNames(name, names);
};

const collectImportProtectedNames = (
  statement: Statement,
  names: HashSet.HashSet<string>,
): HashSet.HashSet<string> => {
  if (!isObjectRecord(statement) || !globalThis.Array.isArray(statement.specifiers)) {
    return names;
  }
  return pipe(
    statement.specifiers,
    Array.reduce(names, (currentNames, specifier) => {
      if (isObjectRecord(specifier) && isIdentifier(specifier.local)) {
        return HashSet.add(currentNames, specifier.local.name);
      }
      return currentNames;
    }),
  );
};

const collectExportedVariableNames = (
  declaration: unknown,
  names: HashSet.HashSet<string>,
): HashSet.HashSet<string> => {
  if (!isObjectRecord(declaration) || !globalThis.Array.isArray(declaration.declarations)) {
    return names;
  }
  return pipe(
    declaration.declarations,
    Array.reduce(names, (currentNames, variableDeclarator) => {
      if (isObjectRecord(variableDeclarator)) {
        return collectBindingNames(variableDeclarator.id, currentNames);
      }
      return currentNames;
    }),
  );
};

const collectExportedDeclarationName = (
  declaration: unknown,
  names: HashSet.HashSet<string>,
): HashSet.HashSet<string> => {
  if (!isObjectRecord(declaration)) {
    return names;
  }
  if (declaration.type === 'VariableDeclaration') {
    return collectExportedVariableNames(declaration, names);
  }
  if (isIdentifier(declaration.id)) {
    return HashSet.add(names, declaration.id.name);
  }
  return names;
};

const collectExportSpecifierNames = (
  statement: Statement,
  names: HashSet.HashSet<string>,
): HashSet.HashSet<string> => {
  if (!isObjectRecord(statement) || !globalThis.Array.isArray(statement.specifiers)) {
    return names;
  }
  return pipe(
    statement.specifiers,
    Array.reduce(names, (currentNames, specifier) => {
      if (isObjectRecord(specifier)) {
        return collectBindingNames(
          specifier.exported,
          collectBindingNames(specifier.local, currentNames),
        );
      }
      return currentNames;
    }),
  );
};

const collectProtectedNameFromStatement = (
  statement: Statement,
  names: HashSet.HashSet<string>,
): HashSet.HashSet<string> => {
  if (statement.type === 'ImportDeclaration') {
    return collectImportProtectedNames(statement, names);
  }
  if (statement.type === 'ExportNamedDeclaration' && isObjectRecord(statement)) {
    return collectExportSpecifierNames(
      statement,
      collectExportedDeclarationName(statement.declaration, names),
    );
  }
  return names;
};

const sourceProgram = (source: string): ProgramLike | undefined =>
  pipe(
    codemodAPI(source).find(codemodAPI.Program).paths(),
    Array.head,
    Option.map((programPath): ProgramLike => programPath.value),
    Option.getOrUndefined,
  );

const collectProtectedNames = (source: string): HashSet.HashSet<string> =>
  pipe(
    Option.fromNullable(sourceProgram(source)),
    Option.match({
      onNone: (): HashSet.HashSet<string> => HashSet.empty(),
      onSome: (program): HashSet.HashSet<string> =>
        pipe(
          program.body,
          Array.reduce(HashSet.empty<string>(), (protectedNames, statement) =>
            collectProtectedNameFromStatement(statement, protectedNames),
          ),
        ),
    }),
  );

const addObjectPropertyKeyRange = (
  ranges: HashSet.HashSet<string>,
  property: ObjectProperty,
): HashSet.HashSet<string> => {
  if (property.shorthand === true) {
    return pipe(
      ranges,
      HashSet.add(nodeRangeKey(property.key)),
      HashSet.add(nodeRangeKey(property.value)),
    );
  }
  return HashSet.add(ranges, nodeRangeKey(property.key));
};

const isTypeScriptSyntaxNode = (node: unknown): boolean =>
  isObjectRecord(node) && typeof node.type === 'string' && node.type.startsWith('TS');

const hasTypeScriptSyntaxAncestor = (path: { parentPath?: unknown }): boolean => {
  let current = path.parentPath;

  while (isObjectRecord(current)) {
    const { value } = current;
    if (isTypeScriptSyntaxNode(value)) {
      return true;
    }
    current = current.parentPath;
  }

  return false;
};

const collectProtectedRanges = (source: string): HashSet.HashSet<string> => {
  let ranges = HashSet.empty<string>();

  codemodAPI(source)
    .find(codemodAPI.ObjectProperty)
    .forEach((path): void => {
      ranges = addObjectPropertyKeyRange(ranges, path.value);
    });

  codemodAPI(source)
    .find(codemodAPI.Identifier)
    .forEach((path): void => {
      if (hasTypeScriptSyntaxAncestor(path)) {
        ranges = HashSet.add(ranges, nodeRangeKey(path.value));
      }
    });

  return ranges;
};

const shouldSkipIdentifier = (node: Identifier, context: RenameContext): boolean =>
  HashSet.has(context.protectedNames, node.name) ||
  HashSet.has(context.protectedRanges, nodeRangeKey(node));

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
