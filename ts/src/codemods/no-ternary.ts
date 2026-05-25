/* -------------------------------------------------------------------------- */
/*         Conservative codemod for return-position no-ternary fixes.         */
/* -------------------------------------------------------------------------- */
import { Array, HashSet, Option, Order, Predicate, pipe } from 'effect';
import type {
  ArrowFunctionExpression,
  AssignmentExpression,
  ConditionalExpression,
  ExpressionStatement,
  ReturnStatement,
  VariableDeclaration,
} from 'jscodeshift';
import { collectBranchInitializerRepairs } from './no-ternary-branch-initializers';
import jscodeshift from 'jscodeshift';
import { variableReplacement } from './no-ternary-variable-initializers';

interface Replacement {
  end: number;
  start: number;
  text: string;
}

const INDENT_STEP = '  ';
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

const lineIndent = (source: string, index: number): string => {
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

const containsConditionalExpressionInValue = (node: unknown, seen: WeakSet<object>): boolean => {
  if (globalThis.Array.isArray(node)) {
    return pipe(
      node,
      Array.some((entry): boolean => containsConditionalExpressionInValue(entry, seen)),
    );
  }
  if (!isObjectRecord(node)) {
    return false;
  }
  if (seen.has(node)) {
    return false;
  }
  seen.add(node);
  if (node.type === 'ConditionalExpression') {
    return true;
  }
  return pipe(
    Object.values(node),
    Array.some((entry): boolean => containsConditionalExpressionInValue(entry, seen)),
  );
};

const containsConditionalExpression = (node: unknown): boolean =>
  containsConditionalExpressionInValue(node, new WeakSet());

const hasUnsafeBranches = (expression: ConditionalExpression): boolean =>
  containsConditionalExpression(expression.consequent) ||
  containsConditionalExpression(expression.alternate);

const explicitReturnText = (
  source: string,
  expression: ConditionalExpression,
  indent: string,
): string | undefined =>
  pipe(
    Option.some(expression),
    Option.filter((value): boolean => !hasUnsafeBranches(value)),
    Option.map((value): string => {
      const condition = sourceForNode(source, value.test);
      const whenTrue = sourceForNode(source, value.consequent);
      const whenFalse = sourceForNode(source, value.alternate);
      const childIndent = `${indent}${INDENT_STEP}`;

      return [
        `if (${condition}) {`,
        `${childIndent}return ${whenTrue};`,
        `${indent}}`,
        `${indent}return ${whenFalse};`,
      ].join('\n');
    }),
    Option.getOrUndefined,
  );

const returnReplacement = (source: string, node: ReturnStatement): Replacement | undefined =>
  pipe(
    Option.fromNullable(node.argument),
    Option.filter(
      (argument): argument is ConditionalExpression => argument.type === 'ConditionalExpression',
    ),
    Option.flatMap((argument) =>
      pipe(
        Option.fromNullable(
          explicitReturnText(source, argument, lineIndent(source, nodeStart(node))),
        ),
        Option.map((text): Replacement => ({ end: nodeEnd(node), start: nodeStart(node), text })),
      ),
    ),
    Option.getOrUndefined,
  );

const explicitAssignmentText = (
  source: string,
  assignment: AssignmentExpression,
  expression: ConditionalExpression,
  indent: string,
): string | undefined =>
  pipe(
    Option.some(expression),
    Option.filter((value): boolean => !hasUnsafeBranches(value)),
    Option.map((value): string => {
      const left = sourceForNode(source, assignment.left);
      const condition = sourceForNode(source, value.test);
      const whenTrue = sourceForNode(source, value.consequent);
      const whenFalse = sourceForNode(source, value.alternate);
      const childIndent = `${indent}${INDENT_STEP}`;

      return [
        `if (${condition}) {`,
        `${childIndent}${left} = ${whenTrue};`,
        `${indent}} else {`,
        `${childIndent}${left} = ${whenFalse};`,
        `${indent}}`,
      ].join('\n');
    }),
    Option.getOrUndefined,
  );

const assignmentReplacement = (
  source: string,
  node: ExpressionStatement,
): Replacement | undefined =>
  pipe(
    Option.some(node.expression),
    Option.filter(
      (expression): expression is AssignmentExpression =>
        expression.type === 'AssignmentExpression' && expression.operator === '=',
    ),
    Option.flatMap((assignment) =>
      pipe(
        Option.some(assignment.right),
        Option.filter(
          (right): right is ConditionalExpression => right.type === 'ConditionalExpression',
        ),
        Option.flatMap((right) =>
          Option.fromNullable(
            explicitAssignmentText(source, assignment, right, lineIndent(source, nodeStart(node))),
          ),
        ),
        Option.map((text): Replacement => ({ end: nodeEnd(node), start: nodeStart(node), text })),
      ),
    ),
    Option.getOrUndefined,
  );

const arrowBaseIndent = (source: string, node: ArrowFunctionExpression): string => {
  const arrowLineStart = source.lastIndexOf('\n', nodeStart(node));
  return pipe(
    Option.some(arrowLineStart),
    Option.map((lineStart): string => {
      if (lineStart === NOT_FOUND_INDEX) {
        return '';
      }
      return lineIndent(source, nodeStart(node));
    }),
    Option.getOrElse((): string => ''),
  );
};

const arrowReplacement = (source: string, node: ArrowFunctionExpression): Replacement | undefined =>
  pipe(
    Option.some(node.body),
    Option.filter((body): body is ConditionalExpression => body.type === 'ConditionalExpression'),
    Option.flatMap((body) => {
      const baseIndent = arrowBaseIndent(source, node);
      const bodyIndent = `${baseIndent}${INDENT_STEP}`;
      return pipe(
        Option.fromNullable(explicitReturnText(source, body, bodyIndent)),
        Option.map(
          (branchText): Replacement => ({
            end: nodeEnd(body),
            start: nodeStart(body),
            text: `{\n${bodyIndent}${branchText}\n${baseIndent}}`,
          }),
        ),
      );
    }),
    Option.getOrUndefined,
  );

const replacementOverlaps = (replacements: readonly Replacement[], candidate: unknown): boolean => {
  const start = nodeStart(candidate);
  const end = nodeEnd(candidate);
  return pipe(
    replacements,
    Array.some((replacement): boolean => start >= replacement.start && end <= replacement.end),
  );
};

const collectExportedVariableKeys = (source: string): HashSet.HashSet<string> => {
  let exported = HashSet.empty<string>();
  codemodAPI(source)
    .find(codemodAPI.ExportNamedDeclaration)
    .forEach((path): void => {
      const { declaration } = path.value;
      if (declaration?.type === 'VariableDeclaration') {
        exported = HashSet.add(exported, `${nodeStart(declaration)}:${nodeEnd(declaration)}`);
      }
    });
  return exported;
};

const isExportedVariableDeclaration = (
  exported: HashSet.HashSet<string>,
  node: VariableDeclaration,
): boolean => HashSet.has(exported, `${nodeStart(node)}:${nodeEnd(node)}`);

const collectStatementReplacements = (source: string, replacements: Replacement[]): void => {
  const root = codemodAPI(source);
  const exportedVariables = collectExportedVariableKeys(source);

  root.find(codemodAPI.ExpressionStatement).forEach((path): void => {
    if (!replacementOverlaps(replacements, path.value)) {
      pipe(
        Option.fromNullable(assignmentReplacement(source, path.value)),
        Option.map((replacement): number => replacements.push(replacement)),
      );
    }
  });

  root.find(codemodAPI.VariableDeclaration).forEach((path): void => {
    if (
      !isExportedVariableDeclaration(exportedVariables, path.value) &&
      !replacementOverlaps(replacements, path.value)
    ) {
      pipe(
        Option.fromNullable(variableReplacement(source, path.value)),
        Option.map((replacement): number => replacements.push(replacement)),
      );
    }
  });

  root.find(codemodAPI.ReturnStatement).forEach((path): void => {
    if (!replacementOverlaps(replacements, path.value)) {
      pipe(
        Option.fromNullable(returnReplacement(source, path.value)),
        Option.map((replacement): number => replacements.push(replacement)),
      );
    }
  });

  root.find(codemodAPI.ArrowFunctionExpression).forEach((path): void => {
    if (!replacementOverlaps(replacements, path.value)) {
      pipe(
        Option.fromNullable(arrowReplacement(source, path.value)),
        Option.map((replacement): number => replacements.push(replacement)),
      );
    }
  });
};

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const preferExplicitBranches = (source: string): string => {
  const replacements: Replacement[] = [];
  const root = codemodAPI(source);
  pipe(
    root.find(codemodAPI.Program).paths(),
    Array.head,
    Option.map((program): void =>
      collectBranchInitializerRepairs(source, program.value.body, replacements),
    ),
  );
  root.find(codemodAPI.BlockStatement).forEach((path): void => {
    collectBranchInitializerRepairs(source, path.value.body, replacements);
  });
  collectStatementReplacements(source, replacements);
  return applyReplacements(source, replacements);
};
