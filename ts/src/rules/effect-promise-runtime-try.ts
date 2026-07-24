/* -------------------------------------------------------------------------- */
/*      Try, catch, and finally completion for the runtime interpreter.       */
/* -------------------------------------------------------------------------- */

import {
  RUNTIME_NONTERMINATING,
  RUNTIME_NORMAL,
  RUNTIME_THROW,
  restoreRuntimeState,
  snapshotRuntimeState,
  unknownRuntimeValue,
} from './effect-promise-runtime-model';
import type {
  RuntimeExecutionContext,
  RuntimeOutcome,
  RuntimeResult,
  RuntimeScope,
  RuntimeStatementHost,
} from './effect-promise-runtime-model';
import {
  bindCurrentRuntimePattern,
  predeclareRuntimePattern,
} from './effect-promise-runtime-control-patterns';
import {
  joinRuntimeOutcomeStates,
  runtimeResultFromOutcomes,
  runtimeResultOutcomes,
} from './effect-promise-runtime-control-completions';
import type { ASTNode } from './effect-ast';
import { NORMAL_RUNTIME_RESULT } from './effect-promise-runtime-control-branches';
import { childNode } from './effect-ast';

const executeOptionalStatement = (
  host: RuntimeStatementHost,
  node: ASTNode,
  key: string,
  context: RuntimeExecutionContext,
): RuntimeResult => {
  const statement = childNode(node, key);
  if (statement) {
    return host.statement(statement, context);
  }
  return NORMAL_RUNTIME_RESULT;
};

const catchContext = (
  host: RuntimeStatementHost,
  handler: ASTNode,
  context: RuntimeExecutionContext,
): RuntimeExecutionContext => {
  const helperScope = context.helperScopes[context.helperScopes.length - 1] ?? new Map();
  const scope: RuntimeScope = { helperScope, values: new Map() };
  host.state.scopes.add(scope);
  predeclareRuntimePattern(childNode(handler, 'param'), unknownRuntimeValue, scope);
  return { ...context, taskScopes: [...context.taskScopes, scope] };
};

const executeCatch = (
  host: RuntimeStatementHost,
  handler: ASTNode,
  outcome: RuntimeOutcome,
  context: RuntimeExecutionContext,
): readonly RuntimeOutcome[] => {
  if (outcome.completion !== RUNTIME_THROW) {
    return [outcome];
  }
  restoreRuntimeState(host.state, outcome.state);
  const caughtContext = catchContext(host, handler, context);
  const binding = bindCurrentRuntimePattern(
    host,
    childNode(handler, 'param'),
    outcome.value,
    caughtContext,
  );
  let result = binding;
  if (binding.completion === RUNTIME_NORMAL) {
    result = executeOptionalStatement(host, handler, 'body', caughtContext);
  }
  const state = snapshotRuntimeState(host.state, caughtContext.taskScopes);
  return runtimeResultOutcomes(result, state);
};

const caughtCompletion = (
  host: RuntimeStatementHost,
  node: ASTNode,
  result: RuntimeResult,
  context: RuntimeExecutionContext,
): RuntimeResult => {
  const handler = childNode(node, 'handler');
  if (!handler) {
    return result;
  }
  const baseline = snapshotRuntimeState(host.state, context.taskScopes);
  const attempted = runtimeResultOutcomes(result, baseline);
  if (attempted.length === 0) {
    return result;
  }
  const outcomes = attempted.flatMap((outcome): readonly RuntimeOutcome[] =>
    executeCatch(host, handler, outcome, context),
  );
  joinRuntimeOutcomeStates(host, baseline, outcomes);
  return runtimeResultFromOutcomes(outcomes);
};

const finalizerOutcome = (
  host: RuntimeStatementHost,
  finalizer: ASTNode,
  outcome: RuntimeOutcome,
  context: RuntimeExecutionContext,
): readonly RuntimeOutcome[] => {
  if (outcome.completion === RUNTIME_NONTERMINATING) {
    return [outcome];
  }
  restoreRuntimeState(host.state, outcome.state);
  const finalized = host.statement(finalizer, context);
  const state = snapshotRuntimeState(host.state, context.taskScopes);
  return runtimeResultOutcomes(finalized, state).map((finalOutcome): RuntimeOutcome => {
    if (finalOutcome.completion === RUNTIME_NORMAL) {
      return {
        completion: outcome.completion,
        state: finalOutcome.state,
        target: outcome.target,
        value: outcome.value,
      };
    }
    return finalOutcome;
  });
};

const finalizedCompletion = (
  host: RuntimeStatementHost,
  finalizer: ASTNode,
  result: RuntimeResult,
  context: RuntimeExecutionContext,
): RuntimeResult => {
  const baseline = snapshotRuntimeState(host.state, context.taskScopes);
  const settled = runtimeResultOutcomes(result, baseline);
  if (settled.length === 0) {
    return result;
  }
  const outcomes = settled.flatMap((outcome): readonly RuntimeOutcome[] =>
    finalizerOutcome(host, finalizer, outcome, context),
  );
  joinRuntimeOutcomeStates(host, baseline, outcomes);
  return runtimeResultFromOutcomes(outcomes);
};

/**
 * Execute try/catch/finally with ECMAScript abrupt-completion precedence.
 *
 * @internal
 */
export const executeRuntimeTry = (
  host: RuntimeStatementHost,
  node: ASTNode,
  context: RuntimeExecutionContext,
): RuntimeResult => {
  const attempted = executeOptionalStatement(host, node, 'block', context);
  const settled = caughtCompletion(host, node, attempted, context);
  const finalizer = childNode(node, 'finalizer');
  if (!finalizer) {
    return settled;
  }
  return finalizedCompletion(host, finalizer, settled, context);
};
