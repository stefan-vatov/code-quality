import { childNode, childNodes, identifierName } from '../../src/rules/effect-ast';
import { describe, expect, it } from 'vitest';
import type { ASTNode } from '../../src/rules/effect-ast';
import { containerHelperScopes } from '../../src/rules/effect-promise-callables';
import { hasExecutedPromiseBoundary } from '../../src/rules/effect-promise-execution-ast';
import { parseSync } from 'oxc-parser';
import { runRule } from './effect-rule-test-utils';
import theThracianOxlint from '../../src/index';

interface RuntimeControlCase {
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

interface WorkMeasurement {
  depth: number;
  isUnsafe: boolean;
  source: string;
  work: number;
}

const ruleName = 'effect-no-sync-for-promise';
const ruleID = `thethracian/${ruleName}`;
const syncExpression = 'Effect.sync(() => load(supplied))';
const expectedMessage =
  'Use Effect.tryPromise for Promise-returning code instead of Effect.sync.\n' +
  'Fix: Return an Effect from library code and run it only at the configured application boundary.\n' +
  'Example:\n' +
  '```ts\n' +
  'export const loadUser = Effect.fn("loadUser")(function* (id: UserId) {\n' +
  '  return yield* UserRepo.find(id)\n' +
  '})\n' +
  '```';

const runtimeTaskSource = (executionSite: string): string => `
  import { Effect } from "effect";
  const user = { id: 1 };
  type UserResult = typeof user | Promise<typeof user> | undefined;
  function load(value: UserResult = Promise.resolve(user)): UserResult {
    return value;
  }
  let supplied: UserResult = user;
  const task = ${syncExpression};
  supplied = void 0;
  ${executionSite}
`;

const booleanExecutionCases: readonly RuntimeControlCase[] = [
  {
    name: 'does not run an unsafe task on the right of false logical AND',
    reports: 0,
    source: runtimeTaskSource('false && Effect.runSync(task);'),
  },
  {
    name: 'runs an unsafe task on the right of true logical AND',
    reports: 1,
    representative: true,
    source: runtimeTaskSource('true && Effect.runSync(task);'),
  },
  {
    name: 'does not run an unsafe task on the right of true logical OR',
    reports: 0,
    source: runtimeTaskSource('true || Effect.runSync(task);'),
  },
  {
    name: 'runs an unsafe task on the right of false logical OR',
    reports: 1,
    source: runtimeTaskSource('false || Effect.runSync(task);'),
  },
  {
    name: 'runs an unsafe task in the selected true conditional branch',
    reports: 1,
    source: runtimeTaskSource('true ? Effect.runSync(task) : user;'),
  },
  {
    name: 'does not run an unsafe task in an unselected false conditional branch',
    reports: 0,
    source: runtimeTaskSource('false ? Effect.runSync(task) : user;'),
  },
  {
    name: 'does not run an unsafe task in a statically false if branch',
    reports: 0,
    source: runtimeTaskSource(`
      if (false) {
        Effect.runSync(task);
      }
    `),
  },
  {
    name: 'runs an unsafe task in a statically true if branch',
    reports: 1,
    source: runtimeTaskSource(`
      if (true) {
        Effect.runSync(task);
      }
    `),
  },
];

const abruptExecutionCases: readonly RuntimeControlCase[] = [
  {
    name: 'does not reach a task run after a definite throw',
    reports: 0,
    source: runtimeTaskSource(`
      throw new Error("stop");
      Effect.runSync(task);
    `),
  },
  {
    name: 'reaches a task run before a later throw',
    reports: 1,
    source: runtimeTaskSource(`
      Effect.runSync(task);
      throw new Error("stop");
    `),
  },
];

const closureSource = (syntax: 'arrow' | 'function', outerTask: 'safe' | 'unsafe'): string => {
  const outerDeclaration =
    outerTask === 'unsafe'
      ? `let supplied: UserResult = user;
         const task = ${syncExpression};`
      : `let supplied: UserResult = user;
         const task = Effect.succeed(user);`;
  const closure = ((): string => {
    if (syntax === 'arrow') {
      return 'const execute = () => Effect.runSync(task);';
    }
    return 'const execute = function (): UserResult { return Effect.runSync(task); };';
  })();
  const innerDeclaration =
    outerTask === 'unsafe'
      ? 'const task = Effect.succeed(user);'
      : `const task = ${syncExpression};
         supplied = void 0;`;
  return `
    import { Effect } from "effect";
    const user = { id: 1 };
    type UserResult = typeof user | Promise<typeof user> | undefined;
    function load(value: UserResult = Promise.resolve(user)): UserResult {
      return value;
    }
    ${outerDeclaration}
    ${closure}
    {
      ${innerDeclaration}
      ${outerTask === 'unsafe' ? 'supplied = void 0;' : ''}
      execute();
      void task;
    }
  `;
};

const closureCaptureCases: readonly RuntimeControlCase[] = [
  {
    name: 'an arrow closure keeps its unsafe outer task despite a safe inner shadow',
    reports: 1,
    source: closureSource('arrow', 'unsafe'),
  },
  {
    name: 'an arrow closure keeps its safe outer task despite an unsafe inner shadow',
    reports: 0,
    source: closureSource('arrow', 'safe'),
  },
  {
    name: 'a function expression keeps its unsafe outer task despite a safe inner shadow',
    reports: 1,
    source: closureSource('function', 'unsafe'),
  },
  {
    name: 'a function expression keeps its safe outer task despite an unsafe inner shadow',
    reports: 0,
    source: closureSource('function', 'safe'),
  },
];

const expectRuntimeControl = ({ reports, representative, source }: RuntimeControlCase): void => {
  const actualReports = runRule(ruleName, source);
  expect(actualReports).toHaveLength(reports);
  if (!representative || reports !== 1 || actualReports.length !== 1) {
    return;
  }

  expect.soft(theThracianOxlint().rules).toHaveProperty(ruleID, 'error');
  const [report] = actualReports;
  expect.soft(report?.message).toBe(expectedMessage);
  expect.soft(report?.node).toMatchObject({ type: 'CallExpression' });
  const { end, start } = report?.node as LocatedCallNode;
  const expectedStart = source.indexOf(syncExpression);
  const expectedEnd = expectedStart + syncExpression.length;
  expect.soft(start).toBe(expectedStart);
  expect.soft(end).toBe(expectedEnd);
  expect.soft(source.slice(start, end)).toBe(syncExpression);
};

const diamondSource = (depth: number): string => {
  const helpers = ['function level0(): Promise<number> { return boundary(); }'];
  for (let index = 1; index <= depth; index += 1) {
    helpers.push(
      `function level${index}(): Promise<number> | number {\n` +
        `  if (condition()) { return level${index - 1}(); }\n` +
        `  return level${index - 1}();\n` +
        '}',
    );
  }
  return `
    declare function condition(): boolean;
    declare function boundary(): Promise<number>;
    ${helpers.join('\n')}
    function root(): Promise<number> | number {
      return level${depth}();
    }
  `;
};

const rootFunction = (program: ASTNode): ASTNode => {
  const root = childNodes(program, 'body').find(
    (node): boolean => identifierName(childNode(node, 'id')) === 'root',
  );
  expect(root).toBeDefined();
  return root as ASTNode;
};

const measureDiamond = (depth: number): WorkMeasurement => {
  const source = diamondSource(depth);
  const program = parseSync(`diamond-${depth}.ts`, source, { sourceType: 'module' })
    .program as ASTNode;
  let work = 0;
  const isUnsafe = hasExecutedPromiseBoundary({
    functionNode: rootFunction(program),
    helperScopes: containerHelperScopes(program, [], []),
    isBoundary(node): boolean {
      work += 1;
      return (
        node.type === 'CallExpression' && identifierName(childNode(node, 'callee')) === 'boundary'
      );
    },
    scopes: [],
  });
  return { depth, isUnsafe, source, work };
};

const measurements = [4, 8, 12].map(measureDiamond);
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

describe('effect-no-sync-for-promise runtime interpreter control flow', (): void => {
  it.each([...booleanExecutionCases, ...abruptExecutionCases, ...closureCaptureCases])(
    '$name',
    expectRuntimeControl,
  );
});

describe('Promise execution helper-diamond scaling', (): void => {
  it.each(measurements)(
    'finds the boundary and terminates at depth $depth',
    (measurement): void => {
      expect(measurement.isUnsafe).toBe(true);
      expect(measurement.work).toBeLessThan(1_000_000);
    },
  );

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
