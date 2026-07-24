/* -------------------------------------------------------------------------- */
/*       Exact call arguments for the Effect runtime task interpreter.        */
/* -------------------------------------------------------------------------- */

import type {
  RuntimeExecutionContext,
  RuntimeResult,
  RuntimeStatementHost,
  RuntimeValue,
} from './effect-promise-runtime-model';
import type { ASTNode } from './effect-ast';
import { RUNTIME_NORMAL } from './effect-promise-runtime-model';
import { childNode } from './effect-ast';
import { rawPromiseNodes } from './effect-promise-ast-values';
import { runtimeArrayValues } from './effect-promise-runtime-heap';
import { runtimeObjectReference } from './effect-promise-runtime-values';

/**
 * Exact arguments and completion produced by left-to-right evaluation.
 *
 * @internal
 */
export interface RuntimeArgumentsResult {
  completion: RuntimeResult['completion'];
  values: readonly RuntimeValue[];
}

const spreadValues = (
  host: RuntimeStatementHost,
  value: RuntimeValue,
): readonly RuntimeValue[] | undefined => {
  const reference = runtimeObjectReference(value);
  if (reference) {
    return runtimeArrayValues(host.state, reference);
  }
  return undefined;
};

const argumentExpression = (argument: ASTNode): ASTNode | undefined => {
  if (argument.type === 'SpreadElement') {
    return childNode(argument, 'argument');
  }
  return argument;
};

const appendArgument = (
  host: RuntimeStatementHost,
  argument: ASTNode,
  value: RuntimeValue,
  values: RuntimeValue[],
): void => {
  const spread = spreadValues(host, value);
  if (argument.type === 'SpreadElement' && spread) {
    values.push(...spread);
    return;
  }
  values.push(value);
};

/**
 * Evaluate call arguments exactly, including bounded exact array spreads.
 *
 * @internal
 */
export const evaluateRuntimeArguments = (
  host: RuntimeStatementHost,
  node: ASTNode,
  context: RuntimeExecutionContext,
  evaluate: (node: ASTNode, context: RuntimeExecutionContext) => RuntimeResult,
): RuntimeArgumentsResult => {
  const values: RuntimeValue[] = [];
  for (const argument of rawPromiseNodes(node, 'arguments')) {
    const expression = argument && argumentExpression(argument);
    if (argument && expression) {
      const result = evaluate(expression, context);
      if (result.completion !== RUNTIME_NORMAL) {
        return { completion: result.completion, values };
      }
      appendArgument(host, argument, result.value, values);
    }
  }
  return { completion: RUNTIME_NORMAL, values };
};
