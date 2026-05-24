/**
 * Conservative codemod for explicit void return types.
 *
 * @internal
 */
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

const hasReturnValue = (node: ts.Node): boolean => {
  let hasFoundReturnValue = false;

  const visit = (child: ts.Node): void => {
    if (hasFoundReturnValue) {
      return;
    }
    if (ts.isFunctionLike(child) && child !== node) {
      return;
    }
    if (ts.isReturnStatement(child) && child.expression) {
      hasFoundReturnValue = true;
      return;
    }
    ts.forEachChild(child, visit);
  };

  ts.forEachChild(node, visit);
  return hasFoundReturnValue;
};

const isAsync = (node: ts.FunctionLikeDeclaration): boolean =>
  ts
    .getModifiers(node)
    ?.some((modifier): boolean => modifier.kind === ts.SyntaxKind.AsyncKeyword) ?? false;

const propertyName = (node: ts.FunctionLikeDeclaration): string | undefined => {
  const { parent } = node;
  if (!parent || !ts.isPropertyAssignment(parent)) {
    return undefined;
  }
  if (ts.isIdentifier(parent.name) || ts.isStringLiteral(parent.name)) {
    return parent.name.text;
  }
  return undefined;
};

const isPredicateCall = (expression: ts.CallExpression): boolean => {
  if (ts.isPropertyAccessExpression(expression.expression)) {
    return expression.expression.name.text === 'test';
  }
  if (ts.isIdentifier(expression.expression)) {
    return /^(?:has|is|should|can)[A-Z]/u.test(expression.expression.text);
  }
  return false;
};

const isBooleanExpression = (expression: ts.Expression): boolean => {
  if (
    expression.kind === ts.SyntaxKind.TrueKeyword ||
    expression.kind === ts.SyntaxKind.FalseKeyword
  ) {
    return true;
  }
  if (
    ts.isPrefixUnaryExpression(expression) &&
    expression.operator === ts.SyntaxKind.ExclamationToken
  ) {
    return true;
  }
  if (ts.isBinaryExpression(expression)) {
    if (isComparisonOperator(expression.operatorToken.kind)) {
      return true;
    }
    if (isBooleanLogicalOperator(expression.operatorToken.kind)) {
      return isBooleanExpression(expression.left) && isBooleanExpression(expression.right);
    }
  }
  return ts.isCallExpression(expression) && isPredicateCall(expression);
};

const isComparisonOperator = (kind: ts.SyntaxKind): boolean =>
  kind === ts.SyntaxKind.EqualsEqualsEqualsToken ||
  kind === ts.SyntaxKind.ExclamationEqualsEqualsToken ||
  kind === ts.SyntaxKind.GreaterThanToken ||
  kind === ts.SyntaxKind.GreaterThanEqualsToken ||
  kind === ts.SyntaxKind.LessThanToken ||
  kind === ts.SyntaxKind.LessThanEqualsToken;

const isBooleanLogicalOperator = (kind: ts.SyntaxKind): boolean =>
  kind === ts.SyntaxKind.AmpersandAmpersandToken || kind === ts.SyntaxKind.BarBarToken;

const primitiveLiteralReturnType = (expression: ts.Expression): string | undefined => {
  if (ts.isStringLiteralLike(expression)) {
    return ': string';
  }
  if (ts.isNumericLiteral(expression)) {
    return ': number';
  }
  if (
    expression.kind === ts.SyntaxKind.TrueKeyword ||
    expression.kind === ts.SyntaxKind.FalseKeyword
  ) {
    return ': boolean';
  }
  return undefined;
};

const parameterTypeText = (parameter: ts.ParameterDeclaration): string | undefined => {
  if (parameter.type && ts.isIdentifier(parameter.name)) {
    return parameter.type.getText();
  }
  return undefined;
};

const stringParameterNames = (node: ts.FunctionLikeDeclaration): Set<string> =>
  new Set(
    node.parameters
      .filter((parameter): boolean => parameterTypeText(parameter) === 'string')
      .map((parameter): string => parameter.name.getText()),
  );

const stringMethodReturnType = (
  node: ts.FunctionLikeDeclaration,
  expression: ts.Expression,
): string | undefined => {
  if (!ts.isCallExpression(expression) || !ts.isPropertyAccessExpression(expression.expression)) {
    return undefined;
  }
  if (!['slice', 'toLowerCase', 'toUpperCase', 'trim'].includes(expression.expression.name.text)) {
    return undefined;
  }
  const receiver = expression.expression.expression;
  if (ts.isIdentifier(receiver) && stringParameterNames(node).has(receiver.text)) {
    return ': string';
  }
  return undefined;
};

const singleReturnExpression = (node: ts.FunctionLikeDeclaration): ts.Expression | undefined => {
  if (ts.isArrowFunction(node) && !ts.isBlock(node.body)) {
    return node.body;
  }
  if (!node.body || !ts.isBlock(node.body) || node.body.statements.length !== 1) {
    return undefined;
  }
  const [statement] = node.body.statements;
  if (!statement || !ts.isReturnStatement(statement)) {
    return undefined;
  }
  return statement.expression;
};

const inferredExpressionReturnTypeText = (node: ts.FunctionLikeDeclaration): string | undefined => {
  const expression = singleReturnExpression(node);
  if (!expression) {
    return undefined;
  }
  if (
    (propertyName(node) === 'check' && expression) ||
    (expression && isBooleanExpression(expression))
  ) {
    return ': boolean';
  }
  const primitiveType = primitiveLiteralReturnType(expression);
  if (primitiveType) {
    return primitiveType;
  }
  return stringMethodReturnType(node, expression);
};

const inferredBodyReturnTypeText = (node: ts.FunctionLikeDeclaration): string | undefined => {
  if (hasReturnValue(node)) {
    return undefined;
  }
  if (isAsync(node)) {
    return ': Promise<void>';
  }
  return ': void';
};

const inferredReturnTypeText = (node: ts.FunctionLikeDeclaration): string | undefined => {
  if (propertyName(node) === 'ast') {
    return ': Record<string, (node: object) => void>';
  }

  const expressionReturnType = inferredExpressionReturnTypeText(node);
  if (expressionReturnType) {
    return expressionReturnType;
  }
  if (singleReturnExpression(node)) {
    return undefined;
  }
  return inferredBodyReturnTypeText(node);
};

const isSupportedFunctionLike = (node: ts.Node): node is ts.FunctionLikeDeclaration => {
  if (!ts.isFunctionLike(node)) {
    return false;
  }
  return 'body' in node;
};

const previousNonWhitespaceIndex = (source: string, index: number): number => {
  let cursor = index;
  while (cursor > 0 && /\s/u.test(source[cursor - 1] ?? '')) {
    cursor -= 1;
  }
  return cursor;
};

const insertionPoint = (source: string, node: ts.FunctionLikeDeclaration): number | undefined => {
  if (!node.body || node.type) {
    return undefined;
  }
  if (ts.isArrowFunction(node)) {
    return previousNonWhitespaceIndex(source, node.equalsGreaterThanToken.getStart());
  }
  return previousNonWhitespaceIndex(source, node.body.getStart());
};

const replacementForFunction = (
  source: string,
  node: ts.FunctionLikeDeclaration,
): Replacement | undefined => {
  const start = insertionPoint(source, node);
  const returnType = inferredReturnTypeText(node);
  if (start === undefined || !returnType) {
    return undefined;
  }
  return { end: start, start, text: returnType };
};

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const addVoidReturnTypes = (source: string): string => {
  const sourceFile = ts.createSourceFile('codemod.ts', source, ts.ScriptTarget.Latest, true);
  const replacements: Replacement[] = [];

  const visit = (node: ts.Node): void => {
    if (isSupportedFunctionLike(node)) {
      const replacement = replacementForFunction(source, node);
      if (replacement) {
        replacements.push(replacement);
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return applyReplacements(source, replacements);
};
