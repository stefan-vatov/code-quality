/* -------------------------------------------------------------------------- */
/*       Ordered expression evaluation for Promise execution analysis.        */
/* -------------------------------------------------------------------------- */

import type {
  ArgumentValue,
  ExecutionArguments,
  ParameterEnvironments,
} from './effect-promise-environment-types';
import {
  COMPLETION_NORMAL,
  NORMAL_EVALUATION,
  normalEvaluation,
} from './effect-promise-completion';
import type { FunctionBinding, HelperScopes } from './effect-promise-callable-types';
import { arrayValues, objectPropertyRead } from './effect-promise-environment-projections';
import { assignArgument, concreteArgument } from './effect-promise-environment-values';
import { childNode, identifierName } from './effect-ast';
import type { ASTNode } from './effect-ast';
import type { PromiseEvaluation } from './effect-promise-completion';
import type { ScopeStack } from './effect-ast-scope';
import { memberPropertyName } from './effect-promise-callables';
import { rawPromiseNodes } from './effect-promise-ast-values';
import { unknownArgument } from './effect-promise-environment-types';

/**
 * Engine capabilities required by ordered expression evaluation.
 *
 * @internal
 */
export interface PromiseNodeEvaluator {
  execute: (
    binding: FunctionBinding,
    argumentsList: ExecutionArguments,
    environments: ParameterEnvironments,
  ) => PromiseEvaluation;
  visit: (
    node: ASTNode,
    scopes: ScopeStack,
    helperScopes: HelperScopes,
    environments: ParameterEnvironments,
  ) => PromiseEvaluation;
}

/**
 * Exact evaluated operands for one CallExpression.
 *
 * @internal
 */
export interface PromiseCallOperands {
  argumentsList: ExecutionArguments;
  calleeValue: ArgumentValue;
  result: PromiseEvaluation;
}

interface EvaluatedArguments {
  isExact: boolean;
  result: PromiseEvaluation;
  values: ArgumentValue[];
}

interface EvaluatedArgument {
  expanded: ExecutionArguments;
  result: PromiseEvaluation;
}

/**
 * Evaluate and apply one simple assignment in JavaScript order.
 *
 * @internal
 */
export const evaluatePromiseAssignment = (
  evaluator: PromiseNodeEvaluator,
  assignment: ASTNode,
  scopes: ScopeStack,
  helperScopes: HelperScopes,
  environments: ParameterEnvironments,
): PromiseEvaluation => {
  const right = childNode(assignment, 'right');
  if (!right) {
    return NORMAL_EVALUATION;
  }
  const result = evaluator.visit(right, scopes, helperScopes, environments);
  if (result.completion !== COMPLETION_NORMAL) {
    return result;
  }
  const name = identifierName(childNode(assignment, 'left'));
  if (name && Reflect.get(assignment, 'operator') === '=') {
    assignArgument(name, result.value, helperScopes, environments);
  }
  return result;
};

const evaluateComputedProperty = (
  evaluator: PromiseNodeEvaluator,
  member: ASTNode,
  scopes: ScopeStack,
  helperScopes: HelperScopes,
  environments: ParameterEnvironments,
): PromiseEvaluation => {
  if (Reflect.get(member, 'computed') !== true) {
    return NORMAL_EVALUATION;
  }
  const property = childNode(member, 'property');
  if (!property) {
    return NORMAL_EVALUATION;
  }
  return evaluator.visit(property, scopes, helperScopes, environments);
};

/**
 * Evaluate a member base, computed key, and live getter in source order.
 *
 * @internal
 */
export const evaluatePromiseMember = (
  evaluator: PromiseNodeEvaluator,
  member: ASTNode,
  scopes: ScopeStack,
  helperScopes: HelperScopes,
  environments: ParameterEnvironments,
): PromiseEvaluation => {
  const object = childNode(member, 'object');
  if (!object) {
    return NORMAL_EVALUATION;
  }
  const objectResult = evaluator.visit(object, scopes, helperScopes, environments);
  if (objectResult.completion !== COMPLETION_NORMAL) {
    return objectResult;
  }
  const propertyResult = evaluateComputedProperty(
    evaluator,
    member,
    scopes,
    helperScopes,
    environments,
  );
  if (propertyResult.completion !== COMPLETION_NORMAL) {
    return propertyResult;
  }
  return evaluateNamedMemberRead(evaluator, member, objectResult.value);
};

const evaluateNamedMemberRead = (
  evaluator: PromiseNodeEvaluator,
  member: ASTNode,
  object: ArgumentValue,
): PromiseEvaluation => {
  const propertyName = memberPropertyName(member);
  if (!propertyName) {
    return normalEvaluation(unknownArgument);
  }
  return evaluateMemberRead(evaluator, object, propertyName);
};

const evaluateMemberRead = (
  evaluator: PromiseNodeEvaluator,
  object: ArgumentValue,
  propertyName: string,
): PromiseEvaluation => {
  const read = objectPropertyRead(object, propertyName);
  if (!read.getter) {
    return normalEvaluation(read.value);
  }
  const getter = evaluator.execute(
    read.getter.binding,
    { isExact: true, values: [] },
    read.getter.environments,
  );
  if (getter.completion !== COMPLETION_NORMAL) {
    return getter;
  }
  return normalEvaluation(getter.value ?? read.value);
};

const failedCallOperands = (result: PromiseEvaluation): PromiseCallOperands => ({
  argumentsList: { isExact: false, values: [] },
  calleeValue: undefined,
  result,
});

const evaluateCallee = (
  evaluator: PromiseNodeEvaluator,
  call: ASTNode,
  scopes: ScopeStack,
  helperScopes: HelperScopes,
  environments: ParameterEnvironments,
): PromiseEvaluation => {
  const callee = childNode(call, 'callee');
  if (!callee) {
    return NORMAL_EVALUATION;
  }
  return evaluator.visit(callee, scopes, helperScopes, environments);
};

const evaluateArguments = (
  evaluator: PromiseNodeEvaluator,
  call: ASTNode,
  scopes: ScopeStack,
  helperScopes: HelperScopes,
  environments: ParameterEnvironments,
): EvaluatedArguments => {
  const values: ArgumentValue[] = [];
  let isExact = true;
  for (const argument of rawPromiseNodes(call, 'arguments')) {
    if (argument) {
      const { expanded, result } = evaluateArgument(
        evaluator,
        argument,
        scopes,
        helperScopes,
        environments,
      );
      if (result.completion !== COMPLETION_NORMAL) {
        return { isExact: false, result, values };
      }
      values.push(...expanded.values);
      isExact &&= expanded.isExact;
    }
  }
  return { isExact, result: NORMAL_EVALUATION, values };
};

const evaluateArgument = (
  evaluator: PromiseNodeEvaluator,
  argument: ASTNode,
  scopes: ScopeStack,
  helperScopes: HelperScopes,
  environments: ParameterEnvironments,
): EvaluatedArgument => {
  let evaluatedNode: ASTNode | undefined = argument;
  if (argument.type === 'SpreadElement') {
    evaluatedNode = childNode(argument, 'argument');
  }
  if (!evaluatedNode) {
    return { expanded: { isExact: true, values: [] }, result: NORMAL_EVALUATION };
  }
  const result = evaluator.visit(evaluatedNode, scopes, helperScopes, environments);
  return { expanded: expandedArgument(argument, result.value), result };
};

const expandedArgument = (argument: ASTNode, value: ArgumentValue): ExecutionArguments => {
  if (argument.type !== 'SpreadElement') {
    return { isExact: true, values: [value] };
  }
  const array = concreteArgument(value);
  if (array?.node.type === 'ArrayExpression') {
    return arrayValues(array);
  }
  return { isExact: false, values: [] };
};

/**
 * Evaluate a callee and every argument left-to-right before invocation.
 *
 * @internal
 */
export const evaluatePromiseCallOperands = (
  evaluator: PromiseNodeEvaluator,
  call: ASTNode,
  scopes: ScopeStack,
  helperScopes: HelperScopes,
  environments: ParameterEnvironments,
): PromiseCallOperands => {
  const callee = evaluateCallee(evaluator, call, scopes, helperScopes, environments);
  if (callee.completion !== COMPLETION_NORMAL) {
    return failedCallOperands(callee);
  }
  const argumentsResult = evaluateArguments(evaluator, call, scopes, helperScopes, environments);
  if (argumentsResult.result.completion !== COMPLETION_NORMAL) {
    return failedCallOperands(argumentsResult.result);
  }
  return {
    argumentsList: {
      isExact: argumentsResult.isExact,
      values: argumentsResult.values,
    },
    calleeValue: callee.value,
    result: NORMAL_EVALUATION,
  };
};
