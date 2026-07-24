/* -------------------------------------------------------------------------- */
/*          Abstract state for the Effect runtime task interpreter.           */
/* -------------------------------------------------------------------------- */

import type { FunctionBinding, HelperScope, HelperScopes } from './effect-promise-callable-types';
import type { RuntimeProof, RuntimeProofFactory } from './effect-promise-runtime-proof';
import type { ASTNode } from './effect-ast';
import type { PromiseVisitorKeys } from './effect-promise-execution-types';
import type { RuntimeLexicalValue } from './effect-promise-value-scopes';
import { runtimeLexicalUnknown } from './effect-promise-value-scopes';

/**
 * Runtime execution completed normally.
 *
 * @internal
 */
export const RUNTIME_NORMAL = 0;
/**
 * Runtime execution returned from the current function.
 *
 * @internal
 */
export const RUNTIME_RETURN = 1;
/**
 * Runtime execution threw from the current function.
 *
 * @internal
 */
export const RUNTIME_THROW = 2;
/**
 * Runtime execution broke from the current loop or switch.
 *
 * @internal
 */
export const RUNTIME_BREAK = 3;
/**
 * Runtime execution cannot terminate for the current exact state.
 *
 * @internal
 */
export const RUNTIME_NONTERMINATING = 4;
/**
 * Runtime execution may stop before a following statement.
 *
 * @internal
 */
export const RUNTIME_MAYBE_ABRUPT = 5;
/**
 * Runtime execution continued the nearest loop.
 *
 * @internal
 */
export const RUNTIME_CONTINUE = 6;

/**
 * Completion produced by one runtime statement or expression.
 *
 * @internal
 */
export type RuntimeCompletion =
  | typeof RUNTIME_NORMAL
  | typeof RUNTIME_RETURN
  | typeof RUNTIME_THROW
  | typeof RUNTIME_BREAK
  | typeof RUNTIME_NONTERMINATING
  | typeof RUNTIME_MAYBE_ABRUPT
  | typeof RUNTIME_CONTINUE;

/**
 * Maximum correlated completion outcomes retained by one result.
 *
 * @internal
 */
export const RUNTIME_OUTCOME_CAP = 8;

/**
 * Context shared by runtime expression and statement evaluation.
 *
 * @internal
 */
export interface RuntimeExecutionContext {
  helperScopes: HelperScopes;
  offsets: Map<HelperScope, number>;
  runtimeScopes: readonly HelperScope[];
  taskScopes: readonly RuntimeScope[];
  thisValue?: RuntimeValue;
}

/**
 * One exact completion alternative and its transactional state.
 *
 * @internal
 */
export interface RuntimeOutcome {
  completion: Exclude<RuntimeCompletion, typeof RUNTIME_MAYBE_ABRUPT>;
  state: RuntimeSnapshot;
  target?: string;
  value: RuntimeValue;
}

/**
 * Completion and value produced by runtime evaluation.
 *
 * @internal
 */
export interface RuntimeResult {
  completion: RuntimeCompletion;
  outcomes?: readonly RuntimeOutcome[];
  target?: string;
  value: RuntimeValue;
}

/**
 * Capabilities supplied by expression and invocation evaluation.
 *
 * @internal
 */
export interface RuntimeStatementHost {
  captures: WeakMap<object, readonly RuntimeScope[]>;
  deferredSyncCalls: WeakSet<object>;
  input: {
    isEffectCall: (node: ASTNode) => boolean;
    isObjectAssignCall: (node: ASTNode) => boolean;
    isRunSyncCall: (node: ASTNode) => boolean;
    isSyncCall: (node: ASTNode) => boolean;
    visitorKeys?: PromiseVisitorKeys;
  };
  invoke: (
    callable: RuntimeCallableValue,
    argumentsList: readonly RuntimeValue[],
    context: RuntimeExecutionContext,
  ) => RuntimeResult;
  sites: { helperScopes: HelperScopes; syncCall: ASTNode }[];
  state: RuntimeState;
  branches: (
    context: RuntimeExecutionContext,
    left: () => RuntimeResult,
    right: () => RuntimeResult,
  ) => RuntimeResult;
  optionalChild: (node: ASTNode, key: string, context: RuntimeExecutionContext) => RuntimeResult;
  statement: (node: ASTNode, context: RuntimeExecutionContext) => RuntimeResult;
  valueContext: (context: RuntimeExecutionContext) => {
    helperScopes: HelperScopes;
    isEffectCall: (node: ASTNode) => boolean;
    isSyncCall: (node: ASTNode) => boolean;
    scopes: readonly RuntimeScope[];
    state: RuntimeState;
    thisValue?: RuntimeValue;
  };
  visit: (node: ASTNode, context: RuntimeExecutionContext) => RuntimeResult;
}

/**
 * Unknown runtime value after incompatible control-flow states join.
 *
 * @internal
 */
export const unknownRuntimeValue = Symbol('unknownRuntimeValue');
/**
 * Known non-task Effect or ordinary value that cannot select an indexed task.
 *
 * @internal
 */
export const safeRuntimeValue = Symbol('safeRuntimeValue');

/**
 * One exact indexed Effect.sync identity.
 *
 * @internal
 */
export interface RuntimeTaskValue {
  helperScopes: HelperScopes;
  kind: 'task';
  scopes: readonly RuntimeScope[];
  syncCall: ASTNode;
}

/**
 * One evaluated object or array identity stored in the runtime heap.
 *
 * @internal
 */
export interface RuntimeObjectRef {
  arrayLength?: number;
  identity: object;
  isArray: boolean;
  kind: 'object';
  source?: ASTNode;
}

/**
 * One evaluated callable instance with its exact captured environment.
 *
 * @internal
 */
export interface RuntimeCallableValue {
  binding: FunctionBinding;
  boundArguments: readonly RuntimeValue[];
  boundThis?: RuntimeValue;
  kind: 'callable';
  scopes: readonly RuntimeScope[];
}

/**
 * A bounded union of exact branch-created runtime identities.
 *
 * @internal
 */
export interface RuntimeChoiceValue {
  choices: readonly RuntimeValue[];
  kind: 'choice';
}

/**
 * Value understood by the runtime task interpreter.
 *
 * @internal
 */
export type RuntimeValue =
  | ASTNode
  | RuntimeCallableValue
  | RuntimeChoiceValue
  | RuntimeObjectRef
  | RuntimeTaskValue
  | typeof safeRuntimeValue
  | typeof unknownRuntimeValue
  | undefined;

/**
 * Mutable bindings owned by one exact lexical helper scope.
 *
 * @internal
 */
export interface RuntimeScope {
  helperScope: HelperScope;
  values: Map<string, RuntimeValue>;
}

/**
 * Exact dynamic state attached to one must-execute run.
 *
 * @internal
 */
export interface RuntimeExecution {
  call: ASTNode;
  offsets: ReadonlyMap<HelperScope, number>;
  syncCall: ASTNode;
  task: RuntimeTaskValue;
  values: ReadonlyMap<HelperScope, ReadonlyMap<string, RuntimeLexicalValue>>;
}

/**
 * Snapshot used to isolate speculative branches and completed calls.
 *
 * @internal
 */
export interface RuntimeSnapshot {
  choiceMembers: ReadonlyMap<RuntimeChoiceValue, ReadonlyMap<string, RuntimeValue>>;
  heap: ReadonlyMap<RuntimeObjectRef, ReadonlyMap<string, RuntimeValue>>;
  proofs: ReadonlyMap<ASTNode, RuntimeProof>;
  values: ReadonlyMap<RuntimeScope, ReadonlyMap<string, RuntimeValue>>;
}

/**
 * Store-only snapshot used by proof-detached invocation memoization.
 *
 * @internal
 */
export interface RuntimeStoreSnapshot {
  choiceMembers: ReadonlyMap<RuntimeChoiceValue, ReadonlyMap<string, RuntimeValue>>;
  heap: ReadonlyMap<RuntimeObjectRef, ReadonlyMap<string, RuntimeValue>>;
  values: ReadonlyMap<RuntimeScope, ReadonlyMap<string, RuntimeValue>>;
}

/**
 * Mutable interpreter state; speculative mutations are transactionally restored.
 *
 * @internal
 */
export interface RuntimeState {
  choiceMembers: Map<RuntimeChoiceValue, Map<string, RuntimeValue>>;
  factory: RuntimeProofFactory;
  heap: Map<RuntimeObjectRef, Map<string, RuntimeValue>>;
  proofs: Map<ASTNode, RuntimeProof>;
  scopes: Set<RuntimeScope>;
}

export {
  appendRuntimeExecution,
  joinRuntimeStates,
  restoreRuntimeState,
  sameRuntimeSnapshotProofs,
  sameRuntimeSnapshotValues,
  snapshotRuntimeState,
  snapshotRuntimeStore,
} from './effect-promise-runtime-store';

/**
 * Convert one runtime value to a lexical override consumed by Promise analysis.
 *
 * @internal
 */
export const runtimeLexicalValue = (value: RuntimeValue): RuntimeLexicalValue => {
  if (
    value &&
    typeof value !== 'symbol' &&
    'kind' in value &&
    value.kind === 'object' &&
    value.source
  ) {
    return value.source;
  }
  if (value === unknownRuntimeValue || value === safeRuntimeValue || (value && 'kind' in value)) {
    return runtimeLexicalUnknown;
  }
  return value;
};
