import { describe, expect, it } from 'vitest';
import { parseSync } from 'oxc-parser';
import { runRule } from './effect-rule-test-utils';
import theThracianOxlint from '../../src/index';
import ts from 'typescript';

interface RuntimeIdentityCase {
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

const runtimeSource = (initial: 'undefined' | 'user', executionSite: string): string => `
  import { Effect } from "effect";
  const user = { id: 1 };
  type UserResult = typeof user | Promise<typeof user> | undefined;
  function load(value: UserResult = Promise.resolve(user)): UserResult {
    return value;
  }
  let supplied: UserResult = ${initial === 'undefined' ? 'void 0' : 'user'};
  const task = ${syncExpression};
  ${executionSite}
`;

const helperParameterCases: readonly RuntimeIdentityCase[] = [
  {
    name: 'does not report an unsafe task passed to a helper that never runs its parameter',
    reports: 0,
    source: runtimeSource(
      'user',
      `
        function ignore(value: Effect.Effect<UserResult>): void {
          void value;
        }
        supplied = void 0;
        ignore(task);
      `,
    ),
  },
  {
    name: 'transports an unsafe task through a helper parameter',
    reports: 1,
    source: runtimeSource(
      'user',
      `
        function execute(value: Effect.Effect<UserResult>): UserResult {
          return Effect.runSync(value);
        }
        supplied = void 0;
        execute(task);
      `,
    ),
  },
  {
    name: 'does not transport an unselected unsafe task through a safe Effect parameter',
    reports: 0,
    source: runtimeSource(
      'user',
      `
        function execute(value: Effect.Effect<UserResult>): UserResult {
          return Effect.runSync(value);
        }
        supplied = void 0;
        execute(Effect.succeed(user));
        void task;
      `,
    ),
  },
];

type MethodKind = 'object' | 'static';

const methodCaptureSource = (kind: MethodKind, outerTask: 'safe' | 'unsafe'): string => {
  const outer =
    outerTask === 'unsafe'
      ? `const task = ${syncExpression};`
      : 'const task = Effect.succeed(user);';
  const declaration = ((): string => {
    if (kind === 'object') {
      return 'const runner = { execute(): UserResult { return Effect.runSync(task); } };';
    }
    return 'class Runner { static execute(): UserResult { return Effect.runSync(task); } }';
  })();
  const inner =
    outerTask === 'unsafe'
      ? 'const task = Effect.succeed(user);'
      : `const task = ${syncExpression};`;
  const invocation = ((): string => {
    if (kind === 'object') {
      return 'runner.execute();';
    }
    return 'Runner.execute();';
  })();
  return `
    import { Effect } from "effect";
    const user = { id: 1 };
    type UserResult = typeof user | Promise<typeof user> | undefined;
    function load(value: UserResult = Promise.resolve(user)): UserResult {
      return value;
    }
    let supplied: UserResult = user;
    ${outer}
    ${declaration}
    {
      ${inner}
      supplied = void 0;
      ${invocation}
      void task;
    }
  `;
};

const methodCaptureCases: readonly RuntimeIdentityCase[] = (['object', 'static'] as const).flatMap(
  (kind): readonly RuntimeIdentityCase[] => [
    {
      name: `${kind} method captures its unsafe outer task across a safe inner shadow`,
      reports: 1,
      source: methodCaptureSource(kind, 'unsafe'),
    },
    {
      name: `${kind} method captures its safe outer task across an unsafe inner shadow`,
      reports: 0,
      source: methodCaptureSource(kind, 'safe'),
    },
  ],
);

const mutableAliasCases: readonly RuntimeIdentityCase[] = [
  {
    name: 'runs an unsafe task after a mutable alias changes from safe to unsafe',
    reports: 1,
    representative: true,
    source: runtimeSource(
      'user',
      `
        let selected: Effect.Effect<UserResult> = Effect.succeed(user);
        selected = task;
        supplied = void 0;
        Effect.runSync(selected);
      `,
    ),
  },
  {
    name: 'does not run an unsafe task after a mutable alias changes from unsafe to safe',
    reports: 0,
    source: runtimeSource(
      'user',
      `
        let selected: Effect.Effect<UserResult> = task;
        selected = Effect.succeed(user);
        supplied = void 0;
        Effect.runSync(selected);
      `,
    ),
  },
];

const memberIdentityCases: readonly RuntimeIdentityCase[] = [
  {
    name: 'runs an unsafe task stored in an object member',
    reports: 1,
    source: runtimeSource(
      'user',
      `
        const holder = { task };
        supplied = void 0;
        Effect.runSync(holder.task);
      `,
    ),
  },
  {
    name: 'does not confuse a safe object member with an unselected unsafe task',
    reports: 0,
    source: runtimeSource(
      'user',
      `
        const holder = { task: Effect.succeed(user) };
        supplied = void 0;
        Effect.runSync(holder.task);
        void task;
      `,
    ),
  },
];

const hoistedWriteCases: readonly RuntimeIdentityCase[] = [
  {
    name: 'does not apply a helper write called only after the task run',
    reports: 0,
    source: runtimeSource(
      'user',
      `
        function clear(): void {
          supplied = void 0;
        }
        Effect.runSync(task);
        clear();
      `,
    ),
  },
  {
    name: 'applies a later-declared hoisted safe write invoked before the task run',
    reports: 0,
    source: runtimeSource(
      'undefined',
      `
        fill();
        Effect.runSync(task);
        function fill(): void {
          supplied = user;
        }
      `,
    ),
  },
  {
    name: 'applies a nested later-declared hoisted unsafe write before the task run',
    reports: 1,
    source: runtimeSource(
      'user',
      `
        prepare();
        Effect.runSync(task);
        function prepare(): void {
          clear();
          function clear(): void {
            supplied = void 0;
          }
        }
      `,
    ),
  },
];

const allCases = [
  ...helperParameterCases,
  ...methodCaptureCases,
  ...mutableAliasCases,
  ...memberIdentityCases,
  ...hoistedWriteCases,
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
  const sources = new Map(
    allCases.map(({ source }, index): readonly [string, string] => [
      `${process.cwd()}/ts/test/rules/runtime-identity-${index}.fixture.ts`,
      source,
    ]),
  );
  const host = ts.createCompilerHost(compilerOptions);
  const defaultFileExists = host.fileExists;
  const defaultGetSourceFile = host.getSourceFile;
  const defaultReadFile = host.readFile;
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

const expectRuntimeIdentity = ({ reports, representative, source }: RuntimeIdentityCase): void => {
  expect(
    parseSync('runtime-identity-case.ts', source, { sourceType: 'module' }).errors,
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
  expect.soft(report?.message).toBe(expectedMessage);
  expect.soft(report?.node).toMatchObject({ type: 'CallExpression' });
  const { end, start } = report.node as LocatedCallNode;
  const expectedStart = source.indexOf(syncExpression);
  const expectedEnd = expectedStart + syncExpression.length;
  expect.soft({ end, start }).toEqual({ end: expectedEnd, start: expectedStart });
  expect.soft(source.slice(start, end)).toBe(syncExpression);
};

describe('effect-no-sync-for-promise runtime task identity', (): void => {
  it.each(allCases)('$name', expectRuntimeIdentity);

  it('type-checks every runtime identity fixture in strict mode', (): void => {
    expect(strictTypeScriptDiagnostics()).toEqual([]);
  }, 30_000);
});
