/* -------------------------------------------------------------------------- */
/*     Iterative statement sequencing for the Effect runtime interpreter.     */
/* -------------------------------------------------------------------------- */

import {
  RUNTIME_MAYBE_ABRUPT,
  RUNTIME_NORMAL,
  RUNTIME_OUTCOME_CAP,
  restoreRuntimeState,
  snapshotRuntimeState,
  unknownRuntimeValue,
} from './effect-promise-runtime-model';
import type {
  RuntimeExecutionContext,
  RuntimeOutcome,
  RuntimeResult,
  RuntimeSnapshot,
  RuntimeStatementHost,
} from './effect-promise-runtime-model';
import {
  joinRuntimeOutcomeStates,
  runtimeResultFromOutcomes,
  runtimeResultOutcomes,
} from './effect-promise-runtime-control-completions';
import type { ASTNode } from './effect-ast';
import { applyRuntimeScalarUpdate } from './effect-promise-runtime-control-scalars';

const NORMAL_RESULT: RuntimeResult = { completion: RUNTIME_NORMAL, value: undefined };

type RuntimeStatementExecutor = (
  host: RuntimeStatementHost,
  node: ASTNode,
  context: RuntimeExecutionContext,
) => RuntimeResult;

interface RuntimeSequenceTask {
  context: RuntimeExecutionContext;
  continuation: RuntimeSequenceContinuation | undefined;
  executeStatement: RuntimeStatementExecutor;
  host: RuntimeStatementHost;
  index: number;
  statements: readonly ASTNode[];
}

interface RuntimeSequenceContinuation {
  baseline: RuntimeSnapshot;
  outcomes: RuntimeOutcome[];
  sourceIndex: number;
  sourceOutcomes: readonly RuntimeOutcome[];
  task: RuntimeSequenceTask;
}

type RuntimeSequenceAction =
  | { continuation: RuntimeSequenceContinuation; kind: 'process' }
  | { continuation: RuntimeSequenceContinuation; kind: 'resume'; result: RuntimeResult }
  | { continuation: RuntimeSequenceContinuation | undefined; kind: 'result'; result: RuntimeResult }
  | { kind: 'run'; task: RuntimeSequenceTask };

const nodeOffset = (node: ASTNode): number => {
  const start: unknown = Reflect.get(node, 'start');
  if (typeof start === 'number') {
    return start;
  }
  return -1;
};

const updateRuntimeOffsets = (statement: ASTNode, context: RuntimeExecutionContext): void => {
  const offset = nodeOffset(statement);
  const runtimeContext = context;
  runtimeContext.currentOffset = offset;
};

const executeRuntimeStatementAt = (
  task: RuntimeSequenceTask,
  index: number,
): RuntimeResult | undefined => {
  const statement = task.statements[index];
  if (!statement) {
    return undefined;
  }
  updateRuntimeOffsets(statement, task.context);
  const result = task.executeStatement(task.host, statement, task.context);
  if (result.completion === RUNTIME_NORMAL && !result.outcomes) {
    applyRuntimeScalarUpdate(task.host, statement, task.context);
  }
  return result;
};

const createRuntimeSequenceContinuation = (
  task: RuntimeSequenceTask,
  result: RuntimeResult,
): RuntimeSequenceContinuation => ({
  baseline: snapshotRuntimeState(task.host.state, task.context.taskScopes),
  outcomes: [],
  sourceIndex: 0,
  sourceOutcomes: result.outcomes ?? [],
  task,
});

interface RuntimeSequenceRun {
  index: number;
  result: RuntimeResult | undefined;
}

const runRuntimeStatements = (task: RuntimeSequenceTask): RuntimeSequenceRun => {
  let { index } = task;
  let result: RuntimeResult | undefined = undefined;
  while (index < task.statements.length && !result) {
    const statementResult = executeRuntimeStatementAt(task, index);
    if (!statementResult) {
      result = NORMAL_RESULT;
    } else if (statementResult.completion === RUNTIME_NORMAL && !statementResult.outcomes) {
      index += 1;
    } else {
      result = statementResult;
    }
  }
  return { index, result };
};

const runRuntimeSequenceAction = (
  action: Extract<RuntimeSequenceAction, { kind: 'run' }>,
): readonly RuntimeSequenceAction[] => {
  const { task } = action;
  const execution = runRuntimeStatements(task);
  const result = execution.result ?? NORMAL_RESULT;
  if (result.outcomes) {
    const boundaryTask = { ...task, index: execution.index };
    return [
      {
        continuation: createRuntimeSequenceContinuation(boundaryTask, result),
        kind: 'process',
      },
    ];
  }
  return [{ continuation: task.continuation, kind: 'result', result }];
};

const completeRuntimeSequenceContinuation = (
  continuation: RuntimeSequenceContinuation,
): RuntimeResult => {
  joinRuntimeOutcomeStates(continuation.task.host, continuation.baseline, continuation.outcomes);
  if (continuation.outcomes.length > RUNTIME_OUTCOME_CAP) {
    return { completion: RUNTIME_MAYBE_ABRUPT, value: unknownRuntimeValue };
  }
  return runtimeResultFromOutcomes(continuation.outcomes);
};

const nextRuntimeOutcomeIndex = (
  sourceOutcomes: readonly RuntimeOutcome[],
  sourceIndex: number,
): number => {
  let nextIndex = sourceIndex;
  while (nextIndex < sourceOutcomes.length && !(nextIndex in sourceOutcomes)) {
    nextIndex += 1;
  }
  return nextIndex;
};

const processRuntimeSequenceAction = (
  action: Extract<RuntimeSequenceAction, { kind: 'process' }>,
): readonly RuntimeSequenceAction[] => {
  const { continuation } = action;
  const outcome =
    continuation.sourceOutcomes[
      (continuation.sourceIndex = nextRuntimeOutcomeIndex(
        continuation.sourceOutcomes,
        continuation.sourceIndex,
      ))
    ];
  if (!outcome) {
    return [
      {
        continuation: continuation.task.continuation,
        kind: 'result',
        result: completeRuntimeSequenceContinuation(continuation),
      },
    ];
  }
  continuation.sourceIndex += 1;
  if (outcome.completion !== RUNTIME_NORMAL) {
    continuation.outcomes.push(outcome);
    return [{ continuation, kind: 'process' }];
  }
  restoreRuntimeState(continuation.task.host.state, outcome.state);
  return [
    {
      kind: 'run',
      task: { ...continuation.task, continuation, index: continuation.task.index + 1 },
    },
  ];
};

const resumeRuntimeSequenceAction = (
  action: Extract<RuntimeSequenceAction, { kind: 'resume' }>,
): readonly RuntimeSequenceAction[] => {
  const { continuation } = action;
  const state = snapshotRuntimeState(
    continuation.task.host.state,
    continuation.task.context.taskScopes,
  );
  continuation.outcomes.push(...runtimeResultOutcomes(action.result, state));
  return [{ continuation, kind: 'process' }];
};

const executeRuntimeSequenceAction = (
  action: RuntimeSequenceAction,
): readonly RuntimeSequenceAction[] => {
  if (action.kind === 'run') {
    return runRuntimeSequenceAction(action);
  }
  if (action.kind === 'process') {
    return processRuntimeSequenceAction(action);
  }
  if (action.kind === 'resume') {
    return resumeRuntimeSequenceAction(action);
  }
  if (action.continuation) {
    return [{ continuation: action.continuation, kind: 'resume', result: action.result }];
  }
  return [];
};

/**
 * Execute a statement sequence without growing the JavaScript call stack per source statement.
 *
 * @internal
 */
export const executeRuntimeStatementSequence = (
  host: RuntimeStatementHost,
  statements: readonly ASTNode[],
  context: RuntimeExecutionContext,
  index: number,
  executeStatement: RuntimeStatementExecutor,
): RuntimeResult => {
  const actions: RuntimeSequenceAction[] = [
    {
      kind: 'run',
      task: { context, continuation: undefined, executeStatement, host, index, statements },
    },
  ];
  let finalResult = NORMAL_RESULT;
  while (actions.length > 0) {
    const action = actions.pop();
    if (action) {
      if (action.kind === 'result' && !action.continuation) {
        finalResult = action.result;
      }
      actions.push(...executeRuntimeSequenceAction(action));
    }
  }
  return finalResult;
};
