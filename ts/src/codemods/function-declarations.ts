/** @internal Conservative codemod for safe func-style declaration rewrites. */
import ts from 'typescript';

interface Replacement {
  end: number;
  start: number;
  text: string;
}

const applyReplacements = (source: string, replacements: readonly Replacement[]): string =>
  [...replacements]
    .sort((left, right) => right.start - left.start)
    .reduce(
      (current, replacement) =>
        current.slice(0, replacement.start) + replacement.text + current.slice(replacement.end),
      source,
    );

const hasModifier = (node: ts.FunctionDeclaration, kind: ts.SyntaxKind): boolean =>
  ts.getModifiers(node)?.some((modifier): boolean => modifier.kind === kind) ?? false;

const nodeText = (source: string, node: ts.Node | undefined): string => {
  if (node) {
    return source.slice(node.getStart(), node.getEnd());
  }
  return '';
};

const typeParameterText = (source: string, declaration: ts.FunctionDeclaration): string => {
  if (!declaration.typeParameters) {
    return '';
  }
  const rawTypeParameters = source.slice(
    declaration.name?.end ?? declaration.typeParameters.pos,
    declaration.parameters.pos,
  );
  const parameterListStart = rawTypeParameters.lastIndexOf('(');
  if (parameterListStart === -1) {
    return rawTypeParameters.trim();
  }
  return rawTypeParameters.slice(0, parameterListStart).trim();
};

const parameterText = (source: string, declaration: ts.FunctionDeclaration): string => {
  const [firstParameter] = declaration.parameters;
  const lastParameter = declaration.parameters.at(-1);
  if (!firstParameter || !lastParameter) {
    return '';
  }
  return source.slice(firstParameter.getStart(), lastParameter.getEnd());
};

const hasThisSemantics = (node: ts.FunctionDeclaration): boolean => {
  if (node.parameters.some((parameter): boolean => parameter.name.getText() === 'this')) {
    return true;
  }

  let hasThisExpression = false;
  const visit = (child: ts.Node): void => {
    if (hasThisExpression) {
      return;
    }
    if (child.kind === ts.SyntaxKind.ThisKeyword) {
      hasThisExpression = true;
      return;
    }
    ts.forEachChild(child, visit);
  };

  if (node.body) {
    ts.forEachChild(node.body, visit);
  }
  return hasThisExpression;
};

const referenceSearchRoot = (node: ts.FunctionDeclaration): ts.Node => {
  const { parent } = node;
  if (parent && ts.isBlock(parent)) {
    return parent;
  }
  return node.getSourceFile();
};

const hasEarlierReference = (
  sourceFile: ts.SourceFile,
  root: ts.Node,
  name: string,
  before: number,
): boolean => {
  let hasReference = false;

  const visit = (node: ts.Node): void => {
    if (hasReference || node.getStart(sourceFile) >= before) {
      return;
    }
    if (ts.isFunctionLike(node)) {
      return;
    }
    if (ts.isIdentifier(node) && node.text === name) {
      hasReference = true;
      return;
    }
    ts.forEachChild(node, visit);
  };

  ts.forEachChild(root, visit);
  return hasReference;
};

const asyncPrefixFor = (node: ts.FunctionDeclaration): string => {
  if (hasModifier(node, ts.SyntaxKind.AsyncKeyword)) {
    return 'async ';
  }
  return '';
};

const returnTypeFor = (source: string, node: ts.FunctionDeclaration): string => {
  if (node.type) {
    return `: ${nodeText(source, node.type)}`;
  }
  return '';
};

const exportPrefixFor = (node: ts.FunctionDeclaration): string => {
  if (hasModifier(node, ts.SyntaxKind.ExportKeyword)) {
    return 'export ';
  }
  return '';
};

const declarationText = (source: string, node: ts.FunctionDeclaration, name: string): string => {
  const typeParameters = typeParameterText(source, node);
  const parameters = parameterText(source, node);
  const body = nodeText(source, node.body);
  return `${exportPrefixFor(node)}const ${name} = ${asyncPrefixFor(node)}${typeParameters}(${parameters})${returnTypeFor(source, node)} => ${body};`;
};

const replacementForDeclaration = (
  source: string,
  sourceFile: ts.SourceFile,
  node: ts.FunctionDeclaration,
): Replacement | undefined => {
  if (!node.name || !node.body) {
    return undefined;
  }
  if (hasModifier(node, ts.SyntaxKind.DefaultKeyword)) {
    return undefined;
  }
  if (hasThisSemantics(node)) {
    return undefined;
  }

  const start = node.getStart(sourceFile);
  if (hasEarlierReference(sourceFile, referenceSearchRoot(node), node.name.text, start)) {
    return undefined;
  }

  return { end: node.getEnd(), start, text: declarationText(source, node, node.name.text) };
};

/** Internal helper exported for package-local composition.
 *
 * @internal
 */
export const preferFunctionExpressions = (source: string): string => {
  const sourceFile = ts.createSourceFile('codemod.ts', source, ts.ScriptTarget.Latest, true);
  const replacements: Replacement[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node)) {
      const replacement = replacementForDeclaration(source, sourceFile, node);
      if (replacement) {
        replacements.push(replacement);
        return;
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return applyReplacements(source, replacements);
};
