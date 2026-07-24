/* -------------------------------------------------------------------------- */
/*        Exact member reads for the Effect runtime task interpreter.         */
/* -------------------------------------------------------------------------- */

import { RUNTIME_NORMAL, unknownRuntimeValue } from './effect-promise-runtime-model';
import type {
  RuntimeExecutionContext,
  RuntimeResult,
  RuntimeStatementHost,
  RuntimeValue,
} from './effect-promise-runtime-model';
import {
  hasRuntimeCallableProperty,
  readRuntimeCallableProperty,
} from './effect-promise-runtime-callable-properties';
import { runtimeMemberName, runtimeScalar } from './effect-promise-runtime-values';
import type { ASTNode } from './effect-ast';
import { childNode } from './effect-ast';
import { readRuntimeChoiceMember } from './effect-promise-runtime-choice-operations';
import { runtimeCallable } from './effect-promise-runtime-callables';

type RuntimeEvaluator = (node: ASTNode, context: RuntimeExecutionContext) => RuntimeResult;

interface RuntimeMemberNameResult {
  completion: RuntimeResult['completion'];
  name?: string;
}

/**
 * Evaluated member value together with its exact receiver and own-property status.
 *
 * @internal
 */
export interface RuntimeMemberTargetResult {
  isOwnCallableProperty: boolean;
  name?: string;
  receiver: RuntimeResult['value'];
  result: RuntimeResult;
}

const computedName = (
  host: RuntimeStatementHost,
  value: RuntimeResult['value'],
  context: RuntimeExecutionContext,
): string | undefined => {
  const scalar = runtimeScalar(value, host.valueContext(context));
  if (scalar === unknownRuntimeValue) {
    return undefined;
  }
  return String(scalar);
};

const memberName = (
  host: RuntimeStatementHost,
  node: ASTNode,
  context: RuntimeExecutionContext,
  evaluate: RuntimeEvaluator,
): RuntimeMemberNameResult => {
  if (Reflect.get(node, 'computed') !== true) {
    return { completion: RUNTIME_NORMAL, name: runtimeMemberName(node) };
  }
  const property = childNode(node, 'property');
  if (!property) {
    return { completion: RUNTIME_NORMAL };
  }
  const result = evaluate(property, context);
  if (result.completion !== RUNTIME_NORMAL) {
    return { completion: result.completion };
  }
  return {
    completion: RUNTIME_NORMAL,
    name: computedName(host, result.value, context),
  };
};

const evaluatedMemberValue = (
  host: RuntimeStatementHost,
  target: RuntimeResult['value'],
  name: string,
): RuntimeValue => {
  const callable = runtimeCallable(target);
  if (callable && hasRuntimeCallableProperty(callable, name)) {
    return readRuntimeCallableProperty(callable, name);
  }
  return readRuntimeChoiceMember(host.state, target, name);
};

const namedMemberTarget = (
  host: RuntimeStatementHost,
  target: RuntimeResult,
  name: string,
): RuntimeMemberTargetResult => {
  const callable = runtimeCallable(target.value);
  const isOwnCallableProperty = Boolean(callable && hasRuntimeCallableProperty(callable, name));
  return {
    isOwnCallableProperty,
    name,
    receiver: target.value,
    result: {
      completion: RUNTIME_NORMAL,
      value: evaluatedMemberValue(host, target.value, name),
    },
  };
};

/**
 * Evaluate a member base and computed key exactly once, then read all object alternatives.
 *
 * @internal
 */
export const executeRuntimeMemberTarget = (
  host: RuntimeStatementHost,
  node: ASTNode,
  context: RuntimeExecutionContext,
  evaluate: RuntimeEvaluator,
): RuntimeMemberTargetResult => {
  const object = childNode(node, 'object');
  if (!object) {
    return {
      isOwnCallableProperty: false,
      receiver: undefined,
      result: { completion: RUNTIME_NORMAL, value: unknownRuntimeValue },
    };
  }
  const target = evaluate(object, context);
  if (target.completion !== RUNTIME_NORMAL) {
    return { isOwnCallableProperty: false, receiver: undefined, result: target };
  }
  const name = memberName(host, node, context, evaluate);
  if (name.completion !== RUNTIME_NORMAL || name.name === undefined) {
    return {
      isOwnCallableProperty: false,
      receiver: target.value,
      result: { completion: name.completion, value: unknownRuntimeValue },
    };
  }
  return namedMemberTarget(host, target, name.name);
};

/**
 * Evaluate one exact member read.
 *
 * @internal
 */
export const executeRuntimeMember = (
  host: RuntimeStatementHost,
  node: ASTNode,
  context: RuntimeExecutionContext,
  evaluate: RuntimeEvaluator,
): RuntimeResult => executeRuntimeMemberTarget(host, node, context, evaluate).result;
