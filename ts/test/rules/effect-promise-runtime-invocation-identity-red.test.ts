import { describe, expect, it } from 'vitest';
import { parseSync } from 'oxc-parser';
import { runRule } from './effect-rule-test-utils';
import theThracianOxlint from '../../src/index';
import ts from 'typescript';

interface InvocationIdentityCase {
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

const runtimeSource = (helper: string, execution: string): string => `
  import { Effect } from "effect";
  const user = { id: 1 };
  type UserResult = typeof user | Promise<typeof user> | undefined;
  function load(value: UserResult = Promise.resolve(user)): UserResult {
    return value;
  }
  let supplied: UserResult = user;
  const task = ${syncExpression};
  ${helper}
  supplied = void 0;
  ${execution}
`;

const directHelper = `
  function execute(value: Effect.Effect<UserResult>): UserResult {
    return Effect.runSync(value);
  }
`;

const invocationWrapperCases: readonly InvocationIdentityCase[] = [
  {
    name: 'runs an unsafe task forwarded with Function.call',
    reports: 1,
    representative: true,
    source: runtimeSource(directHelper, 'execute.call(null, task);'),
  },
  {
    name: 'keeps an unselected unsafe task separate from a safe Function.call argument',
    reports: 0,
    source: runtimeSource(directHelper, 'execute.call(null, Effect.succeed(user));'),
  },
  {
    name: 'runs an unsafe task forwarded with Function.apply',
    reports: 1,
    source: runtimeSource(directHelper, 'execute.apply(null, [task]);'),
  },
  {
    name: 'keeps an unselected unsafe task separate from a safe Function.apply argument',
    reports: 0,
    source: runtimeSource(directHelper, 'execute.apply(null, [Effect.succeed(user)]);'),
  },
  {
    name: 'runs an unsafe task forwarded through an invoked bound helper',
    reports: 1,
    source: runtimeSource(directHelper, 'execute.bind(null, task)();'),
  },
  {
    name: 'does not run an unsafe task captured by a bound helper that is never invoked',
    reports: 0,
    source: runtimeSource(
      directHelper,
      `
        const bound = execute.bind(null, task);
        void bound;
      `,
    ),
  },
];

const parameterProjectionCases: readonly InvocationIdentityCase[] = [
  {
    name: 'runs an unsafe task selected by an omitted default parameter',
    reports: 1,
    source: runtimeSource(
      `
        function execute(value: Effect.Effect<UserResult> = task): UserResult {
          return Effect.runSync(value);
        }
      `,
      'execute();',
    ),
  },
  {
    name: 'skips an unsafe default task when a safe argument is supplied',
    reports: 0,
    source: runtimeSource(
      `
        function execute(value: Effect.Effect<UserResult> = task): UserResult {
          return Effect.runSync(value);
        }
      `,
      'execute(Effect.succeed(user));',
    ),
  },
  {
    name: 'runs an unsafe task forwarded through a destructured parameter',
    reports: 1,
    source: runtimeSource(
      `
        function execute({ value }: { value: Effect.Effect<UserResult> }): UserResult {
          return Effect.runSync(value);
        }
      `,
      'execute({ value: task });',
    ),
  },
  {
    name: 'keeps an unselected unsafe task separate from a safe destructured value',
    reports: 0,
    source: runtimeSource(
      `
        function execute({ value }: { value: Effect.Effect<UserResult> }): UserResult {
          return Effect.runSync(value);
        }
      `,
      'execute({ value: Effect.succeed(user) });',
    ),
  },
  {
    name: 'runs an unsafe task forwarded through an object spread',
    reports: 1,
    source: runtimeSource(
      `
        function execute({ value }: { value: Effect.Effect<UserResult> }): UserResult {
          return Effect.runSync(value);
        }
      `,
      'execute({ ...{ value: task } });',
    ),
  },
  {
    name: 'keeps an unselected unsafe task separate from a safe object spread value',
    reports: 0,
    source: runtimeSource(
      `
        function execute({ value }: { value: Effect.Effect<UserResult> }): UserResult {
          return Effect.runSync(value);
        }
      `,
      'execute({ ...{ value: Effect.succeed(user) } });',
    ),
  },
];

const memberWriteCases: readonly InvocationIdentityCase[] = [
  {
    name: 'runs an unsafe task assigned into an object member',
    reports: 1,
    source: runtimeSource(
      directHelper,
      `
        const holder: { value: Effect.Effect<UserResult> } = {
          value: Effect.succeed(user),
        };
        holder.value = task;
        execute(holder.value);
      `,
    ),
  },
  {
    name: 'does not run an unsafe task overwritten by a safe object member value',
    reports: 0,
    source: runtimeSource(
      directHelper,
      `
        const holder: { value: Effect.Effect<UserResult> } = { value: task };
        holder.value = Effect.succeed(user);
        execute(holder.value);
      `,
    ),
  },
];

const helperLocalTaskSource = (argument: 'false' | 'true'): string => `
  import { Effect } from "effect";
  const user = { id: 1 };
  type UserResult = typeof user | Promise<typeof user> | undefined;
  function load(value: UserResult = Promise.resolve(user)): UserResult {
    return value;
  }
  function execute(isUnsafe: boolean): UserResult {
    let supplied: UserResult = isUnsafe ? void 0 : user;
    const task = ${syncExpression};
    return Effect.runSync(task);
  }
  execute(${argument});
`;

const helperLocalTaskCases: readonly InvocationIdentityCase[] = [
  {
    name: 'reports an unsafe helper-local task at its invoked execution site',
    reports: 1,
    source: helperLocalTaskSource('true'),
  },
  {
    name: 'accepts a safe helper-local task at its invoked execution site',
    reports: 0,
    source: helperLocalTaskSource('false'),
  },
];

const parameterLocalTaskSource = (argument: 'undefined' | 'user'): string => `
  import { Effect } from "effect";
  const user = { id: 1 };
  type UserResult = typeof user | Promise<typeof user> | undefined;
  function load(value: UserResult = Promise.resolve(user)): UserResult {
    return value;
  }
  function make(supplied: UserResult): UserResult {
    const task = ${syncExpression};
    return Effect.runSync(task);
  }
  make(${argument === 'undefined' ? 'void 0' : 'user'});
`;

const parameterLocalTaskCases: readonly InvocationIdentityCase[] = [
  {
    name: 'reports a helper-created task from its unsafe invocation argument',
    reports: 1,
    source: parameterLocalTaskSource('undefined'),
  },
  {
    name: 'accepts a helper-created task from its safe invocation argument',
    reports: 0,
    source: parameterLocalTaskSource('user'),
  },
];

const closureFactoryHelper = `
  function make(value: Effect.Effect<UserResult>): () => UserResult {
    return () => Effect.runSync(value);
  }
`;

const closureFactoryCases: readonly InvocationIdentityCase[] = [
  {
    name: 'keeps a safe closure instance separate from an unselected unsafe task',
    reports: 0,
    source: runtimeSource(
      closureFactoryHelper,
      `
        const safe = make(Effect.succeed(user));
        safe();
        void task;
      `,
    ),
  },
  {
    name: 'runs an unsafe task captured by its closure factory instance',
    reports: 1,
    source: runtimeSource(
      closureFactoryHelper,
      `
        const unsafe = make(task);
        unsafe();
      `,
    ),
  },
  {
    name: 'distinguishes safe and unsafe closure factory instances when both run',
    reports: 1,
    source: runtimeSource(
      closureFactoryHelper,
      `
        const safe = make(Effect.succeed(user));
        const unsafe = make(task);
        safe();
        unsafe();
      `,
    ),
  },
];

const allCases = [
  ...invocationWrapperCases,
  ...parameterProjectionCases,
  ...memberWriteCases,
  ...helperLocalTaskCases,
  ...parameterLocalTaskCases,
  ...closureFactoryCases,
] as const;

const strictTypeScriptDiagnostics = (): readonly string[] => {
  const compilerOptions: ts.CompilerOptions = {
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    noEmit: true,
    skipLibCheck: true,
    strict: true,
    target: ts.ScriptTarget.ES2022,
  };
  const fixtureDirectory = new URL('.', import.meta.url).pathname;
  const sources = new Map(
    allCases.map(({ source }, index): readonly [string, string] => [
      `${fixtureDirectory}runtime-invocation-identity-${index}.fixture.ts`,
      source,
    ]),
  );
  const host = ts.createCompilerHost(compilerOptions);
  const defaultFileExists = host.fileExists.bind(host);
  const defaultGetSourceFile = host.getSourceFile.bind(host);
  const defaultReadFile = host.readFile.bind(host);
  host.fileExists = (filename): boolean => sources.has(filename) || defaultFileExists(filename);
  host.getSourceFile = (filename, languageVersion, onError, shouldCreateNewSourceFile) => {
    const source = sources.get(filename);
    if (source === undefined) {
      return defaultGetSourceFile(filename, languageVersion, onError, shouldCreateNewSourceFile);
    }
    return ts.createSourceFile(filename, source, languageVersion, true);
  };
  host.readFile = (filename): string | undefined =>
    sources.get(filename) ?? defaultReadFile(filename);
  const program = ts.createProgram([...sources.keys()], compilerOptions, host);
  return ts
    .getPreEmitDiagnostics(program)
    .map((diagnostic): string => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
};

const expectInvocationIdentity = ({
  reports,
  representative,
  source,
}: InvocationIdentityCase): void => {
  expect(
    parseSync('runtime-invocation-identity.ts', source, { sourceType: 'module' }).errors,
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
  const expectedEnd = expectedStart + syncExpression.length;
  expect.soft({ end, start }).toEqual({ end: expectedEnd, start: expectedStart });
  expect.soft(source.slice(start, end)).toBe(syncExpression);
};

describe('effect-no-sync-for-promise runtime invocation identity', (): void => {
  it.each(allCases)('$name', (testCase): void => {
    expect.hasAssertions();
    expectInvocationIdentity(testCase);
  });

  it('type-checks every invocation identity fixture in strict mode', (): void => {
    expect(strictTypeScriptDiagnostics()).toEqual([]);
  }, 30_000);
});
