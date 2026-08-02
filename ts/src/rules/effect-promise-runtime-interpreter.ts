/* -------------------------------------------------------------------------- */
/*          Must-execute interpreter for deferred Effect.sync tasks.          */
/* -------------------------------------------------------------------------- */

import type { FunctionBinding, HelperScopes } from './effect-promise-callable-types';
import {
  RUNTIME_NONTERMINATING,
  RUNTIME_NORMAL,
  RUNTIME_RETURN,
  runtimeOffsetsAt,
  sameRuntimeSnapshotValues,
  snapshotRuntimeStore,
} from './effect-promise-runtime-model';
import type {
  RuntimeCallableValue,
  RuntimeExecutionContext,
  RuntimeOutcome,
  RuntimeResult,
  RuntimeScope,
  RuntimeState,
  RuntimeStatementHost,
  RuntimeStoreSnapshot,
  RuntimeValue,
} from './effect-promise-runtime-model';
import { allocateRuntimeObject, writeRuntimeMember } from './effect-promise-runtime-heap';
import {
  captureRuntimeProofFragment,
  isRuntimeMemoSafe,
  isolateRuntimeProofs,
  mergeRuntimeProofFragment,
  restoreRuntimeProofs,
} from './effect-promise-runtime-memo';
import { childNode, childNodes } from './effect-ast';
import {
  executeOptionalRuntimeChild,
  executeRuntimeBranches,
  executeRuntimeExpression,
} from './effect-promise-runtime-expressions';
import {
  executeRuntimeContainer,
  executeRuntimeStatement,
} from './effect-promise-runtime-statements';
import type { ASTNode } from './effect-ast';
import type { PromiseVisitorKeys } from './effect-promise-execution-types';
import type { RuntimeProof } from './effect-promise-runtime-proof';
import { RuntimeProofFactory } from './effect-promise-runtime-proof';
import type { RuntimeProofFragment } from './effect-promise-runtime-memo';
import { bindRuntimePattern } from './effect-promise-runtime-patterns';
import { functionHeaderScopes } from './effect-promise-callables';
import { runtimeResultFromOutcomes } from './effect-promise-runtime-control-completions';

type EffectCallPredicate = (node: ASTNode) => boolean;

/**
 * Runtime declaration site materialized by the adapter after indexing.
 *
 * @internal
 */
export interface IndexedRuntimeSite {
  helperScopes: HelperScopes;
  syncCall: ASTNode;
}

/**
 * Output of one demand-gated runtime interpretation.
 *
 * @internal
 */
export interface RuntimeInterpretation {
  deferredSyncCalls: WeakSet<object>;
  proofs: ReadonlyMap<ASTNode, RuntimeProof>;
  sites: readonly IndexedRuntimeSite[];
}

interface InterpreterInput {
  isEffectCall: EffectCallPredicate;
  isObjectAssignCall: EffectCallPredicate;
  isRunSyncCall: EffectCallPredicate;
  isSyncCall: EffectCallPredicate;
  visitorKeys?: PromiseVisitorKeys;
}

interface InvocationFrame {
  argumentsList: readonly RuntimeValue[];
  callable: RuntimeCallableValue;
  before: RuntimeStoreSnapshot;
}

interface MemoEntry extends InvocationFrame {
  fragment: RuntimeProofFragment;
  result: RuntimeResult;
}

interface PreparedInvocation {
  context: RuntimeExecutionContext;
  result: RuntimeResult;
}

const NORMAL_RESULT: RuntimeResult = { completion: RUNTIME_NORMAL, value: undefined };
const NONTERMINATING_RESULT: RuntimeResult = {
  completion: RUNTIME_NONTERMINATING,
  value: undefined,
};

const callerOutcome = (outcome: RuntimeOutcome): RuntimeOutcome => {
  if (outcome.completion === RUNTIME_RETURN) {
    return { ...outcome, completion: RUNTIME_NORMAL };
  }
  return outcome;
};

const callerResult = (result: RuntimeResult): RuntimeResult => {
  if (result.outcomes) {
    return runtimeResultFromOutcomes(result.outcomes.map(callerOutcome));
  }
  if (result.completion === RUNTIME_RETURN) {
    return { completion: RUNTIME_NORMAL, value: result.value };
  }
  return result;
};

const sameValue = (left: RuntimeValue, right: RuntimeValue): boolean => left === right;

const sameArguments = (left: readonly RuntimeValue[], right: readonly RuntimeValue[]): boolean => {
  if (left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    if (!sameValue(left[index], right[index])) {
      return false;
    }
  }
  return true;
};

const sameCallable = (left: RuntimeCallableValue, right: RuntimeCallableValue): boolean =>
  left.binding.node === right.binding.node &&
  sameValue(left.boundThis, right.boundThis) &&
  sameArguments(left.boundArguments, right.boundArguments) &&
  left.scopes.length === right.scopes.length &&
  left.scopes.every((scope, index): boolean => scope === right.scopes[index]);

class RuntimeInterpreter implements RuntimeStatementHost {
  readonly active: InvocationFrame[] = [];

  readonly captures = new WeakMap<object, readonly RuntimeScope[]>();

  readonly completed = new WeakMap<object, MemoEntry[]>();

  readonly deferredSyncCalls = new WeakSet();

  readonly input: InterpreterInput;

  readonly sites: IndexedRuntimeSite[] = [];

  readonly state: RuntimeState = {
    choiceMembers: new Map(),
    factory: new RuntimeProofFactory(),
    heap: new Map(),
    proofs: new Map(),
    scopes: new Set(),
  };

  constructor(input: InterpreterInput) {
    this.input = input;
  }

  valueContext(context: RuntimeExecutionContext): {
    helperScopes: HelperScopes;
    isEffectCall: EffectCallPredicate;
    isSyncCall: EffectCallPredicate;
    scopes: readonly RuntimeScope[];
    state: RuntimeState;
    thisValue?: RuntimeValue;
  } {
    return {
      helperScopes: context.helperScopes,
      isEffectCall: this.input.isEffectCall,
      isSyncCall: this.input.isSyncCall,
      scopes: context.taskScopes,
      state: this.state,
      thisValue: context.thisValue,
    };
  }

  visit(node: ASTNode, context: RuntimeExecutionContext): RuntimeResult {
    return executeRuntimeExpression(this, node, context);
  }

  optionalChild(node: ASTNode, key: string, context: RuntimeExecutionContext): RuntimeResult {
    return executeOptionalRuntimeChild(this, node, key, context);
  }

  branches(
    context: RuntimeExecutionContext,
    leftExecution: () => RuntimeResult,
    rightExecution: () => RuntimeResult,
  ): RuntimeResult {
    return executeRuntimeBranches(this, context, leftExecution, rightExecution);
  }

  invoke(
    callable: RuntimeCallableValue,
    argumentsList: readonly RuntimeValue[],
    context: RuntimeExecutionContext,
  ): RuntimeResult {
    const exactCallable = this.exactCallable(callable);
    const invocationArguments = [...exactCallable.boundArguments, ...argumentsList];
    return this.invokeExact(exactCallable, invocationArguments, context);
  }

  invokeExact(
    callable: RuntimeCallableValue,
    argumentsList: readonly RuntimeValue[],
    context: RuntimeExecutionContext,
  ): RuntimeResult {
    const visibleScopes = callable.scopes;
    const before = snapshotRuntimeStore(this.state, visibleScopes);
    if (
      this.active.some((frame): boolean =>
        this.sameInvocation(frame, callable, argumentsList, before),
      )
    ) {
      return NONTERMINATING_RESULT;
    }
    const memo = this.memoized(callable, argumentsList, before);
    if (memo) {
      mergeRuntimeProofFragment(this.state, memo.fragment);
      return memo.result;
    }
    return this.executeInvocation(callable, argumentsList, context, visibleScopes, before);
  }

  exactCallable(callable: RuntimeCallableValue): RuntimeCallableValue {
    if (callable.binding.node.type !== 'FunctionDeclaration') {
      return callable;
    }
    const scopes = this.captures.get(callable.binding.node);
    if (!scopes || scopes === callable.scopes) {
      return callable;
    }
    return { ...callable, scopes };
  }

  executeInvocation(
    callable: RuntimeCallableValue,
    argumentsList: readonly RuntimeValue[],
    context: RuntimeExecutionContext,
    visibleScopes: readonly RuntimeScope[],
    before: RuntimeStoreSnapshot,
  ): RuntimeResult {
    const frame = { argumentsList, before, callable };
    const existingScopes = new Set(this.state.scopes);
    const callerProofs = isolateRuntimeProofs(this.state);
    this.active.push(frame);
    const result = this.invokeActive(callable, argumentsList, context);
    this.active.pop();
    return this.completeInvocation(frame, result, visibleScopes, existingScopes, callerProofs);
  }

  completeInvocation(
    frame: InvocationFrame,
    result: RuntimeResult,
    visibleScopes: readonly RuntimeScope[],
    existingScopes: ReadonlySet<RuntimeScope>,
    callerProofs: RuntimeProofFragment,
  ): RuntimeResult {
    const after = snapshotRuntimeStore(this.state, visibleScopes);
    const fragment = captureRuntimeProofFragment(this.state);
    const localScopes = new Set(
      [...this.state.scopes].filter((scope): boolean => !existingScopes.has(scope)),
    );
    restoreRuntimeProofs(this.state, callerProofs);
    mergeRuntimeProofFragment(this.state, fragment);
    this.recordCompletedInvocation(frame, result, after, fragment, localScopes);
    return result;
  }

  recordCompletedInvocation(
    frame: InvocationFrame,
    result: RuntimeResult,
    after: RuntimeStoreSnapshot,
    fragment: RuntimeProofFragment,
    localScopes: ReadonlySet<RuntimeScope>,
  ): void {
    const { before, callable } = frame;
    const { binding } = callable;
    if (
      sameRuntimeSnapshotValues(before, after) &&
      isRuntimeMemoSafe(result, fragment, localScopes, before, this.state)
    ) {
      const entries = this.completed.get(binding.node);
      const entry = { ...frame, fragment, result };
      if (entries) {
        entries.push(entry);
      } else {
        this.completed.set(binding.node, [entry]);
      }
    }
  }

  sameInvocation(
    frame: InvocationFrame,
    callable: RuntimeCallableValue,
    argumentsList: readonly RuntimeValue[],
    before: RuntimeStoreSnapshot,
  ): boolean {
    return (
      sameCallable(frame.callable, callable) &&
      sameArguments(frame.argumentsList, argumentsList) &&
      sameRuntimeSnapshotValues(frame.before, before)
    );
  }

  memoized(
    callable: RuntimeCallableValue,
    argumentsList: readonly RuntimeValue[],
    before: RuntimeStoreSnapshot,
  ): MemoEntry | undefined {
    return this.completed
      .get(callable.binding.node)
      ?.find(
        (entry): boolean =>
          sameCallable(entry.callable, callable) &&
          sameArguments(entry.argumentsList, argumentsList) &&
          sameRuntimeSnapshotValues(entry.before, before),
      );
  }

  invokeActive(
    callable: RuntimeCallableValue,
    argumentsList: readonly RuntimeValue[],
    caller: RuntimeExecutionContext,
  ): RuntimeResult {
    const prepared = this.invocationContext(callable, argumentsList, caller);
    if (prepared.result.completion !== RUNTIME_NORMAL) {
      return prepared.result;
    }
    const { context } = prepared;
    const body = childNode(callable.binding.node, 'body');
    return callerResult(this.functionBody(body, context));
  }

  invocationContext(
    callable: RuntimeCallableValue,
    argumentsList: readonly RuntimeValue[],
    caller: RuntimeExecutionContext,
  ): PreparedInvocation {
    const { binding } = callable;
    const captured = callable.scopes;
    const helpers = functionHeaderScopes(binding.node, binding);
    const scopes = [...captured];
    const context: RuntimeExecutionContext = {
      currentOffset: caller.currentOffset,
      helperScopes: helpers,
      offsets: new Map(runtimeOffsetsAt(caller)),
      runtimeScopes: helpers.slice(binding.helperScopes.length),
      taskScopes: scopes,
      thisValue: callable.boundThis,
    };
    return {
      context,
      result: this.addParameterScope(binding, argumentsList, helpers, scopes, context),
    };
  }

  addParameterScope(
    binding: FunctionBinding,
    argumentsList: readonly RuntimeValue[],
    helpers: HelperScopes,
    scopes: RuntimeScope[],
    context: RuntimeExecutionContext,
  ): RuntimeResult {
    if (helpers.length <= binding.helperScopes.length) {
      return NORMAL_RESULT;
    }
    const scope: RuntimeScope = {
      helperScope: helpers[helpers.length - 1],
      values: new Map(),
    };
    this.state.scopes.add(scope);
    scopes.push(scope);
    return this.bindParameters(binding.node, argumentsList, scope, context);
  }

  functionBody(body: ASTNode | undefined, context: RuntimeExecutionContext): RuntimeResult {
    if (body?.type === 'BlockStatement') {
      return executeRuntimeContainer(this, body, context);
    }
    if (body) {
      return this.visit(body, context);
    }
    return NORMAL_RESULT;
  }

  bindParameters(
    functionNode: ASTNode,
    argumentsList: readonly RuntimeValue[],
    scope: RuntimeScope,
    context: RuntimeExecutionContext,
  ): RuntimeResult {
    const parameters = childNodes(functionNode, 'params');
    for (let index = 0; index < parameters.length; index += 1) {
      const parameter = parameters[index];
      const result = bindRuntimePattern(
        parameter,
        this.parameterValue(parameter, argumentsList, index),
        {
          evaluate: (node): RuntimeResult => this.visit(node, context),
          scope,
          state: this.state,
        },
      );
      if (result.completion !== RUNTIME_NORMAL) {
        return result;
      }
    }
    return NORMAL_RESULT;
  }

  parameterValue(
    parameter: ASTNode | undefined,
    argumentsList: readonly RuntimeValue[],
    index: number,
  ): RuntimeValue {
    if (parameter?.type !== 'RestElement') {
      return argumentsList[index];
    }
    const values = argumentsList.slice(index);
    const array = allocateRuntimeObject(this.state, true);
    array.arrayLength = values.length;
    for (let valueIndex = 0; valueIndex < values.length; valueIndex += 1) {
      writeRuntimeMember(this.state, array, String(valueIndex), values[valueIndex]);
    }
    return array;
  }

  statement(node: ASTNode, context: RuntimeExecutionContext): RuntimeResult {
    return executeRuntimeStatement(this, node, context);
  }
}

/**
 * Interpret one program and return must-execute task runs plus declaration sites.
 *
 * @internal
 */
export const interpretPromiseRuntime = (
  program: ASTNode,
  input: InterpreterInput,
): RuntimeInterpretation => {
  const interpreter = new RuntimeInterpreter(input);
  executeRuntimeContainer(interpreter, program, {
    helperScopes: [],
    offsets: new Map(),
    runtimeScopes: [],
    taskScopes: [],
  });
  for (const site of interpreter.sites) {
    interpreter.deferredSyncCalls.add(site.syncCall);
  }
  return {
    deferredSyncCalls: interpreter.deferredSyncCalls,
    proofs: interpreter.state.proofs,
    sites: interpreter.sites,
  };
};
