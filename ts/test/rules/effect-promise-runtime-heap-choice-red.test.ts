import { describe, expect, it } from 'vitest';
import { parseSync } from 'oxc-parser';
import { runRule } from './effect-rule-test-utils';
import theThracianOxlint from '../../src/index';
import ts from 'typescript';

interface RuntimeHeapChoiceCase {
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

const runtimeSource = (execution: string): string => `
  import { Effect } from "effect";
  const user = { id: 1 };
  type UserResult = typeof user | Promise<typeof user> | undefined;
  type UserTask = Effect.Effect<UserResult>;
  function load(value: UserResult = Promise.resolve(user)): UserResult {
    return value;
  }
  let supplied: UserResult = user;
  const task: UserTask = ${syncExpression};
  ${execution}
`;

const computedMemberCases: readonly RuntimeHeapChoiceCase[] = [
  {
    name: 'reads an unsafe task through an aliased computed member',
    reports: 1,
    representative: true,
    source: runtimeSource(`
      const key = "value" as const;
      const holder: { value: UserTask } = { value: task };
      const alias = holder;
      supplied = void 0;
      Effect.runSync(alias[key]);
    `),
  },
  {
    name: 'reads a safe Effect through an aliased computed member',
    reports: 0,
    source: runtimeSource(`
      const key = "value" as const;
      const holder: { value: UserTask } = { value: Effect.succeed(user) };
      const alias = holder;
      supplied = void 0;
      Effect.runSync(alias[key]);
      void task;
    `),
  },
  {
    name: 'writes an unsafe task through an aliased computed member',
    reports: 1,
    source: runtimeSource(`
      const key = "value" as const;
      const holder: { value: UserTask } = { value: Effect.succeed(user) };
      const alias = holder;
      alias[key] = task;
      supplied = void 0;
      Effect.runSync(holder.value);
    `),
  },
  {
    name: 'overwrites an unsafe task safely through an aliased computed member',
    reports: 0,
    source: runtimeSource(`
      const key = "value" as const;
      const holder: { value: UserTask } = { value: task };
      const alias = holder;
      alias[key] = Effect.succeed(user);
      supplied = void 0;
      Effect.runSync(holder.value);
    `),
  },
];

const directAliasCases: readonly RuntimeHeapChoiceCase[] = [
  {
    name: 'retains an unsafe task through a direct alias',
    reports: 1,
    source: runtimeSource(`
      const selected = task;
      supplied = void 0;
      Effect.runSync(selected);
    `),
  },
  {
    name: 'keeps a direct safe Effect separate from an unselected unsafe task',
    reports: 0,
    source: runtimeSource(`
      const selected: UserTask = Effect.succeed(user);
      supplied = void 0;
      Effect.runSync(selected);
      void task;
    `),
  },
];

const unknownBranchCases: readonly RuntimeHeapChoiceCase[] = [
  {
    name: 'joins equivalent branch objects that both carry the unsafe task',
    reports: 1,
    source: runtimeSource(`
      declare const condition: boolean;
      const holder = condition ? { value: task } : { value: task };
      supplied = void 0;
      Effect.runSync(holder.value);
    `),
  },
  {
    name: 'does not prove an unsafe run from divergent branch object members',
    reports: 0,
    source: runtimeSource(`
      declare const condition: boolean;
      const holder = condition
        ? { value: task }
        : { value: Effect.succeed(user) as UserTask };
      supplied = void 0;
      Effect.runSync(holder.value);
    `),
  },
  {
    name: 'joins equivalent branch closures that both run the unsafe task',
    reports: 1,
    source: runtimeSource(`
      declare const condition: boolean;
      const execute = condition
        ? () => Effect.runSync(task)
        : () => Effect.runSync(task);
      supplied = void 0;
      execute();
    `),
  },
  {
    name: 'does not prove an unsafe run from divergent branch closures',
    reports: 0,
    source: runtimeSource(`
      declare const condition: boolean;
      const execute = condition
        ? () => Effect.runSync(task)
        : () => Effect.runSync(Effect.succeed(user));
      supplied = void 0;
      execute();
    `),
  },
];

const ordinaryMethodSource = (
  method: 'apply' | 'bind' | 'call',
  argument: 'safe' | 'task',
): string =>
  runtimeSource(`
    const runner = {
      ${method}(value: UserTask): UserResult {
        return Effect.runSync(value);
      },
    };
    supplied = void 0;
    runner.${method}(${argument === 'task' ? 'task' : 'Effect.succeed(user)'});
    ${argument === 'safe' ? 'void task;' : ''}
  `);

const ordinaryMethodCases: readonly RuntimeHeapChoiceCase[] = (
  ['call', 'apply', 'bind'] as const
).flatMap((method): readonly RuntimeHeapChoiceCase[] => [
  {
    name: `runs an unsafe task through an ordinary object method named ${method}`,
    reports: 1,
    source: ordinaryMethodSource(method, 'task'),
  },
  {
    name: `accepts a safe task through an ordinary object method named ${method}`,
    reports: 0,
    source: ordinaryMethodSource(method, 'safe'),
  },
]);

const deleteCases: readonly RuntimeHeapChoiceCase[] = [
  {
    name: 'does not run a deleted task member on a guarded path',
    reports: 0,
    source: runtimeSource(`
      const holder: { other?: number; value?: UserTask } = {
        other: 1,
        value: task,
      };
      delete holder.value;
      supplied = void 0;
      if (holder.value) {
        Effect.runSync(holder.value);
      }
    `),
  },
  {
    name: 'preserves an unsafe task when a different member is deleted',
    reports: 1,
    source: runtimeSource(`
      const holder: { other?: number; value?: UserTask } = {
        other: 1,
        value: task,
      };
      delete holder.other;
      supplied = void 0;
      if (holder.value) {
        Effect.runSync(holder.value);
      }
    `),
  },
  {
    name: 'does not run a task deleted through an aliased computed member',
    reports: 0,
    source: runtimeSource(`
      const holder: { other?: number; value?: UserTask } = {
        other: 1,
        value: task,
      };
      const alias = holder;
      const key: keyof typeof holder = "value";
      delete alias[key];
      supplied = void 0;
      if (holder.value) {
        Effect.runSync(holder.value);
      }
    `),
  },
  {
    name: 'preserves an unsafe task when another computed alias member is deleted',
    reports: 1,
    source: runtimeSource(`
      const holder: { other?: number; value?: UserTask } = {
        other: 1,
        value: task,
      };
      const alias = holder;
      const key: keyof typeof holder = "other";
      delete alias[key];
      supplied = void 0;
      if (holder.value) {
        Effect.runSync(holder.value);
      }
    `),
  },
];

const objectAssignSource = (initial: 'safe' | 'task', assigned: 'safe' | 'task'): string =>
  runtimeSource(`
    const holder: { value: UserTask } = {
      value: ${initial === 'task' ? 'task' : 'Effect.succeed(user)'},
    };
    Object.assign(holder, {
      value: ${assigned === 'task' ? 'task' : 'Effect.succeed(user)'},
    });
    supplied = void 0;
    Effect.runSync(holder.value);
    ${initial === 'safe' && assigned === 'safe' ? 'void task;' : ''}
  `);

const objectAssignCases: readonly RuntimeHeapChoiceCase[] = [
  {
    name: 'observes Object.assign overwriting an unsafe member safely',
    reports: 0,
    source: objectAssignSource('task', 'safe'),
  },
  {
    name: 'observes Object.assign overwriting a safe member unsafely',
    reports: 1,
    source: objectAssignSource('safe', 'task'),
  },
  {
    name: 'accepts a safe Object.assign source and target',
    reports: 0,
    source: objectAssignSource('safe', 'safe'),
  },
  {
    name: 'observes Object.assign safely overwriting an unsafe member through an alias',
    reports: 0,
    source: runtimeSource(`
      const holder: { value: UserTask } = { value: task };
      const alias = holder;
      Object.assign(alias, { value: Effect.succeed(user) });
      supplied = void 0;
      Effect.runSync(holder.value);
    `),
  },
  {
    name: 'observes Object.assign unsafely overwriting a safe member through an alias',
    reports: 1,
    source: runtimeSource(`
      const holder: { value: UserTask } = { value: Effect.succeed(user) };
      const alias = holder;
      Object.assign(alias, { value: task });
      supplied = void 0;
      Effect.runSync(holder.value);
    `),
  },
];

const typedThisCases: readonly RuntimeHeapChoiceCase[] = [
  {
    name: 'runs a task carried by a typed Function.call receiver',
    reports: 1,
    source: runtimeSource(`
      function execute(this: { value: UserTask }): UserResult {
        return Effect.runSync(this.value);
      }
      supplied = void 0;
      execute.call({ value: task });
    `),
  },
  {
    name: 'accepts a safe typed Function.call receiver',
    reports: 0,
    source: runtimeSource(`
      function execute(this: { value: UserTask }): UserResult {
        return Effect.runSync(this.value);
      }
      supplied = void 0;
      execute.call({ value: Effect.succeed(user) });
      void task;
    `),
  },
];

const allCases = [
  ...computedMemberCases,
  ...directAliasCases,
  ...unknownBranchCases,
  ...ordinaryMethodCases,
  ...deleteCases,
  ...objectAssignCases,
  ...typedThisCases,
] as const;

const strictTypeScriptDiagnostics = (): readonly string[] => {
  const options: ts.CompilerOptions = {
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    noEmit: true,
    skipLibCheck: true,
    strict: true,
    target: ts.ScriptTarget.ES2022,
  };
  const directory = new URL('.', import.meta.url).pathname;
  const sources = new Map(
    allCases.map(({ source }, index): readonly [string, string] => [
      `${directory}runtime-heap-choice-${index}.fixture.ts`,
      source,
    ]),
  );
  const host = ts.createCompilerHost(options);
  const fileExists = host.fileExists.bind(host);
  const getSourceFile = host.getSourceFile.bind(host);
  const readFile = host.readFile.bind(host);
  host.fileExists = (filename): boolean => sources.has(filename) || fileExists(filename);
  host.getSourceFile = (filename, languageVersion, onError, shouldCreateNewSourceFile) => {
    const source = sources.get(filename);
    if (source === undefined) {
      return getSourceFile(filename, languageVersion, onError, shouldCreateNewSourceFile);
    }
    return ts.createSourceFile(filename, source, languageVersion, true);
  };
  host.readFile = (filename): string | undefined => sources.get(filename) ?? readFile(filename);
  return ts
    .getPreEmitDiagnostics(ts.createProgram([...sources.keys()], options, host))
    .map((diagnostic): string => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
};

const expectHeapChoice = ({ reports, representative, source }: RuntimeHeapChoiceCase): void => {
  expect(parseSync('runtime-heap-choice.ts', source, { sourceType: 'module' }).errors).toHaveLength(
    0,
  );
  const actualReports = runRule(ruleName, source);
  expect(actualReports).toHaveLength(reports);
  if (!representative || reports !== 1 || actualReports.length !== 1) {
    return;
  }
  expect.soft(theThracianOxlint().rules).toHaveProperty(ruleID, 'error');
  const [report] = actualReports;
  expect.soft(report).toBeDefined();
  if (!report) {
    return;
  }
  expect.soft(report.message).toBe(expectedMessage);
  expect.soft(report.node).toMatchObject({ type: 'CallExpression' });
  const { end, start } = report.node as LocatedCallNode;
  const expectedStart = source.indexOf(syncExpression);
  expect.soft({ end, start }).toEqual({
    end: expectedStart + syncExpression.length,
    start: expectedStart,
  });
};

describe('effect-no-sync-for-promise runtime heap and choice identity', (): void => {
  it.each(allCases)('$name', (testCase): void => {
    expect.hasAssertions();
    expectHeapChoice(testCase);
  });

  it('type-checks every heap choice fixture in strict mode', (): void => {
    expect(strictTypeScriptDiagnostics()).toEqual([]);
  }, 30_000);
});
