/* -------------------------------------------------------------------------- */
/*         Conservative codemod for return-position no-ternary fixes.         */
/* -------------------------------------------------------------------------- */
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
  if (Array.isArray(node)) {
    return node.some((entry) => containsConditionalExpressionInValue(entry, seen));
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
  return Object.values(node).some((entry) => containsConditionalExpressionInValue(entry, seen));
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
): string | undefined => {
  if (hasUnsafeBranches(expression)) {
    return undefined;
  }

  const condition = sourceForNode(source, expression.test);
  const whenTrue = sourceForNode(source, expression.consequent);
  const whenFalse = sourceForNode(source, expression.alternate);
  const childIndent = `${indent}${INDENT_STEP}`;

  return [
    `if (${condition}) {`,
    `${childIndent}return ${whenTrue};`,
    `${indent}}`,
    `${indent}return ${whenFalse};`,
  ].join('\n');
};

const returnReplacement = (source: string, node: ReturnStatement): Replacement | undefined => {
  if (node.argument?.type !== 'ConditionalExpression') {
    return undefined;
  }

  const indent = lineIndent(source, nodeStart(node));
  const text = explicitReturnText(source, node.argument, indent);
  if (text) {
    return { end: nodeEnd(node), start: nodeStart(node), text };
  }
  return undefined;
};

const explicitAssignmentText = (
  source: string,
  assignment: AssignmentExpression,
  expression: ConditionalExpression,
  indent: string,
): string | undefined => {
  if (hasUnsafeBranches(expression)) {
    return undefined;
  }

  const left = sourceForNode(source, assignment.left);
  const condition = sourceForNode(source, expression.test);
  const whenTrue = sourceForNode(source, expression.consequent);
  const whenFalse = sourceForNode(source, expression.alternate);
  const childIndent = `${indent}${INDENT_STEP}`;

  return [
    `if (${condition}) {`,
    `${childIndent}${left} = ${whenTrue};`,
    `${indent}} else {`,
    `${childIndent}${left} = ${whenFalse};`,
    `${indent}}`,
  ].join('\n');
};

const assignmentReplacement = (
  source: string,
  node: ExpressionStatement,
): Replacement | undefined => {
  if (node.expression.type !== 'AssignmentExpression' || node.expression.operator !== '=') {
    return undefined;
  }

  const assignment = node.expression;
  if (assignment.right.type !== 'ConditionalExpression') {
    return undefined;
  }

  const indent = lineIndent(source, nodeStart(node));
  const text = explicitAssignmentText(source, assignment, assignment.right, indent);
  if (text) {
    return { end: nodeEnd(node), start: nodeStart(node), text };
  }
  return undefined;
};

const arrowBaseIndent = (source: string, node: ArrowFunctionExpression): string => {
  const arrowLineStart = source.lastIndexOf('\n', nodeStart(node));
  if (arrowLineStart === NOT_FOUND_INDEX) {
    return '';
  }
  return lineIndent(source, nodeStart(node));
};

const arrowReplacement = (
  source: string,
  node: ArrowFunctionExpression,
): Replacement | undefined => {
  if (node.body.type !== 'ConditionalExpression') {
    return undefined;
  }

  const baseIndent = arrowBaseIndent(source, node);
  const bodyIndent = `${baseIndent}${INDENT_STEP}`;
  const branchText = explicitReturnText(source, node.body, bodyIndent);
  if (!branchText) {
    return undefined;
  }

  return {
    end: nodeEnd(node.body),
    start: nodeStart(node.body),
    text: `{\n${bodyIndent}${branchText}\n${baseIndent}}`,
  };
};

const replacementOverlaps = (replacements: readonly Replacement[], candidate: unknown): boolean => {
  const start = nodeStart(candidate);
  const end = nodeEnd(candidate);
  return replacements.some(
    (replacement): boolean => start >= replacement.start && end <= replacement.end,
  );
};

const collectExportedVariableKeys = (source: string): ReadonlySet<string> => {
  const exported = new Set<string>();
  codemodAPI(source)
    .find(codemodAPI.ExportNamedDeclaration)
    .forEach((path): void => {
      const { declaration } = path.value;
      if (declaration?.type === 'VariableDeclaration') {
        exported.add(`${nodeStart(declaration)}:${nodeEnd(declaration)}`);
      }
    });
  return exported;
};

const isExportedVariableDeclaration = (
  exported: ReadonlySet<string>,
  node: VariableDeclaration,
): boolean => exported.has(`${nodeStart(node)}:${nodeEnd(node)}`);

const collectStatementReplacements = (source: string, replacements: Replacement[]): void => {
  const root = codemodAPI(source);
  const exportedVariables = collectExportedVariableKeys(source);

  root.find(codemodAPI.ExpressionStatement).forEach((path): void => {
    if (!replacementOverlaps(replacements, path.value)) {
      const replacement = assignmentReplacement(source, path.value);
      if (replacement) {
        replacements.push(replacement);
      }
    }
  });

  root.find(codemodAPI.VariableDeclaration).forEach((path): void => {
    if (
      !isExportedVariableDeclaration(exportedVariables, path.value) &&
      !replacementOverlaps(replacements, path.value)
    ) {
      const replacement = variableReplacement(source, path.value);
      if (replacement) {
        replacements.push(replacement);
      }
    }
  });

  root.find(codemodAPI.ReturnStatement).forEach((path): void => {
    if (!replacementOverlaps(replacements, path.value)) {
      const replacement = returnReplacement(source, path.value);
      if (replacement) {
        replacements.push(replacement);
      }
    }
  });

  root.find(codemodAPI.ArrowFunctionExpression).forEach((path): void => {
    if (!replacementOverlaps(replacements, path.value)) {
      const replacement = arrowReplacement(source, path.value);
      if (replacement) {
        replacements.push(replacement);
      }
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
  const program = root.find(codemodAPI.Program).paths()[0]?.value;
  if (program) {
    collectBranchInitializerRepairs(source, program.body, replacements);
  }
  root.find(codemodAPI.BlockStatement).forEach((path): void => {
    collectBranchInitializerRepairs(source, path.value.body, replacements);
  });
  collectStatementReplacements(source, replacements);
  return applyReplacements(source, replacements);
};
