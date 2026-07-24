/* -------------------------------------------------------------------------- */
/*      Exact scalar operations used only by runtime control statements.      */
/* -------------------------------------------------------------------------- */

import type { RuntimeExactScalar, RuntimeScalarResult } from './effect-promise-runtime-scalars';
import type {
  RuntimeExecutionContext,
  RuntimeStatementHost,
  RuntimeValue,
} from './effect-promise-runtime-model';
import {
  assignRuntimeName,
  resolvedRuntimeName,
  runtimeNode,
  runtimeObjectReference,
} from './effect-promise-runtime-values';
import { childNode, identifierName } from './effect-ast';
import { safeRuntimeValue, unknownRuntimeValue } from './effect-promise-runtime-model';
import type { ASTNode } from './effect-ast';
import { evaluateRuntimeBinaryScalar } from './effect-promise-runtime-scalars';
import { unwrappedExpression } from './effect-boundary-ast-shared';

export type RuntimeControlScalar = RuntimeScalarResult;

const literalScalar = (node: ASTNode): RuntimeControlScalar => {
  const value: unknown = Reflect.get(node, 'value');
  if (
    value === null ||
    typeof value === 'boolean' ||
    typeof value === 'number' ||
    typeof value === 'string'
  ) {
    return value;
  }
  return unknownRuntimeValue;
};

const transformedUnaryScalar = (
  operator: unknown,
  value: RuntimeExactScalar,
): RuntimeControlScalar => {
  if (operator === '!') {
    return !value;
  }
  if (operator === '+') {
    return Number(value);
  }
  if (operator === '-') {
    return -Number(value);
  }
  return unknownRuntimeValue;
};

const unaryScalar = (
  node: ASTNode,
  host: RuntimeStatementHost,
  context: RuntimeExecutionContext,
): RuntimeControlScalar => {
  const operator: unknown = Reflect.get(node, 'operator');
  if (operator === 'void') {
    return undefined;
  }
  const value = expressionScalar(childNode(node, 'argument'), host, context);
  if (value === unknownRuntimeValue) {
    return value;
  }
  return transformedUnaryScalar(operator, value);
};

const binaryScalar = (
  node: ASTNode,
  host: RuntimeStatementHost,
  context: RuntimeExecutionContext,
): RuntimeControlScalar => {
  const left = expressionScalar(childNode(node, 'left'), host, context);
  const right = expressionScalar(childNode(node, 'right'), host, context);
  if (left === unknownRuntimeValue || right === unknownRuntimeValue) {
    return unknownRuntimeValue;
  }
  const operator: unknown = Reflect.get(node, 'operator');
  if (typeof operator !== 'string') {
    return unknownRuntimeValue;
  }
  return evaluateRuntimeBinaryScalar(operator, left, right);
};

const globalIdentifierScalar = (name: string | undefined): RuntimeControlScalar => {
  if (name === 'undefined') {
    return undefined;
  }
  if (name === 'NaN') {
    return Number.NaN;
  }
  if (name === 'Infinity') {
    return Number.POSITIVE_INFINITY;
  }
  return unknownRuntimeValue;
};

const identifierScalar = (
  node: ASTNode,
  host: RuntimeStatementHost,
  context: RuntimeExecutionContext,
): RuntimeControlScalar => {
  const name = identifierName(node);
  const value = resolvedRuntimeName(node, context.taskScopes);
  if (value === node) {
    return globalIdentifierScalar(name);
  }
  if (value === safeRuntimeValue || runtimeObjectReference(value)) {
    return unknownRuntimeValue;
  }
  return runtimeControlScalar(value, host, context);
};

const expressionScalar = (
  node: ASTNode | undefined,
  host: RuntimeStatementHost,
  context: RuntimeExecutionContext,
): RuntimeControlScalar => {
  const expression = unwrappedExpression(node);
  if (!expression) {
    return unknownRuntimeValue;
  }
  if (expression.type === 'Literal') {
    return literalScalar(expression);
  }
  if (expression.type === 'Identifier') {
    return identifierScalar(expression, host, context);
  }
  return compositeScalar(expression, host, context);
};

const compositeScalar = (
  expression: ASTNode,
  host: RuntimeStatementHost,
  context: RuntimeExecutionContext,
): RuntimeControlScalar => {
  if (expression.type === 'UnaryExpression') {
    return unaryScalar(expression, host, context);
  }
  if (expression.type === 'BinaryExpression') {
    return binaryScalar(expression, host, context);
  }
  return unknownRuntimeValue;
};

/**
 * Resolve one exact scalar, including known `undefined` and binary operations.
 *
 * @internal
 */
export const runtimeControlScalar = (
  value: RuntimeValue,
  host: RuntimeStatementHost,
  context: RuntimeExecutionContext,
): RuntimeControlScalar => {
  if (value === undefined) {
    return undefined;
  }
  return expressionScalar(runtimeNode(value), host, context);
};

/**
 * Resolve exact truthiness for a scalar control expression when supported.
 *
 * @internal
 */
export const runtimeControlTruthiness = (
  value: RuntimeValue,
  host: RuntimeStatementHost,
  context: RuntimeExecutionContext,
): boolean | undefined => {
  const scalar = runtimeControlScalar(value, host, context);
  if (scalar === unknownRuntimeValue) {
    return undefined;
  }
  return Boolean(scalar);
};

const scalarNode = (value: RuntimeExactScalar): ASTNode => {
  const node = { type: 'Literal', value };
  return node;
};

const updatedScalar = (
  operator: unknown,
  current: RuntimeExactScalar,
  operand: RuntimeExactScalar,
): RuntimeControlScalar => {
  if (operator === '+=') {
    return evaluateRuntimeBinaryScalar('+', current, operand);
  }
  if (operator === '-=') {
    return evaluateRuntimeBinaryScalar('-', current, operand);
  }
  return unknownRuntimeValue;
};

const applyAssignment = (
  host: RuntimeStatementHost,
  node: ASTNode,
  context: RuntimeExecutionContext,
): void => {
  const left = childNode(node, 'left');
  const name = identifierName(left);
  const current = expressionScalar(left, host, context);
  const operand = expressionScalar(childNode(node, 'right'), host, context);
  if (!name || current === unknownRuntimeValue || operand === unknownRuntimeValue) {
    return;
  }
  const value = updatedScalar(Reflect.get(node, 'operator'), current, operand);
  if (value !== unknownRuntimeValue) {
    assignRuntimeName(name, scalarNode(value), context.taskScopes);
  }
};

const applyUpdate = (
  host: RuntimeStatementHost,
  node: ASTNode,
  context: RuntimeExecutionContext,
): void => {
  const argument = childNode(node, 'argument');
  const name = identifierName(argument);
  const current = expressionScalar(argument, host, context);
  if (!name || typeof current !== 'number') {
    return;
  }
  let delta = 1;
  if (Reflect.get(node, 'operator') === '--') {
    delta = -1;
  }
  assignRuntimeName(name, scalarNode(current + delta), context.taskScopes);
};

/**
 * Apply one directly executed scalar update expression.
 *
 * @internal
 */
export const applyRuntimeScalarUpdate = (
  host: RuntimeStatementHost,
  node: ASTNode | undefined,
  context: RuntimeExecutionContext,
): void => {
  let expression = node;
  if (node?.type === 'ExpressionStatement') {
    expression = childNode(node, 'expression');
  }
  if (expression?.type === 'AssignmentExpression') {
    applyAssignment(host, expression, context);
  } else if (expression?.type === 'UpdateExpression') {
    applyUpdate(host, expression, context);
  }
};
