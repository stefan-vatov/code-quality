import {
  RuntimeProofFactory,
  runtimeFalseProof,
  runtimeProofWitness,
} from '../../src/rules/effect-promise-runtime-proof';
import { childNode, identifierName } from '../../src/rules/effect-ast';
import { describe, expect, it } from 'vitest';
import type { ASTNode } from '../../src/rules/effect-ast';
import type { RuntimeExecution } from '../../src/rules/effect-promise-runtime-model';
import type { RuntimeProof } from '../../src/rules/effect-promise-runtime-proof';
import { indexPromiseRuntimeTasks } from '../../src/rules/effect-promise-runtime-tasks';
import { parseSync } from 'oxc-parser';
import { runRule } from './effect-rule-test-utils';

interface ClosureMemoCase {
  execution: string;
  name: string;
  reports: 0 | 1;
}

interface RuntimeIndexMeasurement {
  depth: number;
  isDeferred: boolean;
  reports: number;
  work: number;
}

const ruleName = 'effect-no-sync-for-promise';
const sequentialEvidenceCount = 256;
const nestedProofDepth = 4_096;
const oneSidedBranchCount = 1_024;

const proofExecution = (identifier: number): RuntimeExecution => {
  const syncCall: ASTNode = { identifier, type: 'CallExpression' };
  return {
    call: syncCall,
    offsets: new Map(),
    syncCall,
    task: {
      helperScopes: [],
      kind: 'task',
      scopes: [],
      syncCall,
    },
    values: new Map(),
  };
};

const sequentialAnyProof = (
  count: number,
): {
  executions: readonly RuntimeExecution[];
  factory: RuntimeProofFactory;
  proof: RuntimeProof;
} => {
  const factory = new RuntimeProofFactory();
  const executions: RuntimeExecution[] = [];
  let proof = runtimeFalseProof;
  for (let index = 0; index < count; index += 1) {
    const execution = proofExecution(index);
    executions.push(execution);
    proof = factory.any(proof, factory.event(execution));
  }
  return { executions, factory, proof };
};

const compositeChildReferences = (factory: RuntimeProofFactory): number => {
  let references = 0;
  for (const proof of factory.nodes.values()) {
    if (proof.kind === 'all' || proof.kind === 'any') {
      references += proof.children.length;
    }
  }
  return references;
};

const deeplyNestedProof = (
  depth: number,
): {
  proof: RuntimeProof;
} => {
  const factory = new RuntimeProofFactory();
  const baseline = proofExecution(-1);
  let proof = factory.event(baseline);
  for (let index = 0; index < depth; index += 1) {
    const alternative = factory.event(proofExecution(index));
    const kind = ((): string => {
      if (index % 2 === 0) {
        return 'any';
      }
      return 'all';
    })();
    proof = factory.intern(kind, [proof, alternative]);
  }
  return { proof };
};

const sequentialHelperDiamondSource = (depth: number): string => {
  const helpers = ['function level0(): void { Effect.runSync(task); }'];
  for (let index = 1; index <= depth; index += 1) {
    helpers.push(
      `function level${index}(): void {\n` +
        `  level${index - 1}();\n` +
        `  level${index - 1}();\n` +
        '}',
    );
  }
  return `
    import { Effect } from "effect";
    const user = { id: 1 };
    type UserResult = typeof user | Promise<typeof user> | undefined;
    function load(value: UserResult = Promise.resolve(user)): UserResult {
      return value;
    }
    let supplied: UserResult = user;
    const task = Effect.sync(() => load(supplied));
    supplied = void 0;
    ${helpers.join('\n')}
    level${depth}();
  `;
};

const effectCallName = (node: ASTNode): string | undefined => {
  if (node.type !== 'CallExpression') {
    return undefined;
  }
  const callee = childNode(node, 'callee');
  if (callee?.type !== 'MemberExpression') {
    return undefined;
  }
  if (identifierName(childNode(callee, 'object')) !== 'Effect') {
    return undefined;
  }
  return identifierName(childNode(callee, 'property'));
};

const measureSequentialHelperDiamond = (depth: number): RuntimeIndexMeasurement => {
  const source = sequentialHelperDiamondSource(depth);
  const program = parseSync(`runtime-proof-memo-diamond-${depth}.ts`, source, {
    sourceType: 'module',
  }).program as ASTNode;
  let syncCall: ASTNode | undefined;
  let work = 0;
  const tasks = indexPromiseRuntimeTasks(
    program,
    (node): boolean => {
      work += 1;
      if (effectCallName(node) === 'sync') {
        syncCall = node;
        return true;
      }
      return false;
    },
    (node): boolean => {
      work += 1;
      return effectCallName(node) === 'runSync';
    },
  );
  return {
    depth,
    isDeferred: Boolean(syncCall && tasks.deferredSyncCalls.has(syncCall)),
    reports: runRule(ruleName, source).length,
    work,
  };
};

const sequentialHelperMeasurements = [4, 8, 12].map(measureSequentialHelperDiamond);
const sequentialHelperGrowthPairs = [
  {
    larger: sequentialHelperMeasurements[1],
    smaller: sequentialHelperMeasurements[0],
  },
  {
    larger: sequentialHelperMeasurements[2],
    smaller: sequentialHelperMeasurements[1],
  },
];

const closureMemoSource = (execution: string): string => `
  import { Effect } from "effect";
  const user = { id: 1 };
  type UserResult = typeof user | Promise<typeof user> | undefined;
  function load(value: UserResult = Promise.resolve(user)): UserResult {
    return value;
  }
  let supplied: UserResult = user;
  const task = Effect.sync(() => load(supplied));
  function make(value: Effect.Effect<UserResult>) {
    let captured = value;
    return (next?: Effect.Effect<UserResult>): UserResult => {
      if (next) {
        captured = next;
        return user;
      }
      return Effect.runSync(captured);
    };
  }
  supplied = void 0;
  function scenario(): void {
    ${execution}
  }
  scenario();
`;

const closureMemoCases: readonly ClosureMemoCase[] = [
  {
    execution: `
      const first = make(task);
      const second = make(task);
      first(Effect.succeed(user));
      second();
    `,
    name: 'keeps identical escaping closure factory invocations isolated after captured mutation',
    reports: 1,
  },
  {
    execution: `
      const first = make(task);
      const second = make(task);
      second(Effect.succeed(user));
      first();
    `,
    name: 'keeps the first escaping closure isolated when the second captured value mutates',
    reports: 1,
  },
  {
    execution: `
      const first = make(task);
      first(Effect.succeed(user));
      first();
    `,
    name: 'observes a safe mutation when the same captured closure instance runs',
    reports: 0,
  },
  {
    execution: `
      const first = make(task);
      const second = make(task);
      first(Effect.succeed(user));
      void second;
    `,
    name: 'does not report an unsafe escaping closure instance that never runs',
    reports: 0,
  },
  {
    execution: `
      const first = make(task);
      const second = make(Effect.succeed(user));
      first(Effect.succeed(user));
      second();
    `,
    name: 'keeps a separately constructed safe closure instance safe',
    reports: 0,
  },
];

describe('runtime proof normalization and scaling', (): void => {
  it('canonically interns commuted all and any operands', (): void => {
    const factory = new RuntimeProofFactory();
    const left = factory.event(proofExecution(1));
    const right = factory.event(proofExecution(2));

    expect.soft(factory.all(left, right) === factory.all(right, left)).toBe(true);
    expect.soft(factory.any(left, right) === factory.any(right, left)).toBe(true);
  });

  it('absorbs a shared proof from either side of an all-over-any branch', (): void => {
    const factory = new RuntimeProofFactory();
    const proof = factory.event(proofExecution(1));
    const evidence = factory.event(proofExecution(2));
    const choice = factory.any(proof, evidence);

    expect.soft(factory.all(choice, proof) === proof).toBe(true);
    expect.soft(factory.all(proof, choice) === proof).toBe(true);
  });

  it('absorbs a shared proof from either side of an any-over-all branch', (): void => {
    const factory = new RuntimeProofFactory();
    const proof = factory.event(proofExecution(1));
    const evidence = factory.event(proofExecution(2));
    const requirement = factory.all(proof, evidence);

    expect.soft(factory.any(requirement, proof) === proof).toBe(true);
    expect.soft(factory.any(proof, requirement) === proof).toBe(true);
  });

  it('preserves first and last qualifying witnesses in sequential evidence', (): void => {
    const { executions, proof } = sequentialAnyProof(sequentialEvidenceCount);
    const first = executions[0];
    const last = executions.at(-1);

    expect(first).toBeDefined();
    expect(last).toBeDefined();
    expect(runtimeProofWitness(proof, (execution): boolean => execution === first)?.execution).toBe(
      first,
    );
    expect(runtimeProofWitness(proof, (execution): boolean => execution === last)?.execution).toBe(
      last,
    );
  });

  it('keeps total sequential composite references linear', (): void => {
    const { factory } = sequentialAnyProof(sequentialEvidenceCount);

    expect(compositeChildReferences(factory)).toBeLessThanOrEqual(8 * sequentialEvidenceCount);
  });

  it('evaluates deeply nested one-sided branch proofs without overflowing the stack', (): void => {
    const { proof } = deeplyNestedProof(nestedProofDepth);

    expect(runtimeProofWitness(proof, (): boolean => true)).toBeDefined();
  });

  it('retains a baseline through many one-sided branch joins', (): void => {
    const factory = new RuntimeProofFactory();
    const baselineExecution = proofExecution(-1);
    const baseline = factory.event(baselineExecution);
    let proof = baseline;
    for (let index = 0; index < oneSidedBranchCount; index += 1) {
      const alternative = factory.event(proofExecution(index));
      proof = factory.all(factory.any(proof, alternative), proof);
    }

    expect(proof === baseline).toBe(true);
    expect(
      runtimeProofWitness(proof, (execution): boolean => execution === baselineExecution)
        ?.execution,
    ).toBe(baselineExecution);
  });
});

describe('runtime proof-fragment memo scaling', (): void => {
  it.each(sequentialHelperMeasurements)(
    'indexes a sequential helper diamond at depth $depth',
    ({ isDeferred, reports, work }): void => {
      expect(isDeferred).toBe(true);
      expect(reports).toBe(1);
      expect(work).toBeLessThan(1_000_000);
    },
  );

  it.each(sequentialHelperGrowthPairs)(
    'limits adjacent sequential helper-diamond growth',
    ({ larger, smaller }): void => {
      expect(larger).toBeDefined();
      expect(smaller).toBeDefined();
      if (!larger || !smaller) {
        return;
      }
      expect(larger.work / smaller.work).toBeLessThanOrEqual(3);
    },
  );
});

describe('runtime invocation memo isolation for escaping closures', (): void => {
  it.each(closureMemoCases)('$name', ({ execution, reports }): void => {
    const source = closureMemoSource(execution);

    expect(parseSync('runtime-proof-memo-scaling.ts', source).errors).toHaveLength(0);
    expect(runRule(ruleName, source)).toHaveLength(reports);
  });
});
