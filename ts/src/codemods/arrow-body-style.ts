/* -------------------------------------------------------------------------- */
/*         Conservative codemod for arrow-body-style concise bodies.          */
/* -------------------------------------------------------------------------- */
import { Array, Option, Order, Predicate, pipe } from 'effect';
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

const sourceForNode = (source: string, node: unknown): string =>
  source.slice(nodeStart(node), nodeEnd(node));

const hasAttachedComments = (node: ReturnStatement): boolean =>
  pipe(
    [
      Option.fromNullable(node.comments),
      pipe(
        Option.some(node as unknown),
        Option.filter(isObjectRecord),
        Option.flatMapNullable((value) => value.leadingComments),
        Option.filter(globalThis.Array.isArray),
      ),
      pipe(
        Option.some(node as unknown),
        Option.filter(isObjectRecord),
        Option.flatMapNullable((value) => value.trailingComments),
        Option.filter(globalThis.Array.isArray),
      ),
    ],
    Array.some((comments): boolean =>
      pipe(
        comments,
        Option.exists((values): boolean => values.length > 0),
      ),
    ),
  );

const expressionNeedsParentheses = (expression: Expression): boolean =>
  expression.type === 'ObjectExpression';

const lineEndAfter = (source: string, end: number): number => {
  const nextLineBreak = source.indexOf('\n', end);
  return pipe(
    Option.some(nextLineBreak),
    Option.map((lineBreak): number => {
      if (lineBreak === NOT_FOUND_INDEX) {
        return source.length;
      }
      return lineBreak;
    }),
    Option.getOrElse((): number => source.length),
  );
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
  return pipe(
    Option.some(expressionText),
    Option.map((text): string => {
      if (expressionNeedsParentheses(expression)) {
        return `(${text})`;
      }
      return text;
    }),
    Option.getOrElse((): string => expressionText),
  );
};

interface OnlyReturnStatement {
  expression: Expression;
  statement: ReturnStatement;
}

const onlyReturnStatement = (body: BlockStatement): OnlyReturnStatement | undefined =>
  pipe(
    body.body,
    Option.liftPredicate((statements): boolean => statements.length === 1),
    Option.flatMap(Array.head),
    Option.filter(
      (statement): statement is ReturnStatement => statement.type === 'ReturnStatement',
    ),
    Option.flatMap((statement) =>
      pipe(
        Option.fromNullable(statement.argument),
        Option.map((expression): OnlyReturnStatement => ({ expression, statement })),
      ),
    ),
    Option.getOrUndefined,
  );

const replacementForReturnExpression = (
  source: string,
  node: ArrowFunctionExpression,
  expression: Expression,
): Replacement | undefined => {
  const text = replacementTextForExpression(source, expression);
  return pipe(
    Option.some({ end: nodeEnd(node.body), start: nodeStart(node.body), text }),
    Option.filter(
      (replacement): boolean =>
        !wouldExceedLineLimit(source, replacement.start, replacement.end, replacement.text),
    ),
    Option.getOrUndefined,
  );
};

const replacementForArrow = (
  source: string,
  node: ArrowFunctionExpression,
): Replacement | undefined =>
  pipe(
    Option.some(node.body),
    Option.filter((body): body is BlockStatement => body.type === 'BlockStatement'),
    Option.flatMap((body) => Option.fromNullable(onlyReturnStatement(body))),
    Option.filter((result): boolean => !hasAttachedComments(result.statement)),
    Option.flatMap((result) =>
      Option.fromNullable(replacementForReturnExpression(source, node, result.expression)),
    ),
    Option.getOrUndefined,
  );

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
      pipe(
        Option.fromNullable(replacementForArrow(source, path.value)),
        Option.map((replacement): number => replacements.push(replacement)),
      );
    });

  return applyReplacements(source, replacements);
};
