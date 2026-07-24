/* -------------------------------------------------------------------------- */
/*    Exact call targets and receivers for the Effect runtime interpreter.    */
/* -------------------------------------------------------------------------- */

import type {
  RuntimeExecutionContext,
  RuntimeResult,
  RuntimeStatementHost,
} from './effect-promise-runtime-model';
import {
  runtimeCallable,
  runtimeCallableForNode,
  runtimeCallableWrapper,
} from './effect-promise-runtime-callables';
import type { ASTNode } from './effect-ast';
import { RUNTIME_NORMAL } from './effect-promise-runtime-model';
import type { RuntimeCallableTarget } from './effect-promise-runtime-callables';
import { childNode } from './effect-ast';
import { executeRuntimeMemberTarget } from './effect-promise-runtime-members';

type RuntimeEvaluator = (node: ASTNode, context: RuntimeExecutionContext) => RuntimeResult;

/**
 * Completion and exact callable target produced by callee evaluation.
 *
 * @internal
 */
export interface RuntimeCallTargetResult {
  completion: RuntimeResult['completion'];
  target?: RuntimeCallableTarget;
}

const callableReceiver = (
  host: RuntimeStatementHost,
  callee: ASTNode,
  receiver: RuntimeResult['value'],
  context: RuntimeExecutionContext,
): RuntimeResult['value'] =>
  runtimeCallable(receiver) ?? runtimeCallableForNode(host, childNode(callee, 'object'), context);

const memberCallTarget = (
  host: RuntimeStatementHost,
  callee: ASTNode,
  context: RuntimeExecutionContext,
  evaluate: RuntimeEvaluator,
): RuntimeCallTargetResult => {
  const member = executeRuntimeMemberTarget(host, callee, context, evaluate);
  if (member.result.completion !== RUNTIME_NORMAL) {
    return { completion: member.result.completion };
  }
  const receiver = callableReceiver(host, callee, member.receiver, context);
  if (runtimeCallableWrapper(callee) && receiver && !member.isOwnCallableProperty) {
    return {
      completion: RUNTIME_NORMAL,
      target: { callee, value: receiver },
    };
  }
  let callableSpelling: ASTNode | undefined = undefined;
  if (!runtimeCallableWrapper(callee)) {
    callableSpelling = callee;
  }
  return {
    completion: RUNTIME_NORMAL,
    target: {
      callee: callableSpelling,
      receiver: member.receiver,
      value: member.result.value,
    },
  };
};

/**
 * Evaluate one direct or member call target exactly once.
 *
 * @internal
 */
export const evaluateRuntimeCallTarget = (
  host: RuntimeStatementHost,
  callee: ASTNode | undefined,
  context: RuntimeExecutionContext,
  evaluate: RuntimeEvaluator,
): RuntimeCallTargetResult => {
  if (!callee) {
    return { completion: RUNTIME_NORMAL };
  }
  if (callee.type === 'MemberExpression') {
    return memberCallTarget(host, callee, context, evaluate);
  }
  const result = evaluate(callee, context);
  if (result.completion !== RUNTIME_NORMAL) {
    return { completion: result.completion };
  }
  return {
    completion: RUNTIME_NORMAL,
    target: { callee, value: result.value },
  };
};
