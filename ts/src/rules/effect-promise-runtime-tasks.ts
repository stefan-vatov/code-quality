/* -------------------------------------------------------------------------- */
/*      Runtime task index adapter and isolated Promise task reporting.       */
/* -------------------------------------------------------------------------- */

import {
  restoreLexicalExecutionOffsets,
  restoreRuntimeLexicalValues,
  setLexicalExecutionOffsets,
  setRuntimeLexicalValues,
} from './effect-promise-value-scopes';
import type { ASTNode } from './effect-ast';
import type { HelperScopes } from './effect-promise-callable-types';
import type { NativeHelperFrame } from './effect-promise-program-traversal';
import type { PromiseVisitorKeys } from './effect-promise-execution-types';
import type { RuntimeExecution } from './effect-promise-runtime-model';
import type { RuntimeLexicalValue } from './effect-promise-value-scopes';
import type { RuntimeProof } from './effect-promise-runtime-proof';
import type { ScopeStack } from './effect-ast-scope';
import { helperScopesForNativeFrame } from './effect-promise-program-traversal';
import { interpretPromiseRuntime } from './effect-promise-runtime-interpreter';
import { runtimeProofWitness } from './effect-promise-runtime-proof';

/**
 * Indexed Effect.sync tasks and the Effect.runSync calls that execute them.
 *
 * @internal
 */
export interface PromiseRuntimeTasks {
  deferredSyncCalls: WeakSet<object>;
  executionSiteBySyncCall: WeakMap<object, PromiseTaskExecutionSite>;
  proofsBySyncCall: WeakMap<object, RuntimeTaskProof[]>;
}

interface RuntimeTaskProof {
  proof: RuntimeProof;
  syncCall: ASTNode;
}

/**
 * Lexical execution provenance captured where an Effect.sync task is declared.
 *
 * @internal
 */
export interface PromiseTaskExecutionSite {
  frame?: NativeHelperFrame;
  helperScopes: HelperScopes;
  scopes: ScopeStack;
}

type EffectCallPredicate = (node: ASTNode) => boolean;
interface RuntimeCallPredicates {
  isEffectCall: EffectCallPredicate;
  isObjectAssignCall: EffectCallPredicate;
}
type EvaluateTask = (
  syncCall: ASTNode,
  site: PromiseTaskExecutionSite,
  helperScopes: HelperScopes,
) => boolean;

const noRuntimeCall: EffectCallPredicate = (): boolean => false;

const effectCallPredicate = (
  predicates: EffectCallPredicate | RuntimeCallPredicates,
): EffectCallPredicate => {
  if (typeof predicates === 'function') {
    return predicates;
  }
  return predicates.isEffectCall;
};

const objectAssignPredicate = (
  predicates: EffectCallPredicate | RuntimeCallPredicates,
): EffectCallPredicate => {
  if (typeof predicates === 'function') {
    return noRuntimeCall;
  }
  return predicates.isObjectAssignCall;
};

/**
 * One exact event satisfying a must-execute proof.
 *
 * @internal
 */
export interface RuntimeTaskMatch {
  helperScopes: HelperScopes;
  site: PromiseTaskExecutionSite;
  syncCall: ASTNode;
}

/**
 * Determine whether a sync declaration must be analyzed only at indexed run sites.
 *
 * @internal
 */
export const isDeferredPromiseSync = (
  tasks: PromiseRuntimeTasks | undefined,
  syncCall: ASTNode,
): boolean => tasks?.deferredSyncCalls.has(syncCall) ?? false;

/**
 * Capture the lexical site used to execute an indexed Effect.sync task.
 *
 * @internal
 */
export const recordPromiseTaskSite = (
  tasks: PromiseRuntimeTasks | undefined,
  syncCall: ASTNode,
  site: PromiseTaskExecutionSite,
): void => {
  if (!tasks?.deferredSyncCalls.has(syncCall)) {
    return;
  }
  const existing = tasks.executionSiteBySyncCall.get(syncCall);
  if (existing) {
    tasks.executionSiteBySyncCall.set(syncCall, {
      frame: site.frame ?? existing.frame,
      helperScopes: preferredHelperScopes(existing, site),
      scopes: preferredScopes(existing, site),
    });
    return;
  }
  tasks.executionSiteBySyncCall.set(syncCall, site);
};

const preferredHelperScopes = (
  existing: PromiseTaskExecutionSite,
  site: PromiseTaskExecutionSite,
): HelperScopes => {
  if (site.helperScopes.length > 0) {
    return site.helperScopes;
  }
  return existing.helperScopes;
};

const preferredScopes = (
  existing: PromiseTaskExecutionSite,
  site: PromiseTaskExecutionSite,
): ScopeStack => {
  if (existing.scopes.length > 0) {
    return existing.scopes;
  }
  return site.scopes;
};

const siteHelperScopes = (site: PromiseTaskExecutionSite): HelperScopes => {
  if (site.frame) {
    return helperScopesForNativeFrame(site.frame);
  }
  return site.helperScopes;
};

const remappedScope = (
  source: HelperScopes[number],
  execution: RuntimeExecution,
  targetScopes: HelperScopes,
): HelperScopes[number] => {
  const index = execution.task.helperScopes.indexOf(source);
  return targetScopes[index] ?? source;
};

const executionOffsets = (
  execution: RuntimeExecution,
  targetScopes: HelperScopes,
): ReadonlyMap<HelperScopes[number], number> =>
  new Map(
    [...execution.offsets].map(([scope, offset]): [HelperScopes[number], number] => [
      remappedScope(scope, execution, targetScopes),
      offset,
    ]),
  );

const executionValues = (
  execution: RuntimeExecution,
  targetScopes: HelperScopes,
): ReadonlyMap<HelperScopes[number], ReadonlyMap<string, RuntimeLexicalValue>> =>
  new Map(
    [...execution.values].map(
      ([scope, values]): [HelperScopes[number], ReadonlyMap<string, RuntimeLexicalValue>] => [
        remappedScope(scope, execution, targetScopes),
        values,
      ],
    ),
  );

const executeRuntimeTask = (
  execution: RuntimeExecution,
  site: PromiseTaskExecutionSite,
  evaluate: EvaluateTask,
): boolean => {
  const helperScopes = siteHelperScopes(site);
  const previousOffsets = setLexicalExecutionOffsets(executionOffsets(execution, helperScopes));
  const previousValues = setRuntimeLexicalValues(executionValues(execution, helperScopes));
  try {
    return evaluate(execution.syncCall, site, helperScopes);
  } finally {
    restoreRuntimeLexicalValues(previousValues);
    restoreLexicalExecutionOffsets(previousOffsets);
  }
};

/**
 * Execute indexed task analyses reached at this run syntax on every feasible path.
 *
 * @internal
 */
export const executePromiseRunCall = (
  tasks: PromiseRuntimeTasks | undefined,
  runCall: ASTNode,
  evaluate: EvaluateTask,
): readonly RuntimeTaskMatch[] => {
  const matches: RuntimeTaskMatch[] = [];
  for (const taskProof of tasks?.proofsBySyncCall.get(runCall) ?? []) {
    const match = runtimeTaskMatch(tasks, taskProof, evaluate);
    if (match) {
      matches.push(match);
    }
  }
  return matches;
};

const runtimeTaskMatch = (
  tasks: PromiseRuntimeTasks | undefined,
  taskProof: RuntimeTaskProof,
  evaluate: EvaluateTask,
): RuntimeTaskMatch | undefined => {
  const site = tasks?.executionSiteBySyncCall.get(taskProof.syncCall);
  if (!site) {
    return undefined;
  }
  const witness = runtimeProofWitness(taskProof.proof, (execution): boolean =>
    executeRuntimeTask(execution, site, evaluate),
  );
  if (!witness) {
    return undefined;
  }
  return {
    helperScopes: siteHelperScopes(site),
    site,
    syncCall: witness.execution.syncCall,
  };
};

const addProofAtSyncCall = (
  proofsBySyncCall: WeakMap<object, RuntimeTaskProof[]>,
  syncCall: ASTNode,
  proof: RuntimeProof,
): void => {
  const existing = proofsBySyncCall.get(syncCall);
  const taskProof = { proof, syncCall };
  if (existing) {
    existing.push(taskProof);
  } else {
    proofsBySyncCall.set(syncCall, [taskProof]);
  }
};

/**
 * Index task identities and retain only Effect.runSync executions common to all feasible paths.
 *
 * @internal
 */
export const indexPromiseRuntimeTasks = (
  program: ASTNode,
  isSyncCall: EffectCallPredicate,
  isRunSyncCall: EffectCallPredicate,
  visitorKeys?: PromiseVisitorKeys,
  predicates: EffectCallPredicate | RuntimeCallPredicates = noRuntimeCall,
): PromiseRuntimeTasks => {
  const interpretation = interpretPromiseRuntime(program, {
    isEffectCall: effectCallPredicate(predicates),
    isObjectAssignCall: objectAssignPredicate(predicates),
    isRunSyncCall,
    isSyncCall,
    visitorKeys,
  });
  const tasks: PromiseRuntimeTasks = {
    deferredSyncCalls: interpretation.deferredSyncCalls,
    executionSiteBySyncCall: new WeakMap(),
    proofsBySyncCall: new WeakMap(),
  };
  for (const site of interpretation.sites) {
    tasks.executionSiteBySyncCall.set(site.syncCall, {
      helperScopes: site.helperScopes,
      scopes: [],
    });
  }
  for (const [syncCall, proof] of interpretation.proofs) {
    addProofAtSyncCall(tasks.proofsBySyncCall, syncCall, proof);
  }
  return tasks;
};
