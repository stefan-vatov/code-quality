/** @internal Conservative codemod for return-position no-ternary fixes. */
import type { BranchInitializerContext, Replacement } from './no-ternary-helpers';
import {
  INDENT_STEP,
  applyReplacements,
  arrowBaseIndent,
  arrowIIFEReturnType,
  branchInitializerText,
  explicitAssignmentText,
  explicitInitializerText,
  explicitReturnText,
  initializerReturnType,
  lineIndent,
  optionalTypeText,
  returnReplacement,
} from './no-ternary-helpers';
import ts from 'typescript';

const branchInitializerKind = (
  statements: ts.NodeArray<ts.Statement>,
  index: number,
  name: string,
): 'const' | 'let' => {
  if (hasLaterWrite(statements, index + 2, name)) {
    return 'let';
  }
  return 'const';
};

const assignmentReplacement = (
  source: string,
  sourceFile: ts.SourceFile,
  node: ts.ExpressionStatement,
): Replacement | undefined => {
  if (
    !ts.isBinaryExpression(node.expression) ||
    node.expression.operatorToken.kind !== ts.SyntaxKind.EqualsToken
  ) {
    return undefined;
  }

  const assignment = node.expression;
  if (!ts.isConditionalExpression(assignment.right)) {
    return undefined;
  }

  const indent = lineIndent(source, node.getStart(sourceFile));
  const text = explicitAssignmentText(source, sourceFile, assignment, assignment.right, indent);
  if (text) {
    return { end: node.getEnd(), start: node.getStart(sourceFile), text };
  }
  return undefined;
};

const assignedExpression = (statement: ts.Statement, name: string): ts.Expression | undefined => {
  const candidate = ((): ts.Statement => {
    if (ts.isBlock(statement) && statement.statements.length === 1) {
      return statement.statements[0];
    }
    return statement;
  })();
  if (
    !candidate ||
    !ts.isExpressionStatement(candidate) ||
    !ts.isBinaryExpression(candidate.expression)
  ) {
    return undefined;
  }

  const assignment = candidate.expression;
  if (
    assignment.operatorToken.kind !== ts.SyntaxKind.EqualsToken ||
    !ts.isIdentifier(assignment.left)
  ) {
    return undefined;
  }
  if (assignment.left.text !== name) {
    return undefined;
  }
  return assignment.right;
};

const writesIdentifier = (node: ts.Node, name: string): boolean => {
  if (
    ts.isBinaryExpression(node) &&
    node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
    ts.isIdentifier(node.left)
  ) {
    return node.left.text === name;
  }
  if (
    (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
    ts.isIdentifier(node.operand)
  ) {
    return node.operand.text === name;
  }

  let hasWrite = false;
  const visit = (child: ts.Node): void => {
    if (hasWrite) {
      return;
    }
    hasWrite = writesIdentifier(child, name);
  };
  ts.forEachChild(node, visit);
  return hasWrite;
};

const hasLaterWrite = (
  statements: ts.NodeArray<ts.Statement>,
  startIndex: number,
  name: string,
): boolean => {
  for (let idx = startIndex; idx < statements.length; idx += 1) {
    if (writesIdentifier(statements[idx], name)) {
      return true;
    }
  }
  return false;
};

const branchInitializerTextFor = (context: BranchInitializerContext): string | undefined => {
  const { declaration, ifStatement, index, source, sourceFile, statements } = context;
  const branchExpressions = branchAssignmentExpressions(sourceFile, ifStatement, declaration);
  if (!branchExpressions) {
    return undefined;
  }
  const { name, whenFalse, whenTrue } = branchExpressions;

  const returnType = initializerReturnType(source, sourceFile, declaration, whenTrue, whenFalse);
  if (!returnType) {
    return undefined;
  }

  return branchInitializerText({
    condition: source.slice(
      ifStatement.expression.getStart(sourceFile),
      ifStatement.expression.getEnd(),
    ),
    falseText: source.slice(whenFalse.getStart(sourceFile), whenFalse.getEnd()),
    indent: lineIndent(source, statements[index].getStart(sourceFile)),
    keyword: branchInitializerKind(statements, index, name),
    name,
    returnType,
    trueText: source.slice(whenTrue.getStart(sourceFile), whenTrue.getEnd()),
    typeText: optionalTypeText(declaration, returnType),
  });
};

const branchAssignmentExpressions = (
  sourceFile: ts.SourceFile,
  ifStatement: ts.IfStatement,
  declaration: ts.VariableDeclaration,
): { name: string; whenFalse: ts.Expression; whenTrue: ts.Expression } | undefined => {
  const name = declaration.name.getText(sourceFile);
  const whenTrue = assignedExpression(ifStatement.thenStatement, name);
  if (!ifStatement.elseStatement) {
    return undefined;
  }
  const whenFalse = assignedExpression(ifStatement.elseStatement, name);
  if (!whenTrue || !whenFalse) {
    return undefined;
  }
  return { name, whenFalse, whenTrue };
};

const branchInitializerDeclaration = (
  statements: ts.NodeArray<ts.Statement>,
  index: number,
):
  | {
      declaration: ts.VariableDeclaration;
      declarationStatement: ts.VariableStatement;
      ifStatement: ts.IfStatement;
    }
  | undefined => {
  const declarationStatement = statements[index];
  const ifStatement = statements[index + 1];
  if (
    !declarationStatement ||
    !ifStatement ||
    !ts.isVariableStatement(declarationStatement) ||
    !ts.isIfStatement(ifStatement)
  ) {
    return undefined;
  }
  if (declarationStatement.declarationList.declarations.length !== 1) {
    return undefined;
  }
  const [declaration] = declarationStatement.declarationList.declarations;
  if (
    !declaration ||
    declaration.initializer ||
    !ts.isIdentifier(declaration.name) ||
    !ifStatement.elseStatement
  ) {
    return undefined;
  }
  return { declaration, declarationStatement, ifStatement };
};

const branchInitializerReplacement = (
  source: string,
  sourceFile: ts.SourceFile,
  statements: ts.NodeArray<ts.Statement>,
  index: number,
): Replacement | undefined => {
  const branchDeclaration = branchInitializerDeclaration(statements, index);
  if (!branchDeclaration) {
    return undefined;
  }
  const { declaration, declarationStatement, ifStatement } = branchDeclaration;

  const text = branchInitializerTextFor({
    declaration,
    ifStatement,
    index,
    source,
    sourceFile,
    statements,
  });
  if (!text) {
    return undefined;
  }

  return {
    end: ifStatement.getEnd(),
    start: declarationStatement.getStart(sourceFile),
    text,
  };
};

const isWhitespaceChar = (char: string | undefined): boolean =>
  char === ' ' || char === '\n' || char === '\r' || char === '\t';

const arrowReturnTypeInsertPosition = (
  source: string,
  sourceFile: ts.SourceFile,
  arrow: ts.ArrowFunction,
): number => {
  let insertAt = arrow.equalsGreaterThanToken.getStart(sourceFile);
  while (insertAt > arrow.getStart(sourceFile) && isWhitespaceChar(source[insertAt - 1])) {
    insertAt -= 1;
  }
  return insertAt;
};

const collectBranchInitializerRepairs = (
  source: string,
  sourceFile: ts.SourceFile,
  statements: ts.NodeArray<ts.Statement>,
  replacements: Replacement[],
): void => {
  for (let idx = 0; idx < statements.length - 1; idx += 1) {
    const replacement = branchInitializerReplacement(source, sourceFile, statements, idx);
    if (replacement) {
      replacements.push(replacement);
      idx += 1;
    }
  }
};

const zeroArgArrowIIFE = (declaration: ts.VariableDeclaration): ts.ArrowFunction | undefined => {
  if (!declaration.initializer || !ts.isCallExpression(declaration.initializer)) {
    return undefined;
  }

  const callee = declaration.initializer.expression;
  if (!ts.isParenthesizedExpression(callee) || !ts.isArrowFunction(callee.expression)) {
    return undefined;
  }

  const arrow = callee.expression;
  if (arrow.parameters.length > 0 || arrow.type) {
    return undefined;
  }
  return arrow;
};

const arrowIIFEReturnTypeReplacement = (
  source: string,
  sourceFile: ts.SourceFile,
  declaration: ts.VariableDeclaration,
): Replacement | undefined => {
  const arrow = zeroArgArrowIIFE(declaration);
  if (!arrow) {
    return undefined;
  }

  const returnType = arrowIIFEReturnType(source, sourceFile, declaration, arrow);
  if (!returnType) {
    return undefined;
  }

  const insertAt = arrowReturnTypeInsertPosition(source, sourceFile, arrow);
  return { end: insertAt, start: insertAt, text: `: ${returnType}` };
};

const initializerReplacement = (
  source: string,
  sourceFile: ts.SourceFile,
  node: ts.VariableStatement,
  declaration: ts.VariableDeclaration,
): Replacement | undefined => {
  const { initializer } = declaration;
  if (!initializer) {
    return undefined;
  }
  if (!ts.isConditionalExpression(initializer)) {
    return arrowIIFEReturnTypeReplacement(source, sourceFile, declaration);
  }

  const text = explicitInitializerText({
    declaration,
    expression: initializer,
    indent: lineIndent(source, node.getStart(sourceFile)),
    source,
    sourceFile,
    statement: node,
  });
  if (!text) {
    return undefined;
  }
  return { end: node.getEnd(), start: node.getStart(sourceFile), text };
};

const variableReplacement = (
  source: string,
  sourceFile: ts.SourceFile,
  node: ts.VariableStatement,
): Replacement | undefined => {
  if (node.modifiers?.some((modifier): boolean => modifier.kind === ts.SyntaxKind.ExportKeyword)) {
    return undefined;
  }
  if (node.declarationList.declarations.length !== 1) {
    return undefined;
  }

  const [declaration] = node.declarationList.declarations;
  if (!declaration?.initializer) {
    return undefined;
  }
  return initializerReplacement(source, sourceFile, node, declaration);
};

const arrowReplacement = (
  source: string,
  sourceFile: ts.SourceFile,
  node: ts.ArrowFunction,
): Replacement | undefined => {
  if (!ts.isConditionalExpression(node.body)) {
    return undefined;
  }

  const baseIndent = arrowBaseIndent(source, sourceFile, node);
  const bodyIndent = `${baseIndent}${INDENT_STEP}`;
  const branchText = explicitReturnText(source, sourceFile, node.body, bodyIndent);
  if (!branchText) {
    return undefined;
  }

  return {
    end: node.body.getEnd(),
    start: node.body.getStart(sourceFile),
    text: `{\n${bodyIndent}${branchText}\n${baseIndent}}`,
  };
};

const collectReplacement = (
  replacements: Replacement[],
  replacement: Replacement | undefined,
): boolean => {
  if (!replacement) {
    return false;
  }
  replacements.push(replacement);
  return true;
};

const replacementForNode = (
  source: string,
  sourceFile: ts.SourceFile,
  node: ts.Node,
): Replacement | undefined => {
  if (ts.isExpressionStatement(node)) {
    return assignmentReplacement(source, sourceFile, node);
  }
  if (ts.isVariableStatement(node)) {
    return variableReplacement(source, sourceFile, node);
  }
  if (ts.isReturnStatement(node)) {
    return returnReplacement(source, sourceFile, node);
  }
  if (ts.isArrowFunction(node)) {
    return arrowReplacement(source, sourceFile, node);
  }
  return undefined;
};

/** Internal helper exported for package-local composition.
 *
 * @internal
 */
export const preferExplicitBranches = (source: string): string => {
  const sourceFile = ts.createSourceFile('codemod.ts', source, ts.ScriptTarget.Latest, true);
  const replacements: Replacement[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isSourceFile(node) || ts.isBlock(node)) {
      collectBranchInitializerRepairs(source, sourceFile, node.statements, replacements);
    }
    if (collectReplacement(replacements, replacementForNode(source, sourceFile, node))) {
      return;
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return applyReplacements(source, replacements);
};
