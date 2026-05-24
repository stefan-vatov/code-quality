/* -------------------------------------------------------------------------- */
/*            Conservative codemod for explicit void return types.            */
/* -------------------------------------------------------------------------- */
import type {
  ASTPath,
  ArrowFunctionExpression,
  Expression,
  FunctionDeclaration,
  FunctionExpression,
  Identifier,
  Node,
  ObjectMethod,
} from 'jscodeshift';
import jscodeshift from 'jscodeshift';

interface Replacement {
  end: number;
  start: number;
  text: string;
}

type FunctionLike =
  | ArrowFunctionExpression
  | FunctionDeclaration
  | FunctionExpression
  | ObjectMethod;

interface ReturnSearch {
  isRoot: boolean;
  seen: WeakSet<object>;
}

const codemodAPI = jscodeshift.withParser('ts');
const CHAR_CODE_UPPER_A = 65;
const CHAR_CODE_UPPER_Z = 90;
const CAN_PREFIX_LENGTH = 3;
const HAS_PREFIX_LENGTH = 3;
const IS_PREFIX_LENGTH = 2;
const SHOULD_PREFIX_LENGTH = 6;

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

const isExpressionLike = (value: unknown): value is Expression =>
  isObjectRecord(value) && typeof value.type === 'string';

const isFunctionLikeNode = (node: unknown): node is FunctionLike =>
  isObjectRecord(node) &&
  (node.type === 'ArrowFunctionExpression' ||
    node.type === 'FunctionDeclaration' ||
    node.type === 'FunctionExpression' ||
    node.type === 'ObjectMethod');

const nestedSearch = (search: ReturnSearch): ReturnSearch => ({
  isRoot: false,
  seen: search.seen,
});

const canScanReturnRecord = (value: Record<string, unknown>, search: ReturnSearch): boolean => {
  if (search.seen.has(value)) {
    return false;
  }
  search.seen.add(value);
  return search.isRoot || !isFunctionLikeNode(value);
};

const hasDirectReturnValueInRecord = (
  value: Record<string, unknown>,
  search: ReturnSearch,
): boolean => {
  if (!canScanReturnRecord(value, search)) {
    return false;
  }
  if (value.type === 'ReturnStatement' && value.argument) {
    return true;
  }
  return Object.values(value).some((entry): boolean =>
    hasDirectReturnValue(entry, nestedSearch(search)),
  );
};

const hasDirectReturnValue = (value: unknown, search: ReturnSearch): boolean => {
  if (Array.isArray(value)) {
    return value.some((entry): boolean => hasDirectReturnValue(entry, nestedSearch(search)));
  }
  if (!isObjectRecord(value)) {
    return false;
  }
  return hasDirectReturnValueInRecord(value, search);
};

const hasReturnValue = (node: FunctionLike): boolean =>
  hasDirectReturnValue(node, { isRoot: true, seen: new WeakSet() });

const isAsync = (node: FunctionLike): boolean => node.async === true;

const isIdentifier = (node: unknown): node is Identifier =>
  isObjectRecord(node) && node.type === 'Identifier' && typeof node.name === 'string';

const objectPropertyName = (node: unknown): string | undefined => {
  if (!isObjectRecord(node) || node.type !== 'ObjectProperty') {
    return undefined;
  }
  const { key } = node;
  if (isIdentifier(key)) {
    return key.name;
  }
  if (isObjectRecord(key) && key.type === 'StringLiteral' && typeof key.value === 'string') {
    return key.value;
  }
  return undefined;
};

const objectPropertyValue = (node: unknown): FunctionLike | undefined => {
  if (!isObjectRecord(node)) {
    return undefined;
  }
  const { value } = node;
  if (isFunctionLikeNode(value)) {
    return value;
  }
  return undefined;
};

const functionKey = (node: FunctionLike): string => `${nodeStart(node)}:${nodeEnd(node)}`;

const collectObjectPropertyNames = (source: string): ReadonlyMap<string, string> => {
  const names = new Map<string, string>();
  codemodAPI(source)
    .find(codemodAPI.ObjectProperty)
    .forEach((path): void => {
      const value = objectPropertyValue(path.value);
      const name = objectPropertyName(path.value);
      if (value && name) {
        names.set(functionKey(value), name);
      }
    });
  return names;
};

const hasUppercaseAt = (text: string, index: number): boolean => {
  const code = text.charCodeAt(index);
  return code >= CHAR_CODE_UPPER_A && code <= CHAR_CODE_UPPER_Z;
};

const startsWithPredicatePrefix = (text: string): boolean =>
  (text.startsWith('has') && hasUppercaseAt(text, HAS_PREFIX_LENGTH)) ||
  (text.startsWith('is') && hasUppercaseAt(text, IS_PREFIX_LENGTH)) ||
  (text.startsWith('should') && hasUppercaseAt(text, SHOULD_PREFIX_LENGTH)) ||
  (text.startsWith('can') && hasUppercaseAt(text, CAN_PREFIX_LENGTH));

const isPredicateCall = (expression: unknown): boolean => {
  if (!isObjectRecord(expression)) {
    return false;
  }
  const { callee } = expression;
  if (!isObjectRecord(callee)) {
    return false;
  }
  if (callee.type === 'MemberExpression' && isIdentifier(callee.property)) {
    return callee.property.name === 'test';
  }
  if (callee.type === 'Identifier' && typeof callee.name === 'string') {
    return startsWithPredicatePrefix(callee.name);
  }
  return false;
};

const isComparisonOperator = (operator: string): boolean =>
  operator === '===' ||
  operator === '!==' ||
  operator === '>' ||
  operator === '>=' ||
  operator === '<' ||
  operator === '<=';

const isBooleanLogicalOperator = (operator: string): boolean =>
  operator === '&&' || operator === '||';

const expressionOperator = (expression: Expression): string | undefined => {
  if (!isObjectRecord(expression)) {
    return undefined;
  }
  const { operator } = expression;
  if (typeof operator === 'string') {
    return operator;
  }
  return undefined;
};

const expressionSide = (expression: Expression, key: 'left' | 'right'): Expression | undefined => {
  if (!isObjectRecord(expression)) {
    return undefined;
  }
  const value = expression[key];
  if (isExpressionLike(value)) {
    return value;
  }
  return undefined;
};

const isBooleanLogicalExpression = (expression: Expression): boolean => {
  const left = expressionSide(expression, 'left');
  const right = expressionSide(expression, 'right');
  const operator = expressionOperator(expression);
  return Boolean(
    operator &&
    isBooleanLogicalOperator(operator) &&
    left &&
    right &&
    isBooleanExpression(left) &&
    isBooleanExpression(right),
  );
};

const isBooleanExpression = (expression: Expression): boolean => {
  if (expression.type === 'BooleanLiteral') {
    return true;
  }
  if (expression.type === 'UnaryExpression' && expressionOperator(expression) === '!') {
    return true;
  }
  if (expression.type === 'BinaryExpression') {
    return isComparisonOperator(expressionOperator(expression) ?? '');
  }
  if (expression.type === 'LogicalExpression') {
    return isBooleanLogicalExpression(expression);
  }
  return expression.type === 'CallExpression' && isPredicateCall(expression);
};

const primitiveLiteralReturnType = (expression: Expression): string | undefined => {
  if (expression.type === 'StringLiteral') {
    return ': string';
  }
  if (expression.type === 'NumericLiteral') {
    return ': number';
  }
  if (expression.type === 'BooleanLiteral') {
    return ': boolean';
  }
  return undefined;
};

const parameterTypeText = (source: string, parameter: Node): string | undefined => {
  if (parameter.type !== 'Identifier' || !isObjectRecord(parameter)) {
    return undefined;
  }
  const { typeAnnotation } = parameter;
  if (!typeAnnotation) {
    return undefined;
  }
  return sourceForNode(source, typeAnnotation).trim();
};

const stringParameterNames = (source: string, node: FunctionLike): Set<string> =>
  new Set(
    node.params.flatMap((parameter): string[] => {
      if (isIdentifier(parameter) && parameterTypeText(source, parameter) === ': string') {
        return [parameter.name];
      }
      return [];
    }),
  );

const stringMethodName = (expression: Expression): string | undefined => {
  if (expression.type !== 'CallExpression' || !isObjectRecord(expression)) {
    return undefined;
  }
  const { callee } = expression;
  if (!isObjectRecord(callee) || callee.type !== 'MemberExpression') {
    return undefined;
  }
  const { property } = callee;
  if (!isIdentifier(property)) {
    return undefined;
  }
  return property.name;
};

const stringMethodReceiver = (expression: Expression): unknown => {
  if (expression.type !== 'CallExpression' || !isObjectRecord(expression)) {
    return undefined;
  }
  const { callee } = expression;
  if (!isObjectRecord(callee) || callee.type !== 'MemberExpression') {
    return undefined;
  }
  return callee.object;
};

const isStringReturningMethod = (name: string | undefined): boolean =>
  name === 'slice' || name === 'toLowerCase' || name === 'toUpperCase' || name === 'trim';

const stringMethodReturnType = (
  source: string,
  node: FunctionLike,
  expression: Expression,
): string | undefined => {
  if (!isStringReturningMethod(stringMethodName(expression))) {
    return undefined;
  }
  const object = stringMethodReceiver(expression);
  if (isIdentifier(object) && stringParameterNames(source, node).has(object.name)) {
    return ': string';
  }
  return undefined;
};

const singleReturnExpression = (node: FunctionLike): Expression | undefined => {
  if (node.type === 'ArrowFunctionExpression' && node.body.type !== 'BlockStatement') {
    return node.body;
  }
  if (node.body.type !== 'BlockStatement' || node.body.body.length !== 1) {
    return undefined;
  }
  const [statement] = node.body.body;
  if (statement?.type !== 'ReturnStatement') {
    return undefined;
  }
  return statement.argument ?? undefined;
};

const inferredExpressionReturnTypeText = (
  source: string,
  path: ASTPath<FunctionLike>,
  propertyNames: ReadonlyMap<string, string>,
): string | undefined => {
  const expression = singleReturnExpression(path.value);
  if (!expression) {
    return undefined;
  }
  if (propertyNames.get(functionKey(path.value)) === 'check' || isBooleanExpression(expression)) {
    return ': boolean';
  }
  const primitiveType = primitiveLiteralReturnType(expression);
  if (primitiveType) {
    return primitiveType;
  }
  return stringMethodReturnType(source, path.value, expression);
};

const inferredBodyReturnTypeText = (node: FunctionLike): string | undefined => {
  if (hasReturnValue(node)) {
    return undefined;
  }
  if (isAsync(node)) {
    return ': Promise<void>';
  }
  return ': void';
};

const inferredReturnTypeText = (
  source: string,
  path: ASTPath<FunctionLike>,
  propertyNames: ReadonlyMap<string, string>,
): string | undefined => {
  if (propertyNames.get(functionKey(path.value)) === 'ast') {
    return ': Record<string, (node: object) => void>';
  }

  const expressionReturnType = inferredExpressionReturnTypeText(source, path, propertyNames);
  if (expressionReturnType) {
    return expressionReturnType;
  }
  if (singleReturnExpression(path.value)) {
    return undefined;
  }
  return inferredBodyReturnTypeText(path.value);
};

const previousNonWhitespaceIndex = (source: string, index: number): number => {
  let cursor = index;
  while (cursor > 0 && /\s/u.test(source[cursor - 1] ?? '')) {
    cursor -= 1;
  }
  return cursor;
};

const arrowInsertionPoint = (source: string, node: ArrowFunctionExpression): number => {
  const bodyStart = nodeStart(node.body);
  const arrowStart = source.lastIndexOf('=>', bodyStart);
  if (arrowStart === -1) {
    return previousNonWhitespaceIndex(source, bodyStart);
  }
  return previousNonWhitespaceIndex(source, arrowStart);
};

const insertionPoint = (source: string, node: FunctionLike): number | undefined => {
  if (node.returnType || !node.body) {
    return undefined;
  }
  if (node.type === 'ArrowFunctionExpression') {
    return arrowInsertionPoint(source, node);
  }
  return previousNonWhitespaceIndex(source, nodeStart(node.body));
};

const replacementForFunction = (
  source: string,
  path: ASTPath<FunctionLike>,
  propertyNames: ReadonlyMap<string, string>,
): Replacement | undefined => {
  const start = insertionPoint(source, path.value);
  const returnType = inferredReturnTypeText(source, path, propertyNames);
  if (start === undefined || !returnType) {
    return undefined;
  }
  return { end: start, start, text: returnType };
};

const collectFunctionReplacements = (source: string): Replacement[] => {
  const replacements: Replacement[] = [];
  const propertyNames = collectObjectPropertyNames(source);

  const collect = (path: ASTPath<FunctionLike>): void => {
    const replacement = replacementForFunction(source, path, propertyNames);
    if (replacement) {
      replacements.push(replacement);
    }
  };

  const root = codemodAPI(source);
  root.find(codemodAPI.ArrowFunctionExpression).forEach(collect);
  root.find(codemodAPI.ObjectMethod).forEach(collect);
  root.find(codemodAPI.FunctionDeclaration).forEach(collect);
  root.find(codemodAPI.FunctionExpression).forEach(collect);

  return replacements;
};

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const addVoidReturnTypes = (source: string): string =>
  applyReplacements(source, collectFunctionReplacements(source));
