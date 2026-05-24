/* -------------------------------------------------------------------------- */
/*                  Shared no-ternary codemod text helpers.                   */
/* -------------------------------------------------------------------------- */
import ts from 'typescript';

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export interface Replacement {
  end: number;
  start: number;
  text: string;
}

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export interface InitializerTextInput {
  declaration: ts.VariableDeclaration;
  expression: ts.ConditionalExpression;
  indent: string;
  source: string;
  sourceFile: ts.SourceFile;
  statement: ts.VariableStatement;
}

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export interface BranchTextInput {
  condition: string;
  falseText: string;
  indent: string;
  keyword: 'const' | 'let';
  name: string;
  returnType: string;
  trueText: string;
  typeText: string;
}

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export interface BranchInitializerContext {
  declaration: ts.VariableDeclaration;
  ifStatement: ts.IfStatement;
  index: number;
  source: string;
  sourceFile: ts.SourceFile;
  statements: ts.NodeArray<ts.Statement>;
}

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const INDENT_STEP = '  ';
/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const NOT_FOUND_INDEX = -1;

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const applyReplacements = (source: string, replacements: readonly Replacement[]): string =>
  [...replacements]
    .sort((left, right) => right.start - left.start)
    .reduce(
      (current, replacement) =>
        current.slice(0, replacement.start) + replacement.text + current.slice(replacement.end),
      source,
    );

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const lineIndent = (source: string, index: number): string => {
  const lineStart = source.lastIndexOf('\n', index) + 1;
  let cursor = lineStart;
  while (cursor < source.length) {
    const character = source[cursor];
    if (character !== ' ' && character !== '\t') {
      break;
    }
    cursor += 1;
  }
  return source.slice(lineStart, cursor);
};

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const containsConditionalExpression = (node: ts.Node): boolean => {
  if (ts.isConditionalExpression(node)) {
    return true;
  }

  let hasNestedConditional = false;

  const visit = (child: ts.Node): void => {
    if (hasNestedConditional) {
      return;
    }
    if (ts.isConditionalExpression(child)) {
      hasNestedConditional = true;
      return;
    }
    ts.forEachChild(child, visit);
  };

  ts.forEachChild(node, visit);
  return hasNestedConditional;
};

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const explicitReturnText = (
  source: string,
  sourceFile: ts.SourceFile,
  expression: ts.ConditionalExpression,
  indent: string,
): string | undefined => {
  if (
    containsConditionalExpression(expression.whenTrue) ||
    containsConditionalExpression(expression.whenFalse)
  ) {
    return undefined;
  }

  const condition = source.slice(
    expression.condition.getStart(sourceFile),
    expression.condition.getEnd(),
  );
  const whenTrue = source.slice(
    expression.whenTrue.getStart(sourceFile),
    expression.whenTrue.getEnd(),
  );
  const whenFalse = source.slice(
    expression.whenFalse.getStart(sourceFile),
    expression.whenFalse.getEnd(),
  );
  const childIndent = `${indent}${INDENT_STEP}`;

  return [
    `if (${condition}) {`,
    `${childIndent}return ${whenTrue};`,
    `${indent}}`,
    `${indent}return ${whenFalse};`,
  ].join('\n');
};

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const returnReplacement = (
  source: string,
  sourceFile: ts.SourceFile,
  node: ts.ReturnStatement,
): Replacement | undefined => {
  if (!node.expression || !ts.isConditionalExpression(node.expression)) {
    return undefined;
  }

  const indent = lineIndent(source, node.getStart(sourceFile));
  const text = explicitReturnText(source, sourceFile, node.expression, indent);
  if (text) {
    return { end: node.getEnd(), start: node.getStart(sourceFile), text };
  }
  return undefined;
};

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const explicitAssignmentText = (
  source: string,
  sourceFile: ts.SourceFile,
  assignment: ts.BinaryExpression,
  expression: ts.ConditionalExpression,
  indent: string,
): string | undefined => {
  if (
    containsConditionalExpression(expression.whenTrue) ||
    containsConditionalExpression(expression.whenFalse)
  ) {
    return undefined;
  }

  const left = source.slice(assignment.left.getStart(sourceFile), assignment.left.getEnd());
  const condition = source.slice(
    expression.condition.getStart(sourceFile),
    expression.condition.getEnd(),
  );
  const whenTrue = source.slice(
    expression.whenTrue.getStart(sourceFile),
    expression.whenTrue.getEnd(),
  );
  const whenFalse = source.slice(
    expression.whenFalse.getStart(sourceFile),
    expression.whenFalse.getEnd(),
  );
  const childIndent = `${indent}${INDENT_STEP}`;

  return [
    `if (${condition}) {`,
    `${childIndent}${left} = ${whenTrue};`,
    `${indent}} else {`,
    `${childIndent}${left} = ${whenFalse};`,
    `${indent}}`,
  ].join('\n');
};

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const primitiveTypeOf = (expression: ts.Expression): string | undefined => {
  if (ts.isStringLiteralLike(expression)) {
    return 'string';
  }
  if (ts.isNumericLiteral(expression)) {
    return 'number';
  }
  if (
    expression.kind === ts.SyntaxKind.TrueKeyword ||
    expression.kind === ts.SyntaxKind.FalseKeyword
  ) {
    return 'boolean';
  }
  if (expression.kind === ts.SyntaxKind.NullKeyword) {
    return 'null';
  }
  return undefined;
};

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const initializerReturnType = (
  source: string,
  sourceFile: ts.SourceFile,
  declaration: ts.VariableDeclaration,
  whenTrue: ts.Expression,
  whenFalse: ts.Expression,
): string | undefined => {
  if (declaration.type) {
    return source.slice(declaration.type.getStart(sourceFile), declaration.type.getEnd());
  }

  const trueType = primitiveTypeOf(whenTrue);
  const falseType = primitiveTypeOf(whenFalse);
  if (trueType && trueType === falseType) {
    return trueType;
  }
  return undefined;
};

const returnExpressions = (body: ts.Block): ts.Expression[] => {
  const expressions: ts.Expression[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionLike(node) && node !== body.parent) {
      return;
    }
    if (ts.isReturnStatement(node) && node.expression) {
      expressions.push(node.expression);
      return;
    }
    ts.forEachChild(node, visit);
  };

  ts.forEachChild(body, visit);
  return expressions;
};

const commonPrimitiveReturnType = (body: ts.Block): string | undefined => {
  const expressions = returnExpressions(body);
  if (expressions.length === 0) {
    return undefined;
  }

  const firstType = primitiveTypeOf(expressions[0]);
  if (!firstType) {
    return undefined;
  }
  if (expressions.every((expression): boolean => primitiveTypeOf(expression) === firstType)) {
    return firstType;
  }
  return undefined;
};

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const arrowIIFEReturnType = (
  source: string,
  sourceFile: ts.SourceFile,
  declaration: ts.VariableDeclaration,
  arrow: ts.ArrowFunction,
): string | undefined => {
  if (declaration.type) {
    return source.slice(declaration.type.getStart(sourceFile), declaration.type.getEnd());
  }
  if (ts.isBlock(arrow.body)) {
    return commonPrimitiveReturnType(arrow.body);
  }
  return primitiveTypeOf(arrow.body);
};

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const optionalTypeText = (
  declaration: ts.VariableDeclaration,
  returnType: string,
): string => {
  if (declaration.type) {
    return `: ${returnType}`;
  }
  return '';
};

const declarationKind = (statement: ts.VariableStatement): 'const' | 'let' => {
  if (statement.declarationList.flags & ts.NodeFlags.Const) {
    return 'const';
  }
  return 'let';
};

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const branchInitializerText = (input: BranchTextInput): string => {
  const bodyIndent = `${input.indent}${INDENT_STEP}`;
  const returnIndent = `${bodyIndent}${INDENT_STEP}`;
  return [
    `${input.keyword} ${input.name}${input.typeText} = ((): ${input.returnType} => {`,
    `${bodyIndent}if (${input.condition}) {`,
    `${returnIndent}return ${input.trueText};`,
    `${bodyIndent}}`,
    `${bodyIndent}return ${input.falseText};`,
    `${input.indent}})();`,
  ].join('\n');
};

const conditionalBranchSource = (
  source: string,
  sourceFile: ts.SourceFile,
  expression: ts.ConditionalExpression,
): Pick<BranchTextInput, 'condition' | 'falseText' | 'trueText'> => ({
  condition: source.slice(expression.condition.getStart(sourceFile), expression.condition.getEnd()),
  falseText: source.slice(expression.whenFalse.getStart(sourceFile), expression.whenFalse.getEnd()),
  trueText: source.slice(expression.whenTrue.getStart(sourceFile), expression.whenTrue.getEnd()),
});

const branchInputForInitializer = (
  input: InitializerTextInput,
  returnType: string,
): BranchTextInput | undefined => {
  const { declaration, expression, indent, source, sourceFile, statement } = input;
  if (!ts.isIdentifier(declaration.name)) {
    return undefined;
  }
  return {
    ...conditionalBranchSource(source, sourceFile, expression),
    indent,
    keyword: declarationKind(statement),
    name: declaration.name.text,
    returnType,
    typeText: optionalTypeText(declaration, returnType),
  };
};

const initializerReturnTypeFor = (input: InitializerTextInput): string | undefined =>
  initializerReturnType(
    input.source,
    input.sourceFile,
    input.declaration,
    input.expression.whenTrue,
    input.expression.whenFalse,
  );

const hasUnsafeInitializerBranches = (expression: ts.ConditionalExpression): boolean =>
  containsConditionalExpression(expression.whenTrue) ||
  containsConditionalExpression(expression.whenFalse);

const explicitBranchInitializerText = (
  input: InitializerTextInput,
  returnType: string,
): string | undefined => {
  const branchInput = branchInputForInitializer(input, returnType);
  if (!branchInput) {
    return undefined;
  }
  return branchInitializerText(branchInput);
};

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const explicitInitializerText = (input: InitializerTextInput): string | undefined => {
  const { declaration, expression } = input;
  if (!ts.isIdentifier(declaration.name)) {
    return undefined;
  }
  if (hasUnsafeInitializerBranches(expression)) {
    return undefined;
  }

  const returnType = initializerReturnTypeFor(input);
  if (!returnType) {
    return undefined;
  }
  return explicitBranchInitializerText(input, returnType);
};

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const arrowBaseIndent = (
  source: string,
  sourceFile: ts.SourceFile,
  node: ts.ArrowFunction,
): string => {
  const arrowLineStart = source.lastIndexOf('\n', node.getStart(sourceFile));
  if (arrowLineStart === NOT_FOUND_INDEX) {
    return '';
  }
  return lineIndent(source, node.getStart(sourceFile));
};
