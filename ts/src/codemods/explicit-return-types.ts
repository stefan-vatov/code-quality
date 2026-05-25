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
import { Array, HashMap, Option, Order, Predicate, pipe } from 'effect';
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
  return pipe(
    Object.values(value),
    Array.some((entry): boolean => hasDirectReturnValue(entry, nestedSearch(search))),
  );
};

const hasDirectReturnValue = (value: unknown, search: ReturnSearch): boolean => {
  if (globalThis.Array.isArray(value)) {
    return pipe(
      value,
      Array.some((entry): boolean => hasDirectReturnValue(entry, nestedSearch(search))),
    );
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

const objectPropertyName = (node: unknown): string | undefined =>
  pipe(
    Option.some(node),
    Option.filter(isObjectRecord),
    Option.filter((value): boolean => value.type === 'ObjectProperty'),
    Option.flatMapNullable((value) => value.key),
    Option.flatMap((key) => {
      if (isIdentifier(key)) {
        return Option.some(key.name);
      }
      if (isObjectRecord(key) && key.type === 'StringLiteral' && typeof key.value === 'string') {
        return Option.some(key.value);
      }
      return Option.none<string>();
    }),
    Option.getOrUndefined,
  );

const objectPropertyValue = (node: unknown): FunctionLike | undefined =>
  pipe(
    Option.some(node),
    Option.filter(isObjectRecord),
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

const isPredicateCall = (expression: unknown): boolean =>
  pipe(
    Option.some(expression),
    Option.filter(isObjectRecord),
    Option.flatMapNullable((value) => value.callee),
    Option.filter(isObjectRecord),
    Option.exists((callee): boolean => {
      if (callee.type === 'MemberExpression' && isIdentifier(callee.property)) {
        return callee.property.name === 'test';
      }
      if (callee.type === 'Identifier' && typeof callee.name === 'string') {
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

const expressionOperator = (expression: Expression): string | undefined =>
  pipe(
    Option.some(expression as unknown),
    Option.filter(isObjectRecord),
    Option.flatMapNullable((value) => value.operator),
    Option.filter(Predicate.isString),
    Option.getOrUndefined,
  );

const expressionSide = (expression: Expression, key: 'left' | 'right'): Expression | undefined =>
  pipe(
    Option.some(expression as unknown),
    Option.filter(isObjectRecord),
    Option.flatMapNullable((value) => value[key]),
    Option.filter(isExpressionLike),
    Option.getOrUndefined,
  );

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
  pipe(
    Option.some(parameter as unknown),
    Option.filter(isObjectRecord),
    Option.filter((value): boolean => value.type === 'Identifier'),
    Option.flatMapNullable((value) => value.typeAnnotation),
    Option.map((typeAnnotation): string => sourceForNode(source, typeAnnotation).trim()),
    Option.getOrUndefined,
  );

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

const stringMethodName = (expression: Expression): string | undefined =>
  pipe(
    Option.some(expression as unknown),
    Option.filter(isObjectRecord),
    Option.filter((value): boolean => value.type === 'CallExpression'),
    Option.flatMapNullable((value) => value.callee),
    Option.filter(isObjectRecord),
    Option.filter((callee): boolean => callee.type === 'MemberExpression'),
    Option.flatMapNullable((callee) => callee.property),
    Option.filter(isIdentifier),
    Option.map((property): string => property.name),
    Option.getOrUndefined,
  );

const stringMethodReceiver = (expression: Expression): unknown =>
  pipe(
    Option.some(expression as unknown),
    Option.filter(isObjectRecord),
    Option.filter((value): boolean => value.type === 'CallExpression'),
    Option.flatMapNullable((value) => value.callee),
    Option.filter(isObjectRecord),
    Option.filter((callee): boolean => callee.type === 'MemberExpression'),
    Option.flatMapNullable((callee) => callee.object),
    Option.getOrUndefined,
  );

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
  return pipe(
    Option.some(node.body as unknown),
    Option.filter(isObjectRecord),
    Option.filter((body): boolean => body.type === 'BlockStatement'),
    Option.flatMapNullable((body) => body.body),
    Option.filter(globalThis.Array.isArray),
    Option.filter((body): boolean => body.length === 1),
    Option.flatMap(Array.head),
    Option.filter(
      (statement): boolean => isObjectRecord(statement) && statement.type === 'ReturnStatement',
    ),
    Option.flatMapNullable((statement) => {
      if (isObjectRecord(statement)) {
        return statement.argument;
      }
      return undefined;
    }),
    Option.filter(isExpressionLike),
    Option.getOrUndefined,
  );
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

const collectFunctionReplacements = (source: string): Replacement[] => {
  const replacements: Replacement[] = [];
  const propertyNames = collectObjectPropertyNames(source);

  const collect = (path: ASTPath<FunctionLike>): void => {
    pipe(
      Option.fromNullable(replacementForFunction(source, path, propertyNames)),
      Option.map((replacement): number => replacements.push(replacement)),
    );
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
