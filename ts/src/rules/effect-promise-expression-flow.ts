/* -------------------------------------------------------------------------- */
/*      Exact logical and conditional flow for Promise execution graphs.      */
/* -------------------------------------------------------------------------- */

import {
  COMPLETION_NORMAL,
  NORMAL_EVALUATION,
  joinPromiseEnvironments,
  joinPromiseEvaluations,
  restorePromiseEnvironments,
  snapshotPromiseEnvironments,
} from './effect-promise-completion';
import type { ASTNode } from './effect-ast';
import type { HelperScopes } from './effect-promise-callable-types';
import type { ParameterEnvironments } from './effect-promise-environment-types';
import type { PromiseEvaluation } from './effect-promise-completion';
import type { ScopeStack } from './effect-ast-scope';
import { childNode } from './effect-ast';
import { knownArgumentBooleanValue } from './effect-promise-execution-values';

/**
 * Visitor capability used by exact expression flow.
 *
 * @internal
 */
export interface PromiseExpressionVisitor {
  visit: (
    node: ASTNode,
    scopes: ScopeStack,
    helperScopes: HelperScopes,
    environments: ParameterEnvironments,
  ) => PromiseEvaluation;
}

interface PromiseExpressionInput {
  environments: ParameterEnvironments;
  helperScopes: HelperScopes;
  node: ASTNode;
  scopes: ScopeStack;
}

const visitOptionalChild = (
  visitor: PromiseExpressionVisitor,
  input: PromiseExpressionInput,
  key: string,
): PromiseEvaluation => {
  const child = childNode(input.node, key);
  if (!child) {
    return NORMAL_EVALUATION;
  }
  return visitor.visit(child, input.scopes, input.helperScopes, input.environments);
};

const visitUnknownConditional = (
  visitor: PromiseExpressionVisitor,
  input: PromiseExpressionInput,
): PromiseEvaluation => {
  const baseline = snapshotPromiseEnvironments(input.environments);
  const consequent = visitOptionalChild(visitor, input, 'consequent');
  const consequentValues = snapshotPromiseEnvironments(input.environments);
  restorePromiseEnvironments(input.environments, baseline);
  const alternate = visitOptionalChild(visitor, input, 'alternate');
  const alternateValues = snapshotPromiseEnvironments(input.environments);
  joinPromiseEnvironments(input.environments, consequentValues, alternateValues);
  return joinPromiseEvaluations(consequent, alternate);
};

const visitConditional = (
  visitor: PromiseExpressionVisitor,
  input: PromiseExpressionInput,
): PromiseEvaluation => {
  const test = childNode(input.node, 'test');
  const testResult = visitConditionalTest(visitor, input, test);
  if (testResult.completion !== COMPLETION_NORMAL) {
    return testResult;
  }
  const known = knownArgumentBooleanValue(testResult.value, input.scopes);
  if (known === undefined) {
    return visitUnknownConditional(visitor, input);
  }
  return visitOptionalChild(visitor, input, selectedConditionalKey(known));
};

const visitConditionalTest = (
  visitor: PromiseExpressionVisitor,
  input: PromiseExpressionInput,
  test: ASTNode | undefined,
): PromiseEvaluation => {
  if (!test) {
    return NORMAL_EVALUATION;
  }
  return visitor.visit(test, input.scopes, input.helperScopes, input.environments);
};

const selectedConditionalKey = (known: boolean): string => {
  if (known) {
    return 'consequent';
  }
  return 'alternate';
};

const shouldSkipLogicalRight = (operator: unknown, known: boolean): boolean =>
  (operator === '&&' && !known) || (operator === '||' && known);

const visitLogical = (
  visitor: PromiseExpressionVisitor,
  input: PromiseExpressionInput,
): PromiseEvaluation => {
  const left = childNode(input.node, 'left');
  let leftResult = NORMAL_EVALUATION;
  if (left) {
    leftResult = visitor.visit(left, input.scopes, input.helperScopes, input.environments);
    if (leftResult.completion !== COMPLETION_NORMAL) {
      return leftResult;
    }
  }
  const known = knownArgumentBooleanValue(leftResult.value, input.scopes);
  if (known === undefined || shouldSkipLogicalRight(Reflect.get(input.node, 'operator'), known)) {
    return leftResult;
  }
  return visitOptionalChild(visitor, input, 'right');
};

const isSupportedLogical = (node: ASTNode): boolean =>
  node.type === 'LogicalExpression' &&
  (Reflect.get(node, 'operator') === '&&' || Reflect.get(node, 'operator') === '||');

/**
 * Evaluate an exact conditional/logical expression, or decline unsupported nodes.
 *
 * @internal
 */
export const visitPromiseControlExpression = (
  visitor: PromiseExpressionVisitor,
  input: PromiseExpressionInput,
): PromiseEvaluation | undefined => {
  if (input.node.type === 'ConditionalExpression') {
    return visitConditional(visitor, input);
  }
  if (isSupportedLogical(input.node)) {
    return visitLogical(visitor, input);
  }
  return undefined;
};
