/* -------------------------------------------------------------------------- */
/*         Ordered child traversal for Promise execution evaluation.          */
/* -------------------------------------------------------------------------- */

import { COMPLETION_NORMAL, NORMAL_EVALUATION } from './effect-promise-completion';
import { childKeysFor, childScopesFor } from './effect-promise-execution-navigation';
import type { ASTNode } from './effect-ast';
import type { HelperScopes } from './effect-promise-callable-types';
import type { ParameterEnvironments } from './effect-promise-environment-types';
import type { PromiseEvaluation } from './effect-promise-completion';
import type { PromiseExecutionState } from './effect-promise-execution-types';
import type { ScopeStack } from './effect-ast-scope';
import { asNode } from './effect-ast';

/**
 * Engine capabilities required to visit evaluated child nodes.
 *
 * @internal
 */
export interface PromiseChildEvaluator {
  readonly state: PromiseExecutionState;
  visit: (
    node: ASTNode,
    scopes: ScopeStack,
    helperScopes: HelperScopes,
    environments: ParameterEnvironments,
  ) => PromiseEvaluation;
}

interface ChildTraversalContext {
  environments: ParameterEnvironments;
  helperScopes: HelperScopes;
  nodeScopes: ScopeStack;
}

const visitChildArray = (
  evaluator: PromiseChildEvaluator,
  values: readonly unknown[],
  scopes: ScopeStack,
  helperScopes: HelperScopes,
  environments: ParameterEnvironments,
): PromiseEvaluation => {
  for (const value of values) {
    const child = asNode(value);
    if (child) {
      const result = evaluator.visit(child, scopes, helperScopes, environments);
      if (result.completion !== COMPLETION_NORMAL) {
        return result;
      }
    }
  }
  return NORMAL_EVALUATION;
};

const visitChildValue = (
  evaluator: PromiseChildEvaluator,
  node: ASTNode,
  key: string,
  context: ChildTraversalContext,
): PromiseEvaluation => {
  const scopes = childScopesFor(evaluator.state, context.nodeScopes, node, key);
  const value: unknown = Reflect.get(node, key);
  if (Array.isArray(value)) {
    const values: readonly unknown[] = value;
    return visitChildArray(evaluator, values, scopes, context.helperScopes, context.environments);
  }
  const child = asNode(value);
  if (child) {
    return evaluator.visit(child, scopes, context.helperScopes, context.environments);
  }
  return NORMAL_EVALUATION;
};

/**
 * Visit syntactic children left-to-right until one completion stops evaluation.
 *
 * @internal
 */
export const visitPromiseChildren = (
  evaluator: PromiseChildEvaluator,
  node: ASTNode,
  nodeScopes: ScopeStack,
  helperScopes: HelperScopes,
  environments: ParameterEnvironments,
): PromiseEvaluation => {
  const context = { environments, helperScopes, nodeScopes };
  for (const key of childKeysFor(evaluator.state, node)) {
    if (key !== 'parent') {
      const result = visitChildValue(evaluator, node, key, context);
      if (result.completion !== COMPLETION_NORMAL) {
        return result;
      }
    }
  }
  return NORMAL_EVALUATION;
};
