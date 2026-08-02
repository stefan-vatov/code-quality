import {
  type PendingYield,
  type YieldableErrorScanState,
  indexPendingYields,
  scanYieldableErrorAST,
} from '../../src/rules/effect-prefer-yieldable-error-over-fail-ast';
import { describe, expect, it } from 'vitest';
import type { ASTNode } from '../../src/rules/effect-ast';

const CANDIDATE_COUNT = 100_000;
const CLASS_NAME = 'NotFound';

interface LargeASTFixture {
  generator: ASTNode;
  hostCall: ASTNode;
  program: ASTNode;
  yieldExpressions: readonly ASTNode[];
}

const createState = (pendingYields: PendingYield[]): YieldableErrorScanState => ({
  eligibleClasses: new Set([CLASS_NAME]),
  indexedYields: new WeakMap<object, ASTNode>(),
  pendingYields,
  scannedHostCallbacks: new WeakSet<object>(),
  unsafeClasses: new Set(),
});

const createLargeASTFixture = (): LargeASTFixture => {
  const yieldExpressions = Array.from(
    { length: CANDIDATE_COUNT },
    (): ASTNode => ({ type: 'YieldExpression' }),
  );
  const generator: ASTNode = {
    body: { body: yieldExpressions, type: 'BlockStatement' },
    generator: true,
    type: 'FunctionExpression',
  };
  const hostCall: ASTNode = {
    arguments: [generator],
    callee: { name: 'gen', type: 'Identifier' },
    type: 'CallExpression',
  };

  return {
    generator,
    hostCall,
    program: { body: [hostCall], type: 'Program' },
    yieldExpressions,
  };
};

describe('yieldable error pending-yield retention', (): void => {
  it('indexes a large AST and releases finalized candidate references', (): void => {
    const { generator, hostCall, program, yieldExpressions } = createLargeASTFixture();
    const callee: ASTNode = { type: 'CallExpression' };
    const state = createState([]);

    scanYieldableErrorAST(program, state, {
      hostGenerator: (node: ASTNode): ASTNode | undefined => {
        if (node === hostCall) {
          return generator;
        }
        return undefined;
      },
      mutationName: (): string | undefined => undefined,
      pendingYield: (node: ASTNode): PendingYield => [node, callee, CLASS_NAME],
    });

    expect(state.pendingYields).toHaveLength(CANDIDATE_COUNT);

    indexPendingYields(state);

    const indexedCount = yieldExpressions.filter((yieldExpression) =>
      state.indexedYields.has(yieldExpression),
    ).length;
    expect(indexedCount).toBe(CANDIDATE_COUNT);
    expect(state.pendingYields).toHaveLength(0);
  });
});
