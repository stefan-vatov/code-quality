import type {
  ASTPath,
  ArrowFunctionExpression,
  ClassMethod,
  ClassPrivateMethod,
  Expression,
  FunctionDeclaration,
  FunctionExpression,
  Identifier,
  Node,
  ObjectMethod,
  ReturnStatement,
} from 'jscodeshift';
import { Array, HashMap, Option, Order, Predicate, pipe } from 'effect';
import jscodeshift from 'jscodeshift';
import {
  codemodObjectValues,
  isCodemodArray,
  isCodemodNode,
  nodeEnd,
  nodeStart,
  sourceForNode,
  type CodemodRecord,
  type CodemodValue,
} from './ast-helpers';

interface Replacement {
  end: number;
  start: number;
  text: string;
}

type FunctionLike =
  | ArrowFunctionExpression
  | ClassMethod
  | ClassPrivateMethod
  | FunctionDeclaration
  | FunctionExpression
  | ObjectMethod;
type RootCollection = ReturnType<typeof codemodAPI>;

interface CallExpressionLike extends Expression {
  readonly callee: Expression;
}

interface MemberExpressionLike extends Expression {
  readonly object: Expression;
  readonly property: Expression;
}

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

const isReturnStatement = (value: CodemodValue): value is ReturnStatement =>
  isCodemodNode(value) && value.type === 'ReturnStatement';

const isFunctionLikeNode = (node: CodemodValue): node is FunctionLike =>
  isCodemodNode(node) &&
  (node.type === 'ArrowFunctionExpression' ||
    node.type === 'ClassMethod' ||
    node.type === 'ClassPrivateMethod' ||
    node.type === 'FunctionDeclaration' ||
    node.type === 'FunctionExpression' ||
    node.type === 'ObjectMethod');

const nestedSearch = (search: ReturnSearch): ReturnSearch => ({
  isRoot: false,
  seen: search.seen,
});

const canScanReturnRecord = (value: CodemodRecord, search: ReturnSearch): boolean => {
  if (search.seen.has(value)) {
    return false;
  }
  search.seen.add(value);
  return search.isRoot || !isFunctionLikeNode(value);
};

const hasDirectReturnValueInRecord = (value: CodemodRecord, search: ReturnSearch): boolean => {
  if (!canScanReturnRecord(value, search)) {
    return false;
  }
  if (isReturnStatement(value) && value.argument) {
    return true;
  }
  return pipe(
    codemodObjectValues(value),
    Array.some((entry): boolean => hasDirectReturnValue(entry, nestedSearch(search))),
  );
};

const hasDirectReturnValue = (value: CodemodValue, search: ReturnSearch): boolean => {
  if (isCodemodArray(value)) {
    return pipe(
      value,
      Array.some((entry): boolean => hasDirectReturnValue(entry, nestedSearch(search))),
    );
  }
  if (!isCodemodNode(value)) {
    return false;
  }
  return hasDirectReturnValueInRecord(value, search);
};

const hasReturnValue = (node: FunctionLike): boolean =>
  hasDirectReturnValue(node, { isRoot: true, seen: new WeakSet() });

const isAsync = (node: FunctionLike): boolean => node.async === true;

const isIdentifier = (node: CodemodValue): node is Identifier =>
  isCodemodNode(node) && node.type === 'Identifier';

const objectPropertyName = (node: CodemodValue): string | undefined =>
  pipe(
    Option.some(node),
    Option.filter(isCodemodNode),
    Option.filter((value): boolean => value.type === 'ObjectProperty'),
    Option.flatMapNullable((value) => value.key),
    Option.flatMap((key) => {
      if (isIdentifier(key)) {
        return Option.some(key.name);
      }
      if (isCodemodNode(key) && key.type === 'StringLiteral' && Predicate.isString(key.value)) {
        return Option.some(key.value);
      }
      return Option.none<string>();
    }),
    Option.getOrUndefined,
  );

const objectPropertyValue = (node: CodemodValue): FunctionLike | undefined =>
  pipe(
    Option.some(node),
    Option.filter(isCodemodNode),
    Option.flatMapNullable((value) => value.value),
    Option.filter(isFunctionLikeNode),
    Option.getOrUndefined,
  );

const functionKey = (node: FunctionLike): string => `${nodeStart(node)}:${nodeEnd(node)}`;

const collectObjectPropertyNames = (source: string): HashMap.HashMap<string, string> => {
  let names = HashMap.empty<string, string>();
  codemodAPI(source)
    .find(codemodAPI.ObjectProperty)
    .forEach((path): void => {
      const value = objectPropertyValue(path.value);
      const name = objectPropertyName(path.value);
      if (value && name) {
        names = HashMap.set(names, functionKey(value), name);
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

const isPredicateCall = (expression: CodemodValue): boolean =>
  pipe(
    Option.some(expression),
    Option.filter(isCodemodNode),
    Option.flatMapNullable((value) => value.callee),
    Option.filter(isCodemodNode),
    Option.exists((callee): boolean => {
      if (callee.type === 'MemberExpression' && isIdentifier(callee.property)) {
        return callee.property.name === 'test';
      }
      if (isIdentifier(callee)) {
        return startsWithPredicatePrefix(callee.name);
      }
      return false;
    }),
  );

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
  if (isOperatorExpression(expression)) {
    return expression.operator;
  }
  return undefined;
};

const isOperatorExpression = (
  expression: Expression,
): expression is Expression & { readonly operator: string } =>
  expression.type === 'BinaryExpression' ||
  expression.type === 'LogicalExpression' ||
  expression.type === 'UnaryExpression';

const expressionSide = (expression: Expression, key: 'left' | 'right'): Expression | undefined => {
  if (!isBinaryLikeExpression(expression)) {
    return undefined;
  }
  return key === 'left' ? expression.left : expression.right;
};

const isBinaryLikeExpression = (
  expression: Expression,
): expression is Expression & {
  readonly left: Expression;
  readonly right: Expression;
} => expression.type === 'BinaryExpression' || expression.type === 'LogicalExpression';

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

const primitiveLiteralReturnType = (expression: Expression): string | undefined =>
  pipe(
    Option.some(expression.type),
    Option.flatMap((type) => {
      if (type === 'StringLiteral') {
        return Option.some(': string');
      }
      if (type === 'NumericLiteral') {
        return Option.some(': number');
      }
      if (type === 'BooleanLiteral') {
        return Option.some(': boolean');
      }
      return Option.none<string>();
    }),
    Option.getOrUndefined,
  );

const parameterTypeText = (source: string, parameter: Node): string | undefined =>
  isIdentifier(parameter) && parameter.typeAnnotation
    ? sourceForNode(source, parameter.typeAnnotation).trim()
    : undefined;

const stringParameterNames = (source: string, node: FunctionLike): ReadonlySet<string> =>
  new Set(
    pipe(
      node.params,
      Array.filterMap((parameter) => {
        if (isIdentifier(parameter) && parameterTypeText(source, parameter) === ': string') {
          return Option.some(parameter.name);
        }
        return Option.none<string>();
      }),
    ),
  );

const isCallExpressionLike = (expression: Expression): expression is CallExpressionLike =>
  expression.type === 'CallExpression';

const isMemberExpressionLike = (expression: Expression): expression is MemberExpressionLike =>
  expression.type === 'MemberExpression';

const stringMethodName = (expression: Expression): string | undefined => {
  if (!isCallExpressionLike(expression) || !isMemberExpressionLike(expression.callee)) {
    return undefined;
  }
  return isIdentifier(expression.callee.property) ? expression.callee.property.name : undefined;
};

const stringMethodReceiver = (expression: Expression): Expression | undefined =>
  isCallExpressionLike(expression) && isMemberExpressionLike(expression.callee)
    ? expression.callee.object
    : undefined;

const isStringReturningMethod = (name: string | undefined): boolean =>
  name === 'slice' || name === 'toLowerCase' || name === 'toUpperCase' || name === 'trim';

const stringMethodReturnType = (
  source: string,
  node: FunctionLike,
  expression: Expression,
): string | undefined =>
  pipe(
    Option.some(expression),
    Option.filter((value): boolean => isStringReturningMethod(stringMethodName(value))),
    Option.flatMap((value) =>
      pipe(
        Option.some(stringMethodReceiver(value)),
        Option.filter(isIdentifier),
        Option.filter((object): boolean => stringParameterNames(source, node).has(object.name)),
        Option.map((): string => ': string'),
      ),
    ),
    Option.getOrUndefined,
  );

const singleReturnExpression = (node: FunctionLike): Expression | undefined => {
  if (node.type === 'ArrowFunctionExpression' && node.body.type !== 'BlockStatement') {
    return node.body;
  }
  if (node.body.type !== 'BlockStatement' || node.body.body.length !== 1) {
    return undefined;
  }
  const [statement] = node.body.body;
  return statement?.type === 'ReturnStatement' ? (statement.argument ?? undefined) : undefined;
};

const inferredExpressionReturnTypeText = (
  source: string,
  path: ASTPath<FunctionLike>,
  propertyNames: HashMap.HashMap<string, string>,
): string | undefined => {
  const expression = singleReturnExpression(path.value);
  if (!expression) {
    return undefined;
  }
  if (
    pipe(HashMap.get(propertyNames, functionKey(path.value)), Option.contains('check')) ||
    isBooleanExpression(expression)
  ) {
    return ': boolean';
  }
  const primitiveType = primitiveLiteralReturnType(expression);
  if (primitiveType) {
    return primitiveType;
  }
  return stringMethodReturnType(source, path.value, expression);
};

const inferredBodyReturnTypeText = (node: FunctionLike): string | undefined =>
  pipe(
    Option.some(node),
    Option.filter((value): boolean => !hasReturnValue(value)),
    Option.map((value): string => {
      if (isAsync(value)) {
        return ': Promise<void>';
      }
      return ': void';
    }),
    Option.getOrUndefined,
  );

const inferredReturnTypeText = (
  source: string,
  path: ASTPath<FunctionLike>,
  propertyNames: HashMap.HashMap<string, string>,
): string | undefined => {
  if (pipe(HashMap.get(propertyNames, functionKey(path.value)), Option.contains('ast'))) {
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

const insertionPoint = (source: string, node: FunctionLike): number | undefined =>
  pipe(
    Option.some(node),
    Option.filter((value): boolean => !value.returnType && Boolean(value.body)),
    Option.map((value): number => {
      if (value.type === 'ArrowFunctionExpression') {
        return arrowInsertionPoint(source, value);
      }
      return previousNonWhitespaceIndex(source, nodeStart(value.body));
    }),
    Option.getOrUndefined,
  );

const replacementForFunction = (
  source: string,
  path: ASTPath<FunctionLike>,
  propertyNames: HashMap.HashMap<string, string>,
): Replacement | undefined =>
  pipe(
    Option.all({
      returnType: Option.fromNullable(inferredReturnTypeText(source, path, propertyNames)),
      start: Option.fromNullable(insertionPoint(source, path.value)),
    }),
    Option.map(({ returnType, start }): Replacement => ({ end: start, start, text: returnType })),
    Option.getOrUndefined,
  );

const appendReplacementForFunction = (
  source: string,
  propertyNames: HashMap.HashMap<string, string>,
  replacements: Replacement[],
  path: ASTPath<FunctionLike>,
): void => {
  if (
    (path.value.type === 'ClassMethod' || path.value.type === 'ClassPrivateMethod') &&
    path.value.kind === 'constructor'
  ) {
    return;
  }
  pipe(
    Option.fromNullable(replacementForFunction(source, path, propertyNames)),
    Option.map((replacement): number => replacements.push(replacement)),
  );
};

const collectClassMethodReplacements = (
  root: RootCollection,
  collect: (path: ASTPath<FunctionLike>) => void,
): void => {
  root.find(codemodAPI.ClassMethod).forEach(collect);
  root.find(codemodAPI.ClassPrivateMethod).forEach(collect);
};

const collectFunctionReplacements = (source: string): Replacement[] => {
  const replacements: Replacement[] = [];
  const propertyNames = collectObjectPropertyNames(source);
  const collect = (path: ASTPath<FunctionLike>): void =>
    appendReplacementForFunction(source, propertyNames, replacements, path);

  const root = codemodAPI(source);
  root.find(codemodAPI.ArrowFunctionExpression).forEach(collect);
  collectClassMethodReplacements(root, collect);
  root.find(codemodAPI.ObjectMethod).forEach(collect);
  root.find(codemodAPI.FunctionDeclaration).forEach(collect);
  root.find(codemodAPI.FunctionExpression).forEach(collect);

  return replacements;
};

export const addVoidReturnTypes = (source: string): string =>
  applyReplacements(source, collectFunctionReplacements(source));
