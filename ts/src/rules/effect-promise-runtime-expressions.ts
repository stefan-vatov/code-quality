/* -------------------------------------------------------------------------- */
/*     Expression flow for the Effect runtime task abstract interpreter.      */
/* -------------------------------------------------------------------------- */

import {
  RUNTIME_MAYBE_ABRUPT,
  RUNTIME_NORMAL,
  RUNTIME_THROW,
  appendRuntimeExecution,
  runtimeLexicalValue,
  safeRuntimeValue,
  unknownRuntimeValue,
} from './effect-promise-runtime-model';
import type {
  RuntimeExecutionContext,
  RuntimeResult,
  RuntimeScope,
  RuntimeStatementHost,
  RuntimeTaskValue,
  RuntimeValue,
} from './effect-promise-runtime-model';
import { asNode, childNode } from './effect-ast';
import {
  executeRuntimeAssignment,
  executeRuntimeDeletion,
} from './effect-promise-runtime-mutations';
import {
  executeRuntimeObjectDefineProperty,
  isRuntimeObjectDefinePropertyCall,
} from './effect-promise-runtime-intrinsics';
import { invokeRuntimeCallable, runtimeCallableForNode } from './effect-promise-runtime-callables';
import {
  runtimeObjectAlternatives,
  spreadRuntimeChoiceMembers,
} from './effect-promise-runtime-choice-operations';
import { runtimeTruthiness, runtimeValue } from './effect-promise-runtime-values';
import type { ASTNode } from './effect-ast';
import type { HelperScope } from './effect-promise-callable-types';
import type { RuntimeCallableTarget } from './effect-promise-runtime-callables';
import { evaluateRuntimeArguments } from './effect-promise-runtime-arguments';
import { evaluateRuntimeCallTarget } from './effect-promise-runtime-call-targets';
import { executeRuntimeBranchSequence } from './effect-promise-runtime-control-branches';
import { executeRuntimeMember } from './effect-promise-runtime-members';
import { runtimeChoice } from './effect-promise-runtime-choice';
import { runtimeStructure } from './effect-promise-runtime-structures';
import { unwrappedExpression } from './effect-boundary-ast-shared';

export type RuntimeExpressionHost = RuntimeStatementHost;
const NORMAL_RESULT: RuntimeResult = { completion: RUNTIME_NORMAL, value: undefined };

const lexicalValues = (
  scopes: readonly RuntimeScope[],
): Map<HelperScope, ReadonlyMap<string, ReturnType<typeof runtimeLexicalValue>>> => {
  const values = new Map<
    HelperScope,
    ReadonlyMap<string, ReturnType<typeof runtimeLexicalValue>>
  >();
  for (const scope of scopes) {
    values.set(
      scope.helperScope,
      new Map(
        [...scope.values].map(
          ([name, runtime]): [string, ReturnType<typeof runtimeLexicalValue>] => [
            name,
            runtimeLexicalValue(runtime),
          ],
        ),
      ),
    );
  }
  return values;
};

const directValue = (
  host: RuntimeExpressionHost,
  node: ASTNode,
  context: RuntimeExecutionContext,
): RuntimeResult | undefined => {
  if (host.input.isSyncCall(node)) {
    return {
      completion: RUNTIME_NORMAL,
      value: {
        helperScopes: context.helperScopes,
        kind: 'task',
        scopes: context.taskScopes,
        syncCall: node,
      },
    };
  }
  if (
    node.type === 'ArrowFunctionExpression' ||
    node.type === 'FunctionExpression' ||
    node.type === 'FunctionDeclaration'
  ) {
    return {
      completion: RUNTIME_NORMAL,
      value: runtimeCallableForNode(host, node, context) ?? unknownRuntimeValue,
    };
  }
  return runtimeStructure(host, node, context);
};

const childValue = (
  host: RuntimeExpressionHost,
  value: unknown,
  context: RuntimeExecutionContext,
): RuntimeResult => {
  if (Array.isArray(value)) {
    for (const item of value) {
      const result = childValue(host, item, context);
      if (result.completion !== RUNTIME_NORMAL) {
        return result;
      }
    }
    return NORMAL_RESULT;
  }
  const node = asNode(value);
  if (node) {
    return executeRuntimeExpression(host, node, context);
  }
  return NORMAL_RESULT;
};

const childKey = (
  host: RuntimeExpressionHost,
  node: ASTNode,
  key: string,
  context: RuntimeExecutionContext,
): RuntimeResult => {
  if (key === 'parent') {
    return NORMAL_RESULT;
  }
  return childValue(host, Reflect.get(node, key), context);
};

const children = (
  host: RuntimeExpressionHost,
  node: ASTNode,
  context: RuntimeExecutionContext,
): RuntimeResult => {
  for (const key of host.input.visitorKeys?.[node.type] ?? Object.keys(node)) {
    const result = childKey(host, node, key, context);
    if (result.completion !== RUNTIME_NORMAL) {
      return result;
    }
  }
  return {
    completion: RUNTIME_NORMAL,
    value: runtimeValue(node, host.valueContext(context)),
  };
};

/**
 * Execute an optional child expression.
 *
 * @internal
 */
export const executeOptionalRuntimeChild = (
  host: RuntimeExpressionHost,
  node: ASTNode,
  key: string,
  context: RuntimeExecutionContext,
): RuntimeResult => {
  const child = childNode(node, key);
  if (child) {
    return executeRuntimeExpression(host, child, context);
  }
  return NORMAL_RESULT;
};

/**
 * Join two feasible expression executions transactionally.
 *
 * @internal
 */
export const executeRuntimeBranches = (
  host: RuntimeExpressionHost,
  context: RuntimeExecutionContext,
  leftExecution: () => RuntimeResult,
  rightExecution: () => RuntimeResult,
): RuntimeResult => executeRuntimeBranchSequence(host, [leftExecution, rightExecution], context);

const shouldSkipLogical = (operator: unknown, known: boolean | undefined): boolean =>
  (operator === '&&' && known === false) || (operator === '||' && known === true);

const logical = (
  host: RuntimeExpressionHost,
  node: ASTNode,
  context: RuntimeExecutionContext,
): RuntimeResult => {
  const left = executeOptionalRuntimeChild(host, node, 'left', context);
  if (left.completion !== RUNTIME_NORMAL) {
    return left;
  }
  const known = runtimeTruthiness(left.value, host.valueContext(context));
  if (shouldSkipLogical(Reflect.get(node, 'operator'), known)) {
    return left;
  }
  if (known !== undefined) {
    return executeOptionalRuntimeChild(host, node, 'right', context);
  }
  return executeRuntimeBranches(
    host,
    context,
    (): RuntimeResult => left,
    (): RuntimeResult => executeOptionalRuntimeChild(host, node, 'right', context),
  );
};

const conditional = (
  host: RuntimeExpressionHost,
  node: ASTNode,
  context: RuntimeExecutionContext,
): RuntimeResult => {
  const test = executeOptionalRuntimeChild(host, node, 'test', context);
  if (test.completion !== RUNTIME_NORMAL) {
    return test;
  }
  const known = runtimeTruthiness(test.value, host.valueContext(context));
  if (known === true) {
    return executeOptionalRuntimeChild(host, node, 'consequent', context);
  }
  if (known === false) {
    return executeOptionalRuntimeChild(host, node, 'alternate', context);
  }
  return executeRuntimeBranches(
    host,
    context,
    (): RuntimeResult => executeOptionalRuntimeChild(host, node, 'consequent', context),
    (): RuntimeResult => executeOptionalRuntimeChild(host, node, 'alternate', context),
  );
};

const runTask = (
  host: RuntimeExpressionHost,
  node: ASTNode,
  value: RuntimeValue,
  context: RuntimeExecutionContext,
): RuntimeResult => {
  const choice = runtimeChoice(value);
  if (choice) {
    return runTaskChoices(host, node, choice.choices, context);
  }
  const task = runtimeTask(value);
  if (!task) {
    return nonTaskRunResult(value);
  }
  host.deferredSyncCalls.add(task.syncCall);
  appendRuntimeExecution(host.state, {
    call: node,
    offsets: new Map(context.offsets),
    syncCall: task.syncCall,
    task,
    values: lexicalValues(task.scopes),
  });
  return NORMAL_RESULT;
};

const runtimeTask = (value: RuntimeValue): RuntimeTaskValue | undefined => {
  if (value && typeof value !== 'symbol' && 'kind' in value && value.kind === 'task') {
    return value;
  }
  return undefined;
};

const nonTaskRunResult = (value: RuntimeValue): RuntimeResult => {
  if (value === safeRuntimeValue) {
    return NORMAL_RESULT;
  }
  if (value === unknownRuntimeValue) {
    return { completion: RUNTIME_MAYBE_ABRUPT, value: unknownRuntimeValue };
  }
  return { completion: RUNTIME_THROW, value: undefined };
};

const runTaskChoices = (
  host: RuntimeExpressionHost,
  node: ASTNode,
  choices: readonly RuntimeValue[],
  context: RuntimeExecutionContext,
): RuntimeResult => {
  if (choices.length === 0) {
    return NORMAL_RESULT;
  }
  const [first, ...remaining] = choices;
  if (remaining.length === 0) {
    return runTask(host, node, first, context);
  }
  return host.branches(
    context,
    (): RuntimeResult => runTask(host, node, first, context),
    (): RuntimeResult => runTaskChoices(host, node, remaining, context),
  );
};

interface RuntimeCall {
  argumentsList: readonly RuntimeValue[];
  node: ASTNode;
  target: RuntimeCallableTarget;
}

const dispatchCall = (
  host: RuntimeExpressionHost,
  call: RuntimeCall,
  context: RuntimeExecutionContext,
): RuntimeResult => {
  if (host.input.isRunSyncCall(call.node)) {
    return runTask(host, call.node, call.argumentsList[0], context);
  }
  if (host.input.isObjectAssignCall(call.node)) {
    return objectAssign(host, call.argumentsList);
  }
  if (isRuntimeObjectDefinePropertyCall(call.node, context)) {
    return executeRuntimeObjectDefineProperty(host, call.argumentsList, context);
  }
  const result = invokeRuntimeCallable(host, call.target, call.argumentsList, context);
  if (result) {
    return result;
  }
  return {
    completion: RUNTIME_NORMAL,
    value: runtimeValue(call.node, host.valueContext(context)),
  };
};

const objectAssign = (
  host: RuntimeExpressionHost,
  argumentsList: readonly RuntimeValue[],
): RuntimeResult => {
  const [target, ...sources] = argumentsList;
  if (!runtimeObjectAlternatives(target)) {
    return { completion: RUNTIME_NORMAL, value: unknownRuntimeValue };
  }
  for (const source of sources) {
    spreadRuntimeChoiceMembers(host.state, source, target);
  }
  return { completion: RUNTIME_NORMAL, value: target };
};

const call = (
  host: RuntimeExpressionHost,
  node: ASTNode,
  context: RuntimeExecutionContext,
): RuntimeResult => {
  const callee = childNode(node, 'callee');
  const target = evaluateRuntimeCallTarget(
    host,
    callee,
    context,
    executeRuntimeExpression.bind(undefined, host),
  );
  if (target.completion !== RUNTIME_NORMAL || !target.target) {
    return { completion: target.completion, value: undefined };
  }
  const argumentsResult = evaluateRuntimeArguments(
    host,
    node,
    context,
    executeRuntimeExpression.bind(undefined, host),
  );
  if (argumentsResult.completion !== RUNTIME_NORMAL) {
    return { completion: argumentsResult.completion, value: undefined };
  }
  return dispatchCall(
    host,
    {
      argumentsList: argumentsResult.values,
      node,
      target: target.target,
    },
    context,
  );
};

const dispatchExpression = (
  host: RuntimeExpressionHost,
  node: ASTNode,
  context: RuntimeExecutionContext,
): RuntimeResult => {
  switch (node.type) {
    case 'LogicalExpression': {
      return logical(host, node, context);
    }
    case 'ConditionalExpression': {
      return conditional(host, node, context);
    }
    case 'AssignmentExpression': {
      return executeRuntimeAssignment(
        host,
        node,
        context,
        executeRuntimeExpression.bind(undefined, host),
      );
    }
    case 'MemberExpression': {
      return executeRuntimeMember(
        host,
        node,
        context,
        executeRuntimeExpression.bind(undefined, host),
      );
    }
    case 'UnaryExpression': {
      if (Reflect.get(node, 'operator') === 'delete') {
        return executeRuntimeDeletion(
          host,
          node,
          context,
          executeRuntimeExpression.bind(undefined, host),
        );
      }
      return children(host, node, context);
    }
    case 'CallExpression': {
      return call(host, node, context);
    }
    default: {
      return children(host, node, context);
    }
  }
};

/**
 * Execute one runtime expression with exact evaluation order.
 *
 * @internal
 */
export const executeRuntimeExpression = (
  host: RuntimeExpressionHost,
  node: ASTNode,
  context: RuntimeExecutionContext,
): RuntimeResult => {
  const direct = directValue(host, node, context);
  if (direct) {
    return direct;
  }
  const unwrapped = unwrappedExpression(node);
  if (unwrapped && unwrapped !== node) {
    return executeRuntimeExpression(host, unwrapped, context);
  }
  return dispatchExpression(host, node, context);
};
