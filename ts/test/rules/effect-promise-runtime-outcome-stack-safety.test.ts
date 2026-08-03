import {
  RUNTIME_MAYBE_ABRUPT,
  RUNTIME_RETURN,
  snapshotRuntimeState,
  unknownRuntimeValue,
} from '../../src/rules/effect-promise-runtime-model';
import type {
  RuntimeExecutionContext,
  RuntimeOutcome,
  RuntimeResult,
  RuntimeState,
  RuntimeStatementHost,
} from '../../src/rules/effect-promise-runtime-model';
import { describe, expect, it } from 'vitest';
import type { ASTNode } from '../../src/rules/effect-ast';
import { RuntimeProofFactory } from '../../src/rules/effect-promise-runtime-proof';
import { executeRuntimeStatementSequence } from '../../src/rules/effect-promise-runtime-statement-sequence';

describe('runtime outcome continuation semantics', (): void => {
  it('skips a sparse outcome hole before a later decisive return', (): void => {
    const state: RuntimeState = {
      choiceMembers: new Map(),
      factory: new RuntimeProofFactory(),
      heap: new Map(),
      proofs: new Map(),
      scopes: new Set(),
    };
    const host = { state } as RuntimeStatementHost;
    const context: RuntimeExecutionContext = {
      helperScopes: [],
      offsets: new Map(),
      runtimeScopes: [],
      taskScopes: [],
    };
    const lateValue: ASTNode = { type: 'Literal', value: 'late' };
    const lateOutcome: RuntimeOutcome = {
      completion: RUNTIME_RETURN,
      state: snapshotRuntimeState(state, []),
      value: lateValue,
    };
    const outcomes: RuntimeOutcome[] = [];
    outcomes.length = 2;
    outcomes[1] = lateOutcome;

    const result = executeRuntimeStatementSequence(
      host,
      [{ type: 'ExpressionStatement' }],
      context,
      0,
      (): RuntimeResult => ({
        completion: RUNTIME_MAYBE_ABRUPT,
        outcomes,
        value: unknownRuntimeValue,
      }),
    );

    expect({
      completion: result.completion,
      outcomes: result.outcomes?.map(({ value }) => value),
      value: result.value,
    }).toEqual({ completion: RUNTIME_RETURN, outcomes: [lateValue], value: lateValue });
  });
});
