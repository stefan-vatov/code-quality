/** @internal Conservative codemod for arrow-body-style concise bodies. */
import ts from 'typescript';

interface Replacement {
  end: number;
  start: number;
  text: string;
}

const MAX_LINE_LENGTH = 150;
const NOT_FOUND_INDEX = -1;

const applyReplacements = (source: string, replacements: readonly Replacement[]): string =>
  [...replacements]
    .sort((left, right) => right.start - left.start)
    .reduce(
      (current, replacement) =>
        current.slice(0, replacement.start) + replacement.text + current.slice(replacement.end),
      source,
    );

const hasAttachedComments = (source: string, sourceFile: ts.SourceFile, node: ts.Node): boolean =>
  Boolean(
    ts.getLeadingCommentRanges(source, node.getFullStart())?.length ||
    ts.getTrailingCommentRanges(source, node.getEnd())?.length,
  );

const expressionNeedsParentheses = (expression: ts.Expression): boolean =>
  ts.isObjectLiteralExpression(expression);

const lineEndAfter = (source: string, end: number): number => {
  const nextLineBreak = source.indexOf('\n', end);
  if (nextLineBreak === NOT_FOUND_INDEX) {
    return source.length;
  }
  return nextLineBreak;
};

const wouldExceedLineLimit = (
  source: string,
  start: number,
  end: number,
  replacementText: string,
): boolean => {
  if (replacementText.includes('\n')) {
    return false;
  }
  const lineStart = source.lastIndexOf('\n', start) + 1;
  const lineEnd = lineEndAfter(source, end);
  const line = source.slice(lineStart, start) + replacementText + source.slice(end, lineEnd);
  return line.length > MAX_LINE_LENGTH;
};

const replacementTextForExpression = (
  source: string,
  sourceFile: ts.SourceFile,
  expression: ts.Expression,
): string => {
  const expressionText = source.slice(expression.getStart(sourceFile), expression.getEnd());
  if (expressionNeedsParentheses(expression)) {
    return `(${expressionText})`;
  }
  return expressionText;
};

interface OnlyReturnStatement {
  expression: ts.Expression;
  statement: ts.ReturnStatement;
}

const onlyReturnStatement = (node: ts.ArrowFunction): OnlyReturnStatement | undefined => {
  if (!ts.isBlock(node.body) || node.body.statements.length !== 1) {
    return undefined;
  }
  const [statement] = node.body.statements;
  if (statement && ts.isReturnStatement(statement) && statement.expression) {
    return { expression: statement.expression, statement };
  }
  return undefined;
};

const replacementForReturnExpression = (
  source: string,
  sourceFile: ts.SourceFile,
  node: ts.ArrowFunction,
  expression: ts.Expression,
): Replacement | undefined => {
  const text = replacementTextForExpression(source, sourceFile, expression);
  if (wouldExceedLineLimit(source, node.body.getStart(sourceFile), node.body.getEnd(), text)) {
    return undefined;
  }
  return { end: node.body.getEnd(), start: node.body.getStart(sourceFile), text };
};

const replacementForArrow = (
  source: string,
  sourceFile: ts.SourceFile,
  node: ts.ArrowFunction,
): Replacement | undefined => {
  const result = onlyReturnStatement(node);
  if (!result) {
    return undefined;
  }
  if (hasAttachedComments(source, sourceFile, result.statement)) {
    return undefined;
  }

  return replacementForReturnExpression(source, sourceFile, node, result.expression);
};

/** Internal helper exported for package-local composition.
 *
 * @internal
 */
export const preferConciseArrowBodies = (source: string): string => {
  const sourceFile = ts.createSourceFile('codemod.ts', source, ts.ScriptTarget.Latest, true);
  const replacements: Replacement[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isArrowFunction(node)) {
      const replacement = replacementForArrow(source, sourceFile, node);
      if (replacement) {
        replacements.push(replacement);
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return applyReplacements(source, replacements);
};
