/* -------------------------------------------------------------------------- */
/*       Variable-initializer repairs for the no-ternary codemod only.        */
/* -------------------------------------------------------------------------- */
import type {
  ArrowFunctionExpression,
  BlockStatement,
  ConditionalExpression,
  Expression,
  Identifier,
  Node,
  VariableDeclaration,
  VariableDeclarator,
} from 'jscodeshift';
import jscodeshift from 'jscodeshift';

interface Replacement {
  end: number;
  start: number;
  text: string;
}

interface BranchTextInput {
  condition: string;
  falseText: string;
  indent: string;
  keyword: 'const' | 'let';
  name: string;
  returnType: string;
  trueText: string;
  typeText: string;
}

const INDENT_STEP = '  ';
const NOT_FOUND_INDEX = -1;
const codemodAPI = jscodeshift.withParser('ts');

const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

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

const isIdentifier = (node: Node | null | undefined): node is Identifier =>
  node?.type === 'Identifier';

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

const primitiveTypeOf = (expression: Expression): string | undefined => {
  if (expression.type === 'StringLiteral') {
    return 'string';
  }
  if (expression.type === 'NumericLiteral') {
    return 'number';
  }
  if (expression.type === 'BooleanLiteral') {
    return 'boolean';
  }
  if (expression.type === 'NullLiteral') {
    return 'null';
  }
  return undefined;
};

const declaredTypeText = (source: string, declaration: VariableDeclarator): string | undefined => {
  if (!isIdentifier(declaration.id) || !declaration.id.typeAnnotation) {
    return undefined;
  }
  const raw = sourceForNode(source, declaration.id.typeAnnotation).trim();
  if (raw.startsWith(':')) {
    return raw.slice(1).trim();
  }
  return raw;
};

const initializerReturnType = (
  source: string,
  declaration: VariableDeclarator,
  whenTrue: Expression,
  whenFalse: Expression,
): string | undefined => {
  const declared = declaredTypeText(source, declaration);
  if (declared) {
    return declared;
  }

  const trueType = primitiveTypeOf(whenTrue);
  const falseType = primitiveTypeOf(whenFalse);
  if (trueType && trueType === falseType) {
    return trueType;
  }
  return undefined;
};

const optionalTypeText = (
  source: string,
  declaration: VariableDeclarator,
  returnType: string,
): string => {
  if (declaredTypeText(source, declaration)) {
    return `: ${returnType}`;
  }
  return '';
};

const branchInitializerText = (input: BranchTextInput): string => {
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

const declarationKeyword = (statement: VariableDeclaration): 'const' | 'let' => {
  if (statement.kind === 'const') {
    return 'const';
  }
  return 'let';
};

const explicitInitializerText = (
  source: string,
  statement: VariableDeclaration,
  declaration: VariableDeclarator,
  expression: ConditionalExpression,
  indent: string,
): string | undefined => {
  if (!isIdentifier(declaration.id) || hasUnsafeBranches(expression)) {
    return undefined;
  }

  const returnType = initializerReturnType(
    source,
    declaration,
    expression.consequent,
    expression.alternate,
  );
  if (!returnType) {
    return undefined;
  }

  return branchInitializerText({
    condition: sourceForNode(source, expression.test),
    falseText: sourceForNode(source, expression.alternate),
    indent,
    keyword: declarationKeyword(statement),
    name: declaration.id.name,
    returnType,
    trueText: sourceForNode(source, expression.consequent),
    typeText: optionalTypeText(source, declaration, returnType),
  });
};

const isWhitespaceChar = (char: string | undefined): boolean =>
  char === ' ' || char === '\n' || char === '\r' || char === '\t';

const arrowReturnTypeInsertPosition = (source: string, arrow: ArrowFunctionExpression): number => {
  const bodyStart = nodeStart(arrow.body);
  const arrowStart = source.lastIndexOf('=>', bodyStart);
  let insertAt = bodyStart;
  if (arrowStart !== NOT_FOUND_INDEX) {
    insertAt = arrowStart;
  }
  while (insertAt > nodeStart(arrow) && isWhitespaceChar(source[insertAt - 1])) {
    insertAt -= 1;
  }
  return insertAt;
};

const returnExpressions = (body: BlockStatement): Expression[] =>
  codemodAPI(body)
    .find(codemodAPI.ReturnStatement)
    .paths()
    .flatMap((path): Expression[] => {
      if (path.value.argument) {
        return [path.value.argument];
      }
      return [];
    });

const commonPrimitiveReturnType = (body: BlockStatement): string | undefined => {
  const expressions = returnExpressions(body);
  const [firstExpression] = expressions;
  if (!firstExpression) {
    return undefined;
  }

  const firstType = primitiveTypeOf(firstExpression);
  if (!firstType) {
    return undefined;
  }
  if (expressions.every((expression): boolean => primitiveTypeOf(expression) === firstType)) {
    return firstType;
  }
  return undefined;
};

const arrowIIFEReturnType = (
  source: string,
  declaration: VariableDeclarator,
  arrow: ArrowFunctionExpression,
): string | undefined => {
  const declared = declaredTypeText(source, declaration);
  if (declared) {
    return declared;
  }
  if (arrow.body.type === 'BlockStatement') {
    return commonPrimitiveReturnType(arrow.body);
  }
  return primitiveTypeOf(arrow.body);
};

const zeroArgArrowIIFE = (declaration: VariableDeclarator): ArrowFunctionExpression | undefined => {
  if (declaration.init?.type !== 'CallExpression') {
    return undefined;
  }
  const { callee } = declaration.init;
  if (callee.type !== 'ArrowFunctionExpression' || callee.params.length > 0 || callee.returnType) {
    return undefined;
  }
  return callee;
};

const arrowIIFEReturnTypeReplacement = (
  source: string,
  declaration: VariableDeclarator,
): Replacement | undefined => {
  const arrow = zeroArgArrowIIFE(declaration);
  if (!arrow) {
    return undefined;
  }

  const returnType = arrowIIFEReturnType(source, declaration, arrow);
  if (!returnType) {
    return undefined;
  }

  const insertAt = arrowReturnTypeInsertPosition(source, arrow);
  return { end: insertAt, start: insertAt, text: `: ${returnType}` };
};

const initializerReplacement = (
  source: string,
  node: VariableDeclaration,
  declaration: VariableDeclarator,
): Replacement | undefined => {
  if (!declaration.init) {
    return undefined;
  }
  if (declaration.init.type !== 'ConditionalExpression') {
    return arrowIIFEReturnTypeReplacement(source, declaration);
  }

  const text = explicitInitializerText(
    source,
    node,
    declaration,
    declaration.init,
    lineIndent(source, nodeStart(node)),
  );
  if (!text) {
    return undefined;
  }
  return { end: nodeEnd(node), start: nodeStart(node), text };
};

const isVariableDeclarator = (node: unknown): node is VariableDeclarator =>
  isObjectRecord(node) && node.type === 'VariableDeclarator';

/**
 * Internal helper exported for the no-ternary codemod composition.
 *
 * @internal
 */
export const variableReplacement = (
  source: string,
  node: VariableDeclaration,
): Replacement | undefined => {
  if (node.declarations.length !== 1) {
    return undefined;
  }

  const [declaration] = node.declarations;
  if (!isVariableDeclarator(declaration) || !declaration.init) {
    return undefined;
  }
  return initializerReplacement(source, node, declaration);
};
