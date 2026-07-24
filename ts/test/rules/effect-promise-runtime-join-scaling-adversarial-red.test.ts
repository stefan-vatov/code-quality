import { childNode, identifierName } from '../../src/rules/effect-ast';
import { describe, expect, it } from 'vitest';
import type { ASTNode } from '../../src/rules/effect-ast';
import { indexPromiseRuntimeTasks } from '../../src/rules/effect-promise-runtime-tasks';
import { parseSync } from 'oxc-parser';
import { runRule } from './effect-rule-test-utils';
import theThracianOxlint from '../../src/index';

interface RuleCase {
  name: string;
  reports: 0 | 1;
  representative?: boolean;
  source: string;
}

interface LocatedCallNode {
  end?: number;
  start?: number;
  type?: string;
}

interface RuntimeIndexMeasurement {
  depth: number;
  isDeferred: boolean;
  source: string;
  work: number;
}

const ruleName = 'effect-no-sync-for-promise';
const ruleID = `thethracian/${ruleName}`;
const expectedMessage =
  'Use Effect.tryPromise for Promise-returning code instead of Effect.sync.\n' +
  'Fix: Return an Effect from library code and run it only at the configured application boundary.\n' +
  'Example:\n' +
  '```ts\n' +
  'export const loadUser = Effect.fn("loadUser")(function* (id: UserId) {\n' +
  '  return yield* UserRepo.find(id)\n' +
  '})\n' +
  '```';

const stateJoinCases: readonly RuleCase[] = [
  {
    name: 'stays conservative when reverse unknown if arms leave safe and undefined states',
    reports: 0,
    source: `
      import { Effect } from "effect";
      const user = { id: 1 };
      type UserResult = typeof user | Promise<typeof user> | undefined;
      function load(value: UserResult = Promise.resolve(user)): UserResult {
        return value;
      }
      let supplied: UserResult = user;
      const task = Effect.sync(() => load(supplied));
      const condition = Math.random() > 0.5;
      if (condition) {
        supplied = user;
      } else {
        supplied = void 0;
      }
      Effect.runSync(task);
    `,
  },
  {
    name: 'proves undefined when both unknown if arms assign undefined before the run',
    reports: 1,
    source: `
      import { Effect } from "effect";
      const user = { id: 1 };
      type UserResult = typeof user | Promise<typeof user> | undefined;
      function load(value: UserResult = Promise.resolve(user)): UserResult {
        return value;
      }
      let supplied: UserResult = user;
      const task = Effect.sync(() => load(supplied));
      const condition = Math.random() > 0.5;
      if (condition) {
        supplied = void 0;
      } else {
        supplied = void 0;
      }
      Effect.runSync(task);
    `,
  },
];

const promiseEngineCases: readonly RuleCase[] = [
  {
    name: 'does not reach a Promise return after exact infinite recursion',
    reports: 0,
    source: `
      import { Effect } from "effect";
      const user = { id: 1 };
      function recurse(): never {
        return recurse();
      }
      const task = Effect.sync(() => {
        recurse();
        return Promise.resolve(user);
      });
    `,
  },
  {
    name: 'reports a Promise return after an ordinary terminating helper',
    reports: 1,
    representative: true,
    source: `
      import { Effect } from "effect";
      const user = { id: 1 };
      function once(): void {}
      const task = Effect.sync(() => {
        once();
        return Promise.resolve(user);
      });
    `,
  },
  {
    name: 'reports a Promise return after changed-argument recursion terminates',
    reports: 1,
    source: `
      import { Effect } from "effect";
      const user = { id: 1 };
      function recur(again: boolean): void {
        if (again) {
          recur(false);
        }
      }
      const task = Effect.sync(() => {
        recur(true);
        return Promise.resolve(user);
      });
    `,
  },
];

const expectRuleCase = ({ reports, representative, source }: RuleCase): void => {
  const actualReports = runRule(ruleName, source);
  expect(actualReports).toHaveLength(reports);
  if (!representative || reports !== 1 || actualReports.length !== 1) {
    return;
  }

  expect.soft(theThracianOxlint().rules).toHaveProperty(ruleID, 'error');
  const [report] = actualReports;
  if (!report) {
    return;
  }
  expect.soft(report.message).toBe(expectedMessage);
  expect.soft(report.node).toMatchObject({ type: 'CallExpression' });
  const { end, start } = report.node as LocatedCallNode;
  const expectedStart = source.indexOf('Effect.sync(');
  const expectedEnd = source.lastIndexOf(';');
  expect.soft(start).toBe(expectedStart);
  expect.soft(end).toBe(expectedEnd);
  expect.soft(source.slice(start, end)).toBe(source.slice(expectedStart, expectedEnd));
};

const runtimeDiamondSource = (depth: number): string => {
  const helpers = ['function level0(): void { Effect.runSync(task); }'];
  for (let index = 1; index <= depth; index += 1) {
    helpers.push(
      `function level${index}(): void {\n` +
        `  if (condition()) { level${index - 1}(); }\n` +
        `  else { level${index - 1}(); }\n` +
        '}',
    );
  }
  return `
    import { Effect } from "effect";
    const user = { id: 1 };
    declare function condition(): boolean;
    const task = Effect.sync(() => user);
    ${helpers.join('\n')}
    function root(): void {
      level${depth}();
    }
    root();
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

const measureRuntimeDiamond = (depth: number): RuntimeIndexMeasurement => {
  const source = runtimeDiamondSource(depth);
  const program = parseSync(`runtime-diamond-${depth}.ts`, source, {
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
    source,
    work,
  };
};

const measurements = [4, 8, 12].map(measureRuntimeDiamond);
const growthPairs = [
  {
    fromDepth: measurements[0]?.depth,
    larger: measurements[1],
    smaller: measurements[0],
    toDepth: measurements[1]?.depth,
  },
  {
    fromDepth: measurements[1]?.depth,
    larger: measurements[2],
    smaller: measurements[1],
    toDepth: measurements[2]?.depth,
  },
];

describe('effect-no-sync-for-promise state joins and Promise recursion', (): void => {
  it.each([...stateJoinCases, ...promiseEngineCases])('$name', expectRuleCase);
});

describe('runtime task-index helper-diamond scaling', (): void => {
  it.each(measurements)('indexes the run and terminates at depth $depth', (measurement): void => {
    expect(measurement.isDeferred).toBe(true);
    expect(measurement.work).toBeLessThan(1_000_000);
  });

  it.each(growthPairs)(
    'limits work growth from depth $fromDepth to $toDepth',
    ({ larger, smaller }): void => {
      expect(smaller).toBeDefined();
      expect(larger).toBeDefined();
      if (!smaller || !larger) {
        return;
      }
      expect(larger.work / smaller.work).toBeLessThanOrEqual(3);
    },
  );
});
