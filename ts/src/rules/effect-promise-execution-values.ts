/* -------------------------------------------------------------------------- */
/*       Abstract-value comparisons for Promise execution graph cycles.       */
/* -------------------------------------------------------------------------- */

import type {
  ArgumentValue,
  BoundArgument,
  ExecutionArguments,
  ParameterEnvironments,
} from './effect-promise-environment-types';
import type { FunctionBinding, HelperScopes } from './effect-promise-callable-types';
import {
  boundArgument,
  concreteArgument,
  isUndefinedArgument,
} from './effect-promise-environment-values';
import type { ASTNode } from './effect-ast';
import type { ScopeStack } from './effect-ast-scope';
import { childNode } from './effect-ast';
import { unknownArgument } from './effect-promise-environment-types';
import { unwrappedExpression } from './effect-boundary-ast-shared';

interface ComparisonState {
  compared: WeakMap<object, WeakSet<object>>;
}

const TRUTHY_EXPRESSION_TYPES = new Set([
  'ArrayExpression',
  'ArrowFunctionExpression',
  'ClassExpression',
  'FunctionExpression',
  'ObjectExpression',
]);

/**
 * One active function invocation used for exact recursion detection.
 *
 * @internal
 */
export interface InvocationFrame {
  argumentsList: ExecutionArguments;
  binding: FunctionBinding;
  environments: ParameterEnvironments;
  executeGeneratorBody: boolean;
}

const wasCompared = (left: object, right: object, state: ComparisonState): boolean => {
  const rights = state.compared.get(left);
  if (rights?.has(right)) {
    return true;
  }
  if (rights) {
    rights.add(right);
  } else {
    state.compared.set(left, new WeakSet([right]));
  }
  return false;
};

const visibleValues = (environments: ParameterEnvironments): Map<string, ArgumentValue> => {
  const values = new Map<string, ArgumentValue>();
  for (let index = environments.length - 1; index >= 0; index -= 1) {
    for (const [name, value] of environments[index]?.values ?? []) {
      if (!values.has(name)) {
        values.set(name, value);
      }
    }
  }
  return values;
};

const sameBoundArgument = (
  left: BoundArgument,
  right: BoundArgument,
  state: ComparisonState,
): boolean => {
  if (left.node !== right.node) {
    return false;
  }
  if (left.environments === right.environments || wasCompared(left, right, state)) {
    return true;
  }
  return sameEnvironments(left.environments, right.environments, state);
};

const sameArgument = (
  left: ArgumentValue,
  right: ArgumentValue,
  state: ComparisonState,
): boolean => {
  if (left === right) {
    return true;
  }
  if (!left || !right || left === unknownArgument || right === unknownArgument) {
    return false;
  }
  return sameBoundArgument(left, right, state);
};

const sameVisibleValues = (
  left: ReadonlyMap<string, ArgumentValue>,
  right: ReadonlyMap<string, ArgumentValue>,
  state: ComparisonState,
): boolean => {
  if (left.size !== right.size) {
    return false;
  }
  for (const [name, value] of left) {
    if (!right.has(name) || !sameArgument(value, right.get(name), state)) {
      return false;
    }
  }
  return true;
};

const sameEnvironments = (
  left: ParameterEnvironments,
  right: ParameterEnvironments,
  state: ComparisonState,
): boolean => {
  if (left === right) {
    return true;
  }
  return sameVisibleValues(visibleValues(left), visibleValues(right), state);
};

/**
 * Compare invocation arguments by concrete AST and normalized closure values.
 *
 * @internal
 */
export const sameExecutionArguments = (
  left: ExecutionArguments,
  right: ExecutionArguments,
): boolean => {
  if (left.isExact !== right.isExact || left.values.length !== right.values.length) {
    return false;
  }
  const state: ComparisonState = { compared: new WeakMap() };
  for (let index = 0; index < left.values.length; index += 1) {
    if (!sameArgument(left.values[index], right.values[index], state)) {
      return false;
    }
  }
  return true;
};

/**
 * Compare captured environments after removing overwritten outer bindings.
 *
 * @internal
 */
export const sameCapturedEnvironments = (
  left: ParameterEnvironments,
  right: ParameterEnvironments,
): boolean => sameEnvironments(left, right, { compared: new WeakMap() });

const literalTruthiness = (expression: ASTNode | undefined): boolean | undefined => {
  if (expression?.type !== 'Literal') {
    return undefined;
  }
  const literal: unknown = Reflect.get(expression, 'value');
  if (literal === null) {
    return false;
  }
  if (
    typeof literal === 'boolean' ||
    typeof literal === 'number' ||
    typeof literal === 'string' ||
    typeof literal === 'bigint'
  ) {
    return Boolean(literal);
  }
  return undefined;
};

const structuralTruthiness = (expression: ASTNode | undefined): boolean | undefined => {
  if (expression && TRUTHY_EXPRESSION_TYPES.has(expression.type)) {
    return true;
  }
  return undefined;
};

const isShadowed = (name: string, scopes: ScopeStack): boolean => {
  for (let index = scopes.length - 1; index >= 0; index -= 1) {
    if (scopes[index]?.has(name)) {
      return true;
    }
  }
  return false;
};

const globalNumericTruthiness = (
  expression: ASTNode | undefined,
  scopes: ScopeStack,
): boolean | undefined => {
  if (expression?.type !== 'Identifier') {
    return undefined;
  }
  const name: unknown = Reflect.get(expression, 'name');
  if (name === 'NaN' && !isShadowed('NaN', scopes)) {
    return false;
  }
  if (name === 'Infinity' && !isShadowed('Infinity', scopes)) {
    return true;
  }
  return undefined;
};

interface KnownNumber {
  value: number;
}

const literalNumber = (expression: ASTNode | undefined): KnownNumber | undefined => {
  if (expression?.type !== 'Literal') {
    return undefined;
  }
  const value: unknown = Reflect.get(expression, 'value');
  if (
    value === null ||
    typeof value === 'boolean' ||
    typeof value === 'number' ||
    typeof value === 'string'
  ) {
    return { value: Number(value) };
  }
  return undefined;
};

const globalNumber = (
  expression: ASTNode | undefined,
  scopes: ScopeStack,
): KnownNumber | undefined => {
  if (expression?.type !== 'Identifier') {
    return undefined;
  }
  const name: unknown = Reflect.get(expression, 'name');
  if (name === 'NaN' && !isShadowed('NaN', scopes)) {
    return { value: Number.NaN };
  }
  if (name === 'Infinity' && !isShadowed('Infinity', scopes)) {
    return { value: Number.POSITIVE_INFINITY };
  }
  return undefined;
};

const transformedNumber = (
  operator: unknown,
  operand: KnownNumber | undefined,
): KnownNumber | undefined => {
  if (!operand) {
    return undefined;
  }
  if (operator === '+') {
    return operand;
  }
  if (operator === '-') {
    return { value: -operand.value };
  }
  if (operator === '~') {
    return { value: ~operand.value };
  }
  return undefined;
};

const concreteNumericValue = (concrete: BoundArgument): KnownNumber | undefined => {
  const expression = unwrappedExpression(concrete.node);
  const direct = literalNumber(expression) ?? globalNumber(expression, concrete.scopes);
  if (direct || expression?.type !== 'UnaryExpression') {
    return direct;
  }
  const operand = knownNumericValue(
    childNode(expression, 'argument'),
    concrete.scopes,
    concrete.helperScopes,
    concrete.environments,
  );
  return transformedNumber(Reflect.get(expression, 'operator'), operand);
};

const knownNumericValue = (
  node: ASTNode | undefined,
  scopes: ScopeStack,
  helperScopes: HelperScopes,
  environments: ParameterEnvironments,
): KnownNumber | undefined => {
  const concrete = concreteArgument(boundArgument(node, scopes, helperScopes, environments));
  if (concrete) {
    return concreteNumericValue(concrete);
  }
  return undefined;
};

const negatedTruthiness = (
  argument: ASTNode | undefined,
  concrete: BoundArgument,
): boolean | undefined => {
  const operand = knownBooleanValue(
    argument,
    concrete.scopes,
    concrete.helperScopes,
    concrete.environments,
  );
  if (operand !== undefined) {
    return !operand;
  }
  return undefined;
};

const unaryTruthiness = (
  expression: ASTNode | undefined,
  concrete: BoundArgument,
): boolean | undefined => {
  if (expression?.type !== 'UnaryExpression') {
    return undefined;
  }
  const argument = childNode(expression, 'argument');
  const operator: unknown = Reflect.get(expression, 'operator');
  if (operator === '!') {
    return negatedTruthiness(argument, concrete);
  }
  if (operator === 'void') {
    return false;
  }
  return unaryNumericTruthiness(expression, concrete);
};

const unaryNumericTruthiness = (
  expression: ASTNode,
  concrete: BoundArgument,
): boolean | undefined => {
  const numeric = knownNumericValue(
    expression,
    concrete.scopes,
    concrete.helperScopes,
    concrete.environments,
  );
  if (numeric) {
    return Boolean(numeric.value);
  }
  return undefined;
};

const directTruthiness = (
  expression: ASTNode | undefined,
  scopes: ScopeStack,
): boolean | undefined => {
  const literal = literalTruthiness(expression);
  if (literal !== undefined) {
    return literal;
  }
  return globalNumericTruthiness(expression, scopes);
};

const concreteTruthiness = (
  concrete: BoundArgument | undefined,
  fallbackScopes: ScopeStack,
): boolean | undefined => {
  const expression = unwrappedExpression(concrete?.node);
  const scopes = concrete?.scopes ?? fallbackScopes;
  const direct = directTruthiness(expression, scopes);
  if (direct !== undefined) {
    return direct;
  }
  if (concrete) {
    const unary = unaryTruthiness(expression, concrete);
    if (unary !== undefined) {
      return unary;
    }
  }
  return structuralTruthiness(expression);
};

/**
 * Resolve one already evaluated abstract value to exact truthiness when possible.
 *
 * @internal
 */
export const knownArgumentBooleanValue = (
  value: ArgumentValue,
  fallbackScopes: ScopeStack,
): boolean | undefined => {
  if (isUndefinedArgument(value)) {
    return false;
  }
  const concrete = concreteArgument(value);
  return concreteTruthiness(concrete, fallbackScopes);
};

/**
 * Resolve an expression to a provable runtime boolean when possible.
 *
 * @internal
 */
export const knownBooleanValue = (
  node: ASTNode | undefined,
  scopes: ScopeStack,
  helperScopes: HelperScopes,
  environments: ParameterEnvironments,
): boolean | undefined => {
  const value = boundArgument(node, scopes, helperScopes, environments);
  return knownArgumentBooleanValue(value, scopes);
};
