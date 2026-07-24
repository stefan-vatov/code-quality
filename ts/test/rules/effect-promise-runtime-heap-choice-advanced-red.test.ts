import { describe, expect, it } from 'vitest';
import { parseSync } from 'oxc-parser';
import { runRule } from './effect-rule-test-utils';
import theThracianOxlint from '../../src/index';
import ts from 'typescript';

interface AdvancedHeapChoiceCase {
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

const postChoiceWriteCases: readonly AdvancedHeapChoiceCase[] = [
  {
    name: 'writes an unsafe task through an alias after equivalent safe object branches',
    reports: 1,
    representative: true,
    source: runtimeSource(`
      declare const condition: boolean;
      const holder: { value: UserTask } = condition
        ? { value: Effect.succeed(user) }
        : { value: Effect.succeed(user) };
      const alias = holder;
      alias.value = task;
      supplied = void 0;
      Effect.runSync(holder.value);
    `),
  },
  {
    name: 'writes a safe task after equivalent unsafe object branches',
    reports: 0,
    source: runtimeSource(`
      declare const condition: boolean;
      const holder: { value: UserTask } = condition
        ? { value: task }
        : { value: task };
      holder.value = Effect.succeed(user);
      supplied = void 0;
      Effect.runSync(holder.value);
    `),
  },
];

const customObjectAssignCases: readonly AdvancedHeapChoiceCase[] = [
  {
    name: 'does not apply native Object.assign mutation semantics to a custom assign method',
    reports: 1,
    source: runtimeSource(`
      const Object = {
        assign(
          target: { value: UserTask },
          _source: { value: UserTask },
        ): { value: UserTask } {
          return target;
        },
      };
      const holder: { value: UserTask } = { value: task };
      Object.assign(holder, { value: Effect.succeed(user) });
      supplied = void 0;
      Effect.runSync(holder.value);
    `),
  },
  {
    name: 'keeps a safe target unchanged when a custom assign method ignores an unsafe source',
    reports: 0,
    source: runtimeSource(`
      const Object = {
        assign(
          target: { value: UserTask },
          _source: { value: UserTask },
        ): { value: UserTask } {
          return target;
        },
      };
      const holder: { value: UserTask } = { value: Effect.succeed(user) };
      Object.assign(holder, { value: task });
      supplied = void 0;
      Effect.runSync(holder.value);
    `),
  },
];

const typedThisSource = (wrapper: 'apply' | 'bind', receiver: 'safe' | 'task'): string => {
  const value = ((): string => {
    if (receiver === 'task') {
      return 'task';
    }
    return 'Effect.succeed(user)';
  })();
  const invocation =
    wrapper === 'apply'
      ? `execute.apply({ value: ${value} }, []);`
      : `execute.bind({ value: ${value} })();`;
  return runtimeSource(`
    function execute(this: { value: UserTask }): UserResult {
      return Effect.runSync(this.value);
    }
    supplied = void 0;
    ${invocation}
    ${receiver === 'safe' ? 'void task;' : ''}
  `);
};

const typedThisCases: readonly AdvancedHeapChoiceCase[] = (['apply', 'bind'] as const).flatMap(
  (wrapper): readonly AdvancedHeapChoiceCase[] => [
    {
      name: `runs a task carried by a typed Function.${wrapper} receiver`,
      reports: 1,
      source: typedThisSource(wrapper, 'task'),
    },
    {
      name: `accepts a safe typed Function.${wrapper} receiver`,
      reports: 0,
      source: typedThisSource(wrapper, 'safe'),
    },
  ],
);

const branchLocalTaskSource = (alternate: 'safe' | 'unsafe'): string => `
  import { Effect } from "effect";
  const user = { id: 1 };
  type UserResult = typeof user | Promise<typeof user> | undefined;
  function load(value: UserResult = Promise.resolve(user)): UserResult {
    return value;
  }
  function execute(supplied: UserResult): UserResult {
    const task = ${syncExpression};
    return Effect.runSync(task);
  }
  declare const condition: boolean;
  if (condition) {
    execute(void 0);
  } else {
    execute(${alternate === 'unsafe' ? 'void 0' : 'user'});
  }
`;

const branchLocalTaskCases: readonly AdvancedHeapChoiceCase[] = [
  {
    name: 'joins the same sync site instantiated unsafely in both unknown branches',
    reports: 1,
    source: branchLocalTaskSource('unsafe'),
  },
  {
    name: 'does not prove the same sync site unsafe from divergent branch invocations',
    reports: 0,
    source: branchLocalTaskSource('safe'),
  },
];

const allCases = [
  ...postChoiceWriteCases,
  ...customObjectAssignCases,
  ...typedThisCases,
  ...branchLocalTaskCases,
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
      `${directory}runtime-heap-choice-advanced-${index}.fixture.ts`,
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

const expectAdvancedHeapChoice = ({
  reports,
  representative,
  source,
}: AdvancedHeapChoiceCase): void => {
  expect(
    parseSync('runtime-heap-choice-advanced.ts', source, { sourceType: 'module' }).errors,
  ).toHaveLength(0);
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

describe('effect-no-sync-for-promise advanced runtime heap choices', (): void => {
  it.each(allCases)('$name', (testCase): void => {
    expect.hasAssertions();
    expectAdvancedHeapChoice(testCase);
  });

  it('type-checks every advanced heap choice fixture in strict mode', (): void => {
    expect(strictTypeScriptDiagnostics()).toEqual([]);
  }, 30_000);
});
