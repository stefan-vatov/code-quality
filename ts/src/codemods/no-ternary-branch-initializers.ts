/* -------------------------------------------------------------------------- */
/*        Branch-initializer repairs for the no-ternary codemod only.         */
/* -------------------------------------------------------------------------- */
import type {
  AssignmentExpression,
  Expression,
  Identifier,
  IfStatement,
  Statement,
  VariableDeclaration,
  VariableDeclarator,
} from 'jscodeshift';

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

interface BranchReplacementInput {
  declaration: VariableDeclarator;
  declarationStatement: VariableDeclaration;
  ifStatement: IfStatement;
  index: number;
  source: string;
  statements: readonly Statement[];
}

const INDENT_STEP = '  ';

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

const isIdentifier = (node: unknown): node is Identifier =>
  isObjectRecord(node) && node.type === 'Identifier' && typeof node.name === 'string';

const isStatement = (node: unknown): node is Statement =>
  isObjectRecord(node) && typeof node.type === 'string';

const isVariableDeclaration = (node: unknown): node is VariableDeclaration =>
  isObjectRecord(node) && node.type === 'VariableDeclaration' && Array.isArray(node.declarations);

const isVariableDeclarator = (node: unknown): node is VariableDeclarator =>
  isObjectRecord(node) && node.type === 'VariableDeclarator';

const isIfStatement = (node: unknown): node is IfStatement =>
  isObjectRecord(node) && node.type === 'IfStatement';

const isAssignmentExpression = (node: unknown): node is AssignmentExpression =>
  isObjectRecord(node) && node.type === 'AssignmentExpression';

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

const statementFromBlock = (statement: Statement): Statement | undefined => {
  if (!isObjectRecord(statement) || statement.type !== 'BlockStatement') {
    return undefined;
  }
  const { body } = statement;
  if (!Array.isArray(body) || body.length !== 1 || !isStatement(body[0])) {
    return undefined;
  }
  return body[0];
};

const normalizedStatement = (statement: Statement): Statement | undefined =>
  statementFromBlock(statement) ?? statement;

const assignmentExpression = (
  statement: Statement | undefined,
): AssignmentExpression | undefined => {
  if (!isObjectRecord(statement) || statement.type !== 'ExpressionStatement') {
    return undefined;
  }
  const { expression } = statement;
  if (!isAssignmentExpression(expression)) {
    return undefined;
  }
  if (expression.operator !== '=') {
    return undefined;
  }
  return expression;
};

const assignedExpression = (statement: Statement, name: string): Expression | undefined => {
  const expression = assignmentExpression(normalizedStatement(statement));
  if (!expression || !isIdentifier(expression.left) || expression.left.name !== name) {
    return undefined;
  }
  return expression.right;
};

interface WriteSearch {
  name: string;
  seen: WeakSet<object>;
}

const writesIdentifierInRecord = (node: Record<string, unknown>, search: WriteSearch): boolean => {
  if (search.seen.has(node)) {
    return false;
  }
  search.seen.add(node);
  if (node.type === 'AssignmentExpression' && isIdentifier(node.left)) {
    return node.operator === '=' && node.left.name === search.name;
  }
  if (node.type === 'UpdateExpression' && isIdentifier(node.argument)) {
    return node.argument.name === search.name;
  }
  return Object.values(node).some((value) => writesIdentifierInValue(value, search));
};

const writesIdentifierInValue = (node: unknown, search: WriteSearch): boolean => {
  if (Array.isArray(node)) {
    return node.some((entry) => writesIdentifierInValue(entry, search));
  }
  if (!isObjectRecord(node)) {
    return false;
  }
  return writesIdentifierInRecord(node, search);
};

const writesIdentifier = (node: unknown, name: string): boolean =>
  writesIdentifierInValue(node, { name, seen: new WeakSet() });

const hasLaterWrite = (
  statements: readonly Statement[],
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

const branchAssignmentExpressions = (
  ifStatement: IfStatement,
  declaration: VariableDeclarator,
): { name: string; whenFalse: Expression; whenTrue: Expression } | undefined => {
  if (!isIdentifier(declaration.id) || !ifStatement.alternate) {
    return undefined;
  }
  const { name } = declaration.id;
  const whenTrue = assignedExpression(ifStatement.consequent, name);
  const whenFalse = assignedExpression(ifStatement.alternate, name);
  if (!whenTrue || !whenFalse) {
    return undefined;
  }
  return { name, whenFalse, whenTrue };
};

const declarationKeyword = (
  statements: readonly Statement[],
  index: number,
  name: string,
): 'const' | 'let' => {
  if (hasLaterWrite(statements, index + 2, name)) {
    return 'let';
  }
  return 'const';
};

const singleEmptyDeclarator = (node: VariableDeclaration): VariableDeclarator | undefined => {
  const [declaration] = node.declarations;
  if (node.declarations.length !== 1 || !isVariableDeclarator(declaration) || declaration.init) {
    return undefined;
  }
  return declaration;
};

const branchInitializerReplacement = (
  source: string,
  statements: readonly Statement[],
  index: number,
): Replacement | undefined => {
  const declarationStatement = statements[index];
  const ifStatement = statements[index + 1];
  if (!isVariableDeclaration(declarationStatement) || !isIfStatement(ifStatement)) {
    return undefined;
  }
  const declaration = singleEmptyDeclarator(declarationStatement);
  if (!declaration) {
    return undefined;
  }
  return replacementFromBranches({
    declaration,
    declarationStatement,
    ifStatement,
    index,
    source,
    statements,
  });
};

const replacementFromBranches = (input: BranchReplacementInput): Replacement | undefined => {
  const { declaration, declarationStatement, ifStatement, source } = input;
  const branches = branchAssignmentExpressions(ifStatement, declaration);
  if (!branches) {
    return undefined;
  }
  const returnType = initializerReturnType(
    source,
    declaration,
    branches.whenTrue,
    branches.whenFalse,
  );
  if (!returnType) {
    return undefined;
  }
  return {
    end: nodeEnd(ifStatement),
    start: nodeStart(declarationStatement),
    text: branchInitializerText({
      condition: sourceForNode(source, ifStatement.test),
      falseText: sourceForNode(source, branches.whenFalse),
      indent: lineIndent(source, nodeStart(declarationStatement)),
      keyword: declarationKeyword(input.statements, input.index, branches.name),
      name: branches.name,
      returnType,
      trueText: sourceForNode(source, branches.whenTrue),
      typeText: optionalTypeText(source, declaration, returnType),
    }),
  };
};

/**
 * Internal helper exported for the no-ternary codemod composition.
 *
 * @internal
 */
export const collectBranchInitializerRepairs = (
  source: string,
  statements: readonly Statement[],
  replacements: Replacement[],
): void => {
  for (let idx = 0; idx < statements.length - 1; idx += 1) {
    const replacement = branchInitializerReplacement(source, statements, idx);
    if (replacement) {
      replacements.push(replacement);
      idx += 1;
    }
  }
};
