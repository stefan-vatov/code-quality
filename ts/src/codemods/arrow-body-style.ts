/* -------------------------------------------------------------------------- */
/*         Conservative codemod for arrow-body-style concise bodies.          */
/* -------------------------------------------------------------------------- */
import type {
  ArrowFunctionExpression,
  BlockStatement,
  Expression,
  ReturnStatement,
} from 'jscodeshift';
import jscodeshift from 'jscodeshift';

interface Replacement {
  end: number;
  start: number;
  text: string;
}

const MAX_LINE_LENGTH = 150;
const NOT_FOUND_INDEX = -1;
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

const sourceForNode = (source: string, node: unknown): string =>
  source.slice(nodeStart(node), nodeEnd(node));

const hasAttachedComments = (node: ReturnStatement): boolean =>
  Boolean(
    node.comments?.length ||
    (isObjectRecord(node) &&
      Array.isArray(node.leadingComments) &&
      node.leadingComments.length > 0) ||
    (isObjectRecord(node) &&
      Array.isArray(node.trailingComments) &&
      node.trailingComments.length > 0),
  );

const expressionNeedsParentheses = (expression: Expression): boolean =>
  expression.type === 'ObjectExpression';

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

const replacementTextForExpression = (source: string, expression: Expression): string => {
  const expressionText = sourceForNode(source, expression);
  if (expressionNeedsParentheses(expression)) {
    return `(${expressionText})`;
  }
  return expressionText;
};

interface OnlyReturnStatement {
  expression: Expression;
  statement: ReturnStatement;
}

const onlyReturnStatement = (body: BlockStatement): OnlyReturnStatement | undefined => {
  if (body.body.length !== 1) {
    return undefined;
  }
  const [statement] = body.body;
  if (statement?.type === 'ReturnStatement' && statement.argument) {
    return { expression: statement.argument, statement };
  }
  return undefined;
};

const replacementForReturnExpression = (
  source: string,
  node: ArrowFunctionExpression,
  expression: Expression,
): Replacement | undefined => {
  const text = replacementTextForExpression(source, expression);
  if (wouldExceedLineLimit(source, nodeStart(node.body), nodeEnd(node.body), text)) {
    return undefined;
  }
  return { end: nodeEnd(node.body), start: nodeStart(node.body), text };
};

const replacementForArrow = (
  source: string,
  node: ArrowFunctionExpression,
): Replacement | undefined => {
  if (node.body.type !== 'BlockStatement') {
    return undefined;
  }
  const result = onlyReturnStatement(node.body);
  if (!result) {
    return undefined;
  }
  if (hasAttachedComments(result.statement)) {
    return undefined;
  }

  return replacementForReturnExpression(source, node, result.expression);
};

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const preferConciseArrowBodies = (source: string): string => {
  const replacements: Replacement[] = [];

  codemodAPI(source)
    .find(codemodAPI.ArrowFunctionExpression)
    .forEach((path): void => {
      const replacement = replacementForArrow(source, path.value);
      if (replacement) {
        replacements.push(replacement);
      }
    });

  return applyReplacements(source, replacements);
};
