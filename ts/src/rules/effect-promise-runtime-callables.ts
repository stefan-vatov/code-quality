/* -------------------------------------------------------------------------- */
/*      Per-instance callable values for the Effect runtime interpreter.      */
/* -------------------------------------------------------------------------- */

import {
  RUNTIME_MAYBE_ABRUPT,
  RUNTIME_NORMAL,
  RUNTIME_THROW,
  safeRuntimeValue,
  unknownRuntimeValue,
} from './effect-promise-runtime-model';
import type {
  RuntimeCallableValue,
  RuntimeExecutionContext,
  RuntimeResult,
  RuntimeStatementHost,
  RuntimeValue,
} from './effect-promise-runtime-model';
import { isFunctionNode, unwrappedExpression } from './effect-boundary-ast-shared';
import { runtimeMemberName, runtimeObjectReference } from './effect-promise-runtime-values';
import type { ASTNode } from './effect-ast';
import { callableBinding } from './effect-promise-callables';
import { runtimeArrayValues } from './effect-promise-runtime-heap';
import { runtimeChoice } from './effect-promise-runtime-choice';
import { runtimeThisBinding } from './effect-promise-runtime-this';

const stableCallables = new WeakMap<
  RuntimeStatementHost,
  WeakMap<object, WeakMap<object, RuntimeCallableValue>>
>();

const cachedCallable = (
  host: RuntimeStatementHost,
  bindingNode: object,
  scopes: readonly object[],
): RuntimeCallableValue | undefined =>
  stableCallables
    .get(host)
    ?.get(bindingNode)
    ?.get(scopes as object);

const cacheCallable = (
  host: RuntimeStatementHost,
  callable: RuntimeCallableValue,
): RuntimeCallableValue => {
  let byBinding = stableCallables.get(host);
  if (!byBinding) {
    byBinding = new WeakMap();
    stableCallables.set(host, byBinding);
  }
  let byScopes = byBinding.get(callable.binding.node);
  if (!byScopes) {
    byScopes = new WeakMap();
    byBinding.set(callable.binding.node, byScopes);
  }
  byScopes.set(callable.scopes as object, callable);
  return callable;
};

const createdCallable = (
  binding: RuntimeCallableValue['binding'],
  scopes: RuntimeCallableValue['scopes'],
): RuntimeCallableValue => ({
  binding,
  boundArguments: [],
  kind: 'callable',
  scopes,
});

const reusableCallable = (
  host: RuntimeStatementHost,
  node: ASTNode | undefined,
  callable: RuntimeCallableValue,
): RuntimeCallableValue => {
  if (isFunctionNode(unwrappedExpression(node))) {
    return callable;
  }
  return (
    cachedCallable(host, callable.binding.node, callable.scopes) ?? cacheCallable(host, callable)
  );
};

/**
 * Narrow one abstract value to an exact callable instance.
 *
 * @internal
 */
export const runtimeCallable = (value: RuntimeValue): RuntimeCallableValue | undefined => {
  if (value && typeof value !== 'symbol' && 'kind' in value && value.kind === 'callable') {
    return value;
  }
  return undefined;
};

/**
 * Materialize a callable spelling with the environment captured at declaration. Function expressions
 * evaluated repeatedly intentionally produce distinct values so closures created by one factory
 * invocation cannot reuse another invocation's parameters.
 *
 * @internal
 */
export const runtimeCallableForNode = (
  host: RuntimeStatementHost,
  node: ASTNode | undefined,
  context: RuntimeExecutionContext,
): RuntimeCallableValue | undefined => {
  const binding = callableBinding(node, [], context.helperScopes);
  if (!binding) {
    return undefined;
  }
  const scopes = host.captures.get(binding.node) ?? context.taskScopes;
  const callable = createdCallable(binding, scopes);
  return reusableCallable(host, node, callable);
};

/**
 * Add arguments to one callable instance without invoking it.
 *
 * @internal
 */
export const bindRuntimeCallable = (
  callable: RuntimeCallableValue,
  argumentsList: readonly RuntimeValue[],
  requestedThis?: RuntimeValue,
  isThisProvided = false,
): RuntimeCallableValue => ({
  binding: callable.binding,
  boundArguments: [...callable.boundArguments, ...argumentsList],
  boundThis: boundRuntimeThis(callable, requestedThis, isThisProvided),
  kind: 'callable',
  scopes: callable.scopes,
});

const boundRuntimeThis = (
  callable: RuntimeCallableValue,
  requestedThis: RuntimeValue,
  isThisProvided: boolean,
): RuntimeValue => {
  if (callable.boundThis !== undefined) {
    return callable.boundThis;
  }
  if (isThisProvided) {
    return runtimeThisBinding(requestedThis);
  }
  return undefined;
};

/**
 * Function prototype wrapper recognized without treating arbitrary members as calls.
 *
 * @internal
 */
export type RuntimeCallableWrapper = 'apply' | 'bind' | 'call';

/**
 * Resolve a statically named Function prototype wrapper.
 *
 * @internal
 */
export const runtimeCallableWrapper = (
  callee: ASTNode | undefined,
): RuntimeCallableWrapper | undefined => {
  if (callee?.type !== 'MemberExpression') {
    return undefined;
  }
  const name = runtimeMemberName(callee);
  if (name === 'apply' || name === 'bind' || name === 'call') {
    return name;
  }
  return undefined;
};

const appliedArguments = (
  host: RuntimeStatementHost,
  value: RuntimeValue,
): readonly RuntimeValue[] | undefined => {
  if (value === undefined) {
    return [];
  }
  const reference = runtimeObjectReference(value);
  if (reference) {
    return runtimeArrayValues(host.state, reference);
  }
  return undefined;
};

const wrapperArguments = (
  host: RuntimeStatementHost,
  wrapper: RuntimeCallableWrapper,
  argumentsList: readonly RuntimeValue[],
): readonly RuntimeValue[] | undefined => {
  if (wrapper === 'apply') {
    return appliedArguments(host, argumentsList[1]);
  }
  return argumentsList.slice(1);
};

const invokeWrapper = (
  host: RuntimeStatementHost,
  wrapper: RuntimeCallableWrapper,
  callable: RuntimeCallableValue,
  argumentsList: readonly RuntimeValue[],
  context: RuntimeExecutionContext,
): RuntimeResult => {
  if (wrapper === 'bind') {
    return {
      completion: RUNTIME_NORMAL,
      value: bindRuntimeCallable(callable, argumentsList.slice(1), argumentsList[0], true),
    };
  }
  const invocationArguments = wrapperArguments(host, wrapper, argumentsList);
  if (invocationArguments) {
    const bound = bindRuntimeCallable(callable, [], argumentsList[0], true);
    return host.invoke(bound, invocationArguments, context);
  }
  return { completion: RUNTIME_NORMAL, value: unknownRuntimeValue };
};

interface RuntimeCallableDispatch {
  receiver?: RuntimeValue;
  wrapper?: RuntimeCallableWrapper;
}

const invokeCallable = (
  host: RuntimeStatementHost,
  dispatch: RuntimeCallableDispatch,
  callable: RuntimeCallableValue,
  argumentsList: readonly RuntimeValue[],
  context: RuntimeExecutionContext,
): RuntimeResult => {
  if (dispatch.wrapper) {
    return invokeWrapper(host, dispatch.wrapper, callable, argumentsList, context);
  }
  const isReceiverProvided = dispatch.receiver !== undefined;
  const bound = bindRuntimeCallable(callable, [], dispatch.receiver, isReceiverProvided);
  return host.invoke(bound, argumentsList, context);
};

const UNKNOWN_CALL_RESULT: RuntimeResult = {
  completion: RUNTIME_MAYBE_ABRUPT,
  value: unknownRuntimeValue,
};
const THROW_CALL_RESULT: RuntimeResult = {
  completion: RUNTIME_THROW,
  value: undefined,
};

const isExactNonCallable = (value: RuntimeValue): boolean =>
  value === undefined ||
  value === safeRuntimeValue ||
  (value !== unknownRuntimeValue &&
    typeof value !== 'symbol' &&
    'kind' in value &&
    value.kind !== 'callable' &&
    value.kind !== 'choice');

const invokeCallableAlternative = (
  host: RuntimeStatementHost,
  dispatch: RuntimeCallableDispatch,
  value: RuntimeValue,
  argumentsList: readonly RuntimeValue[],
  context: RuntimeExecutionContext,
): RuntimeResult | undefined => {
  const callable = runtimeCallable(value);
  if (callable) {
    return invokeCallable(host, dispatch, callable, argumentsList, context);
  }
  if (value === unknownRuntimeValue) {
    return UNKNOWN_CALL_RESULT;
  }
  if (isExactNonCallable(value)) {
    return THROW_CALL_RESULT;
  }
  return undefined;
};

const invokeCallableAlternatives = (
  host: RuntimeStatementHost,
  dispatch: RuntimeCallableDispatch,
  choices: readonly RuntimeValue[],
  argumentsList: readonly RuntimeValue[],
  context: RuntimeExecutionContext,
): RuntimeResult => {
  const invokeAt = (index: number): RuntimeResult => {
    const first = choices[index];
    const invokeFirst = (): RuntimeResult =>
      invokeCallableAlternative(host, dispatch, first, argumentsList, context) ??
      UNKNOWN_CALL_RESULT;
    const nextIndex = index + 1;
    if (nextIndex === choices.length) {
      return invokeFirst();
    }
    return host.branches(context, invokeFirst, (): RuntimeResult => invokeAt(nextIndex));
  };
  return invokeAt(0);
};

const invokeCallableChoices = (
  host: RuntimeStatementHost,
  dispatch: RuntimeCallableDispatch,
  calleeValue: RuntimeValue,
  argumentsList: readonly RuntimeValue[],
  context: RuntimeExecutionContext,
): RuntimeResult | undefined => {
  const choice = runtimeChoice(calleeValue);
  if (!choice) {
    return undefined;
  }
  return invokeCallableAlternatives(host, dispatch, choice.choices, argumentsList, context);
};

/**
 * Callable spelling, value, and optional ordinary method receiver.
 *
 * @internal
 */
export interface RuntimeCallableTarget {
  callee?: ASTNode;
  receiver?: RuntimeValue;
  value: RuntimeValue;
}

/**
 * Dispatch a callable or Function prototype wrapper, or decline an unknown callee.
 *
 * @internal
 */
export const invokeRuntimeCallable = (
  host: RuntimeStatementHost,
  target: RuntimeCallableTarget,
  argumentsList: readonly RuntimeValue[],
  context: RuntimeExecutionContext,
): RuntimeResult | undefined => {
  const dispatch: RuntimeCallableDispatch = {
    receiver: target.receiver,
    wrapper: runtimeCallableWrapper(target.callee),
  };
  const choiceResult = invokeCallableChoices(host, dispatch, target.value, argumentsList, context);
  if (choiceResult) {
    return choiceResult;
  }
  const callable =
    runtimeCallable(target.value) ?? runtimeCallableForNode(host, target.callee, context);
  if (callable) {
    return invokeCallable(host, dispatch, callable, argumentsList, context);
  }
  if (target.value === undefined) {
    return THROW_CALL_RESULT;
  }
  return undefined;
};
