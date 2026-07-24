/* -------------------------------------------------------------------------- */
/*          Abstract values for the Effect runtime task interpreter.          */
/* -------------------------------------------------------------------------- */

import type {
  RuntimeObjectRef,
  RuntimeScope,
  RuntimeState,
  RuntimeValue,
} from './effect-promise-runtime-model';
import { childNode, identifierName } from './effect-ast';
import { safeRuntimeValue, unknownRuntimeValue } from './effect-promise-runtime-model';
import type { ASTNode } from './effect-ast';
import type { HelperScopes } from './effect-promise-callable-types';
import { evaluateRuntimeBinaryScalar } from './effect-promise-runtime-scalar-operations';
import { readRuntimeChoiceMember } from './effect-promise-runtime-choice-operations';
import { runtimeChoice } from './effect-promise-runtime-choice';
import { runtimeThisValue } from './effect-promise-runtime-this';
import { unwrappedExpression } from './effect-boundary-ast-shared';

/**
 * Minimum context needed to resolve runtime task values.
 *
 * @internal
 */
export interface RuntimeValueContext {
  helperScopes: HelperScopes;
  isEffectCall: (node: ASTNode) => boolean;
  isSyncCall: (node: ASTNode) => boolean;
  scopes: readonly RuntimeScope[];
  state: RuntimeState;
  thisValue?: RuntimeValue;
}

const resolvedName = (name: string, scopes: readonly RuntimeScope[]): RuntimeValue => {
  for (let index = scopes.length - 1; index >= 0; index -= 1) {
    const values = scopes[index]?.values;
    if (values?.has(name)) {
      return values.get(name);
    }
  }
  return unknownRuntimeValue;
};

const hasRuntimeName = (name: string, scopes: readonly RuntimeScope[]): boolean =>
  scopes.some((scope): boolean => scope.values.has(name));

/**
 * Resolve an identifier through exact runtime lexical state.
 *
 * @internal
 */
export const resolvedRuntimeName = (
  node: ASTNode | undefined,
  scopes: readonly RuntimeScope[],
): RuntimeValue => {
  const name = identifierName(node);
  if (!name) {
    return unknownRuntimeValue;
  }
  if (name === 'undefined' && !hasRuntimeName(name, scopes)) {
    return undefined;
  }
  const resolved = resolvedName(name, scopes);
  if (resolved === unknownRuntimeValue && !hasRuntimeName(name, scopes)) {
    return node;
  }
  return resolved;
};

/**
 * Assign the nearest runtime lexical binding without crossing a shadow.
 *
 * @internal
 */
export const assignRuntimeName = (
  name: string,
  value: RuntimeValue,
  scopes: readonly RuntimeScope[],
): void => {
  for (let index = scopes.length - 1; index >= 0; index -= 1) {
    const scope = scopes[index];
    if (scope?.values.has(name)) {
      scope.values.set(name, value);
      return;
    }
  }
};

/**
 * Resolve an identifier or literal property key without evaluating dynamic code.
 *
 * @internal
 */
export const runtimeStaticKey = (node: ASTNode | undefined): string | undefined => {
  const name = identifierName(node);
  if (name) {
    return name;
  }
  if (node?.type === 'Literal' || node?.type === 'StringLiteral') {
    const value: unknown = Reflect.get(node, 'value');
    if (typeof value === 'string' || typeof value === 'number') {
      return String(value);
    }
  }
  return undefined;
};

/**
 * Resolve a statically named member expression key.
 *
 * @internal
 */
export const runtimeMemberName = (member: ASTNode): string | undefined => {
  const property = childNode(member, 'property');
  if (Reflect.get(member, 'computed') === true) {
    return runtimeStaticKey(unwrappedExpression(property));
  }
  return identifierName(property);
};

/**
 * Resolve a member key after evaluating a computed scalar expression.
 *
 * @internal
 */
export const runtimeMemberKey = (
  member: ASTNode,
  context: RuntimeValueContext,
): string | undefined => {
  if (Reflect.get(member, 'computed') !== true) {
    return identifierName(childNode(member, 'property'));
  }
  const property = runtimeValue(childNode(member, 'property'), context);
  const scalar = runtimeScalar(property, context);
  if (scalar === unknownRuntimeValue) {
    return undefined;
  }
  return String(scalar);
};

/**
 * Narrow one abstract value to an exact heap object identity.
 *
 * @internal
 */
export const runtimeObjectReference = (value: RuntimeValue): RuntimeObjectRef | undefined => {
  if (value && typeof value !== 'symbol' && 'kind' in value && value.kind === 'object') {
    return value;
  }
  return undefined;
};

const memberValue = (node: ASTNode, context: RuntimeValueContext): RuntimeValue => {
  const object = runtimeValue(childNode(node, 'object'), context);
  const name = runtimeMemberKey(node, context);
  if (name) {
    return readRuntimeChoiceMember(context.state, object, name);
  }
  return unknownRuntimeValue;
};

const isSafeEffectCall = (node: ASTNode, context: RuntimeValueContext): boolean =>
  context.isEffectCall(node) && !context.isSyncCall(node);

/**
 * Resolve an expression to task identity, object members, or an ordinary AST value.
 *
 * @internal
 */
export const runtimeValue = (
  node: ASTNode | undefined,
  context: RuntimeValueContext,
): RuntimeValue => {
  const expression = unwrappedExpression(node);
  if (!expression) {
    return undefined;
  }
  if (expression.type === 'UnaryExpression' && Reflect.get(expression, 'operator') === 'void') {
    return undefined;
  }
  if (context.isSyncCall(expression)) {
    return {
      helperScopes: context.helperScopes,
      kind: 'task',
      scopes: context.scopes,
      syncCall: expression,
    };
  }
  return structuredRuntimeValue(expression, context);
};

const structuredRuntimeValue = (
  expression: ASTNode,
  context: RuntimeValueContext,
): RuntimeValue => {
  switch (expression.type) {
    case 'Identifier': {
      return resolvedRuntimeName(expression, context.scopes);
    }
    case 'ThisExpression': {
      return runtimeThisValue(context.thisValue);
    }
    case 'MemberExpression': {
      return memberValue(expression, context);
    }
    case 'CallExpression': {
      if (isSafeEffectCall(expression, context)) {
        return safeRuntimeValue;
      }
      return expression;
    }
    default: {
      return expression;
    }
  }
};

const directNumericValue = (expression: ASTNode): number | undefined => {
  if (expression.type === 'Literal') {
    const value: unknown = Reflect.get(expression, 'value');
    if (
      value === null ||
      typeof value === 'boolean' ||
      typeof value === 'number' ||
      typeof value === 'string'
    ) {
      return Number(value);
    }
  }
  const name = identifierName(expression);
  if (name === 'NaN') {
    return Number.NaN;
  }
  if (name === 'Infinity') {
    return Number.POSITIVE_INFINITY;
  }
  return undefined;
};

const transformedNumericValue = (
  numeric: number | undefined,
  operator: unknown,
): number | undefined => {
  if (numeric === undefined) {
    return undefined;
  }
  if (operator === '+') {
    return numeric;
  }
  if (operator === '-') {
    return -numeric;
  }
  return undefined;
};

const numericValue = (expression: ASTNode, context: RuntimeValueContext): number | undefined => {
  const direct = directNumericValue(expression);
  if (direct !== undefined || expression.type !== 'UnaryExpression') {
    return direct;
  }
  const operand = runtimeNode(runtimeValue(childNode(expression, 'argument'), context));
  if (!operand) {
    return undefined;
  }
  return transformedNumericValue(
    numericValue(operand, context),
    Reflect.get(expression, 'operator'),
  );
};

const identifierScalar = (expression: ASTNode, context: RuntimeValueContext): RuntimeScalar => {
  const resolved = resolvedRuntimeName(expression, context.scopes);
  if (resolved === expression) {
    const nativeNumeric = directNumericValue(expression);
    if (nativeNumeric !== undefined) {
      return nativeNumeric;
    }
    return unknownRuntimeValue;
  }
  return runtimeScalar(resolved, context);
};

const scalarNodeValue = (expression: ASTNode, context: RuntimeValueContext): RuntimeScalar => {
  if (expression.type === 'Literal') {
    return literalScalar(expression);
  }
  if (expression.type === 'Identifier') {
    return identifierScalar(expression, context);
  }
  const numeric = numericValue(expression, context);
  if (numeric !== undefined) {
    return numeric;
  }
  return binaryScalar(expression, context);
};

const binaryScalar = (expression: ASTNode, context: RuntimeValueContext): RuntimeScalar => {
  if (expression.type !== 'BinaryExpression') {
    return unknownRuntimeValue;
  }
  const left = scalarNodeValue(childNode(expression, 'left') ?? expression, context);
  const right = scalarNodeValue(childNode(expression, 'right') ?? expression, context);
  if (left === unknownRuntimeValue || right === unknownRuntimeValue) {
    return unknownRuntimeValue;
  }
  const operator: unknown = Reflect.get(expression, 'operator');
  if (typeof operator !== 'string') {
    return unknownRuntimeValue;
  }
  return evaluateRuntimeBinaryScalar(operator, left, right);
};

const isStructurallyTruthy = (expression: ASTNode): boolean =>
  expression.type === 'ArrayExpression' ||
  expression.type === 'ArrowFunctionExpression' ||
  expression.type === 'ClassExpression' ||
  expression.type === 'FunctionExpression' ||
  expression.type === 'ObjectExpression';

const unaryTruthiness = (
  expression: ASTNode,
  context: RuntimeValueContext,
): boolean | undefined => {
  if (expression.type !== 'UnaryExpression') {
    return undefined;
  }
  if (Reflect.get(expression, 'operator') === 'void') {
    return false;
  }
  if (Reflect.get(expression, 'operator') === '!') {
    return negatedTruthiness(expression, context);
  }
  return numericTruthiness(expression, context);
};

const negatedTruthiness = (
  expression: ASTNode,
  context: RuntimeValueContext,
): boolean | undefined => {
  const operand = runtimeTruthiness(
    runtimeValue(childNode(expression, 'argument'), context),
    context,
  );
  if (operand === undefined) {
    return undefined;
  }
  return !operand;
};

const numericTruthiness = (
  expression: ASTNode,
  context: RuntimeValueContext,
): boolean | undefined => {
  const numeric = numericValue(expression, context);
  if (numeric === undefined) {
    return undefined;
  }
  return Boolean(numeric);
};

/**
 * Narrow an abstract runtime value to its ordinary AST representation.
 *
 * @internal
 */
export const runtimeNode = (value: RuntimeValue): ASTNode | undefined => {
  if (!value || typeof value === 'symbol' || 'kind' in value) {
    return undefined;
  }
  return value;
};

/**
 * Resolve exact JavaScript truthiness for supported scalar and structural values.
 *
 * @internal
 */
export const runtimeTruthiness = (
  value: RuntimeValue,
  context: RuntimeValueContext,
): boolean | undefined => {
  if (value === undefined) {
    return false;
  }
  if (value === unknownRuntimeValue) {
    return undefined;
  }
  const choice = runtimeChoice(value);
  if (choice) {
    return choiceTruthiness(choice.choices, context);
  }
  return ordinaryTruthiness(value, context);
};

const ordinaryTruthiness = (
  value: RuntimeValue,
  context: RuntimeValueContext,
): boolean | undefined => {
  if (value === safeRuntimeValue) {
    return true;
  }
  if (!value || typeof value === 'symbol') {
    return undefined;
  }
  if ('kind' in value) {
    return true;
  }
  const expression = unwrappedExpression(value);
  if (!expression) {
    return undefined;
  }
  return expressionTruthiness(expression, context);
};

const choiceTruthiness = (
  choices: readonly RuntimeValue[],
  context: RuntimeValueContext,
): boolean | undefined => {
  let known: boolean | undefined = undefined;
  for (const choice of choices) {
    const truthiness = runtimeTruthiness(choice, context);
    if (truthiness === undefined || (known !== undefined && known !== truthiness)) {
      return undefined;
    }
    known = truthiness;
  }
  return known;
};

const expressionTruthiness = (
  expression: ASTNode,
  context: RuntimeValueContext,
): boolean | undefined => {
  if (expression.type === 'Literal') {
    return Boolean(Reflect.get(expression, 'value'));
  }
  if (isStructurallyTruthy(expression)) {
    return true;
  }
  const unary = unaryTruthiness(expression, context);
  if (unary !== undefined) {
    return unary;
  }
  return scalarTruthiness(expression, context);
};

const scalarTruthiness = (
  expression: ASTNode,
  context: RuntimeValueContext,
): boolean | undefined => {
  const scalar = runtimeScalar(expression, context);
  if (scalar === unknownRuntimeValue) {
    return undefined;
  }
  return Boolean(scalar);
};

/**
 * Resolve a literal-like scalar for exact switch selection.
 *
 * @internal
 */
export type RuntimeScalar =
  | boolean
  | number
  | string
  | null
  | typeof unknownRuntimeValue
  | undefined;

const literalScalar = (expression: ASTNode): RuntimeScalar => {
  const literal: unknown = Reflect.get(expression, 'value');
  if (
    literal === null ||
    typeof literal === 'boolean' ||
    typeof literal === 'number' ||
    typeof literal === 'string'
  ) {
    return literal;
  }
  return unknownRuntimeValue;
};

/**
 * Resolve a literal-like value for exact switch selection.
 *
 * @param value - Abstract value produced by discriminant evaluation.
 * @param context - Runtime bindings used to resolve unary numeric values.
 * @returns The exact scalar, or the runtime unknown sentinel.
 * @throws Does not throw.
 * @internal
 */
export const runtimeScalar = (value: RuntimeValue, context: RuntimeValueContext): RuntimeScalar => {
  if (value === undefined) {
    return undefined;
  }
  const expression = runtimeNode(value);
  if (!expression) {
    return unknownRuntimeValue;
  }
  return scalarNodeValue(expression, context);
};
