/* -------------------------------------------------------------------------- */
/*  AST-backed codemod for correcting repeatable acronym casing violations.   */
/* -------------------------------------------------------------------------- */
import findMisCasedAcronyms, { fixAcronymCase } from '../rules/acronym-case';
import ts from 'typescript';

interface Replacement {
  end: number;
  start: number;
  text: string;
}

const applyReplacements = (source: string, replacements: readonly Replacement[]): string => {
  let output = source;
  const ordered = [...replacements].sort((left, right) => right.start - left.start);

  for (const replacement of ordered) {
    output = output.slice(0, replacement.start) + replacement.text + output.slice(replacement.end);
  }

  return output;
};

const hasExportModifier = (node: ts.Node): boolean => {
  const modifiers = ((): readonly ts.ModifierLike[] | undefined => {
    if (ts.canHaveModifiers(node)) {
      return ts.getModifiers(node);
    }
    return undefined;
  })();
  return (
    modifiers?.some((modifier): boolean => modifier.kind === ts.SyntaxKind.ExportKeyword) ?? false
  );
};

const collectBindingNames = (name: ts.BindingName, protectedNames: Set<string>): void => {
  if (ts.isIdentifier(name)) {
    protectedNames.add(name.text);
    return;
  }

  for (const element of name.elements) {
    if (!ts.isOmittedExpression(element)) {
      collectBindingNames(element.name, protectedNames);
    }
  }
};

const collectImportProtectedNames = (node: ts.ImportClause, protectedNames: Set<string>): void => {
  if (node.name) {
    protectedNames.add(node.name.text);
  }
  if (node.namedBindings && ts.isNamespaceImport(node.namedBindings)) {
    protectedNames.add(node.namedBindings.name.text);
  }
};

const exportedDeclarationName = (node: ts.Node): string | undefined => {
  if (
    (ts.isClassDeclaration(node) ||
      ts.isFunctionDeclaration(node) ||
      ts.isInterfaceDeclaration(node) ||
      ts.isTypeAliasDeclaration(node) ||
      ts.isEnumDeclaration(node)) &&
    node.name &&
    hasExportModifier(node)
  ) {
    return node.name.text;
  }
  return undefined;
};

const collectExportedVariableNames = (
  node: ts.VariableStatement,
  protectedNames: Set<string>,
): void => {
  if (!hasExportModifier(node)) {
    return;
  }
  for (const declaration of node.declarationList.declarations) {
    collectBindingNames(declaration.name, protectedNames);
  }
};

const collectExportSpecifierNames = (
  node: ts.ExportSpecifier,
  protectedNames: Set<string>,
): void => {
  protectedNames.add(node.propertyName?.text ?? node.name.text);
  protectedNames.add(node.name.text);
};

const collectProtectedNameFromNode = (node: ts.Node, protectedNames: Set<string>): void => {
  const exportedName = exportedDeclarationName(node);
  if (ts.isImportClause(node)) {
    collectImportProtectedNames(node, protectedNames);
  } else if (ts.isImportSpecifier(node)) {
    protectedNames.add(node.name.text);
  } else if (exportedName) {
    protectedNames.add(exportedName);
  } else if (ts.isVariableStatement(node)) {
    collectExportedVariableNames(node, protectedNames);
  } else if (ts.isExportSpecifier(node)) {
    collectExportSpecifierNames(node, protectedNames);
  }
};

const collectProtectedNames = (sourceFile: ts.SourceFile): Set<string> => {
  const protectedNames = new Set<string>();

  const visit = (node: ts.Node): void => {
    collectProtectedNameFromNode(node, protectedNames);
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return protectedNames;
};

const isImportOrExportSpecifierName = (node: ts.Identifier): boolean => {
  const { parent } = node;
  return (
    ts.isImportSpecifier(parent) ||
    ts.isExportSpecifier(parent) ||
    ts.isImportClause(parent) ||
    ts.isNamespaceImport(parent) ||
    ts.isExportAssignment(parent)
  );
};

const isObjectPropertyKey = (node: ts.Identifier): boolean => {
  const { parent } = node;
  return ts.isPropertyAssignment(parent) && parent.name === node;
};

const isExportedDeclarationName = (node: ts.Identifier): boolean => {
  const { parent } = node;
  if (
    !(
      ts.isClassDeclaration(parent) ||
      ts.isFunctionDeclaration(parent) ||
      ts.isInterfaceDeclaration(parent) ||
      ts.isTypeAliasDeclaration(parent) ||
      ts.isEnumDeclaration(parent) ||
      ts.isVariableDeclaration(parent)
    )
  ) {
    return false;
  }
  const declaration = ((): ts.Node => {
    if (ts.isVariableDeclaration(parent)) {
      return parent.parent.parent;
    }
    return parent;
  })();
  const modifiers = ((): readonly ts.ModifierLike[] | undefined => {
    if (ts.canHaveModifiers(declaration)) {
      return ts.getModifiers(declaration);
    }
    return undefined;
  })();
  return (
    modifiers?.some((modifier): boolean => modifier.kind === ts.SyntaxKind.ExportKeyword) ?? false
  );
};

const collectIdentifierReplacements = (source: string): Replacement[] => {
  const sourceFile = ts.createSourceFile('codemod.ts', source, ts.ScriptTarget.Latest, true);
  const protectedNames = collectProtectedNames(sourceFile);
  const replacements: Replacement[] = [];

  const shouldSkipIdentifier = (node: ts.Identifier): boolean =>
    protectedNames.has(node.text) ||
    isImportOrExportSpecifierName(node) ||
    isObjectPropertyKey(node) ||
    isExportedDeclarationName(node);

  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node)) {
      const name = node.text;
      if (!shouldSkipIdentifier(node) && findMisCasedAcronyms(name).length > 0) {
        replacements.push({
          end: node.getEnd(),
          start: node.getStart(sourceFile),
          text: fixAcronymCase(name),
        });
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
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
