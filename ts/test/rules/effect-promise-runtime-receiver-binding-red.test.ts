import { describe, expect, it } from 'vitest';
import { parseSync } from 'oxc-parser';
import { runRule } from './effect-rule-test-utils';
import theThracianOxlint from '../../src/index';
import ts from 'typescript';

interface ReceiverBindingCase {
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

const ordinaryReceiverCases: readonly ReceiverBindingCase[] = [
  {
    name: 'binds an unsafe ordinary object method receiver',
    reports: 1,
    representative: true,
    source: runtimeSource(`
      const runner = {
        value: task,
        execute(this: { value: UserTask }): UserResult {
          return Effect.runSync(this.value);
        },
      };
      supplied = void 0;
      runner.execute();
    `),
  },
  {
    name: 'binds a safe ordinary object method receiver',
    reports: 0,
    source: runtimeSource(`
      const runner = {
        value: Effect.succeed(user) as UserTask,
        execute(this: { value: UserTask }): UserResult {
          return Effect.runSync(this.value);
        },
      };
      supplied = void 0;
      runner.execute();
      void task;
    `),
  },
];

const namedOrdinaryReceiverCases: readonly ReceiverBindingCase[] = [
  {
    name: 'binds the receiver of an ordinary method named call',
    reports: 1,
    source: runtimeSource(`
      const runner = {
        value: task,
        call(this: { value: UserTask }): UserResult {
          return Effect.runSync(this.value);
        },
      };
      supplied = void 0;
      runner.call();
    `),
  },
  {
    name: 'binds the receiver of an ordinary method named apply',
    reports: 1,
    source: runtimeSource(`
      const runner = {
        value: task,
        apply(this: { value: UserTask }): UserResult {
          return Effect.runSync(this.value);
        },
      };
      supplied = void 0;
      runner.apply();
    `),
  },
  {
    name: 'binds the receiver of an ordinary method named bind',
    reports: 1,
    source: runtimeSource(`
      const runner = {
        value: task,
        bind(this: { value: UserTask }): UserResult {
          return Effect.runSync(this.value);
        },
      };
      supplied = void 0;
      runner.bind();
    `),
  },
  {
    name: 'keeps safe receiver values safe for ordinary wrapper-named methods',
    reports: 0,
    source: runtimeSource(`
      const runner = {
        value: Effect.succeed(user) as UserTask,
        call(this: { value: UserTask }): UserResult {
          return Effect.runSync(this.value);
        },
        apply(this: { value: UserTask }): UserResult {
          return Effect.runSync(this.value);
        },
        bind(this: { value: UserTask }): UserResult {
          return Effect.runSync(this.value);
        },
      };
      supplied = void 0;
      runner.call();
      runner.apply();
      runner.bind();
      void task;
    `),
  },
];

const repeatedBindCases: readonly ReceiverBindingCase[] = [
  {
    name: 'retains the unsafe first receiver across a later bind',
    reports: 1,
    source: runtimeSource(`
      function execute(this: { value: UserTask }): UserResult {
        return Effect.runSync(this.value);
      }
      const bound = execute
        .bind({ value: task })
        .bind({ value: Effect.succeed(user) });
      supplied = void 0;
      bound();
    `),
  },
  {
    name: 'does not replace a safe first receiver through a later bind',
    reports: 0,
    source: runtimeSource(`
      function execute(this: { value: UserTask }): UserResult {
        return Effect.runSync(this.value);
      }
      const bound = execute
        .bind({ value: Effect.succeed(user) })
        .bind({ value: task });
      supplied = void 0;
      bound();
    `),
  },
];

const boundOverrideCases: readonly ReceiverBindingCase[] = [
  {
    name: 'does not override an unsafe bound receiver through Function.call',
    reports: 1,
    source: runtimeSource(`
      function execute(this: { value: UserTask }): UserResult {
        return Effect.runSync(this.value);
      }
      const bound = execute.bind({ value: task });
      supplied = void 0;
      bound.call({ value: Effect.succeed(user) });
    `),
  },
  {
    name: 'does not override a safe bound receiver through Function.call',
    reports: 0,
    source: runtimeSource(`
      function execute(this: { value: UserTask }): UserResult {
        return Effect.runSync(this.value);
      }
      const bound = execute.bind({ value: Effect.succeed(user) });
      supplied = void 0;
      bound.call({ value: task });
    `),
  },
  {
    name: 'does not override an unsafe bound receiver through Function.apply',
    reports: 1,
    source: runtimeSource(`
      function execute(this: { value: UserTask }): UserResult {
        return Effect.runSync(this.value);
      }
      const bound = execute.bind({ value: task });
      supplied = void 0;
      bound.apply({ value: Effect.succeed(user) }, []);
    `),
  },
  {
    name: 'does not override a safe bound receiver through Function.apply',
    reports: 0,
    source: runtimeSource(`
      function execute(this: { value: UserTask }): UserResult {
        return Effect.runSync(this.value);
      }
      const bound = execute.bind({ value: Effect.succeed(user) });
      supplied = void 0;
      bound.apply({ value: task }, []);
    `),
  },
];

const ownCallCases: readonly ReceiverBindingCase[] = [
  {
    name: 'honors an own no-op call property on a callable',
    reports: 0,
    source: runtimeSource(`
      function execute(this: { value: UserTask }): UserResult {
        return Effect.runSync(this.value);
      }
      const custom = Object.defineProperty(execute, "call", {
        value(_receiver: { value: UserTask }): typeof user {
          return user;
        },
      });
      supplied = void 0;
      custom.call({ value: task });
    `),
  },
  {
    name: 'executes an own forwarding call property on a callable',
    reports: 1,
    source: runtimeSource(`
      function execute(this: { value: UserTask }): UserResult {
        return user;
      }
      const custom = Object.defineProperty(execute, "call", {
        value(receiver: { value: UserTask }): UserResult {
          return Effect.runSync(receiver.value);
        },
      });
      supplied = void 0;
      custom.call({ value: task });
    `),
  },
];

const undefinedReceiverCases: readonly ReceiverBindingCase[] = [
  {
    name: 'does not leak an earlier bound receiver into a direct undefined call',
    reports: 0,
    source: runtimeSource(`
      function execute(this: { value?: UserTask } | undefined): UserResult {
        return this?.value ? Effect.runSync(this.value) : user;
      }
      const unused = execute.bind({ value: task });
      void unused;
      supplied = void 0;
      execute.call(undefined);
    `),
  },
  {
    name: 'keeps explicit undefined as the first bound receiver',
    reports: 0,
    source: runtimeSource(`
      function execute(this: { value?: UserTask } | undefined): UserResult {
        return this?.value ? Effect.runSync(this.value) : user;
      }
      const bound = execute.bind(undefined).bind({ value: task });
      supplied = void 0;
      bound();
    `),
  },
  {
    name: 'allows an initially unbound callable to bind an unsafe receiver',
    reports: 1,
    source: runtimeSource(`
      function execute(this: { value?: UserTask } | undefined): UserResult {
        return this?.value ? Effect.runSync(this.value) : user;
      }
      const bound = execute.bind({ value: task });
      supplied = void 0;
      bound();
    `),
  },
];

const callableChoiceCompletionCases: readonly ReceiverBindingCase[] = [
  {
    name: 'does not continue after an undefined-or-callable invocation choice',
    reports: 0,
    source: runtimeSource(`
      declare const condition: boolean;
      const selected: (() => typeof user) | undefined = condition
        ? undefined
        : () => user;
      selected!();
      supplied = void 0;
      Effect.runSync(task);
    `),
  },
  {
    name: 'does not continue after a callable-or-undefined invocation choice',
    reports: 0,
    source: runtimeSource(`
      declare const condition: boolean;
      const selected: (() => typeof user) | undefined = condition
        ? () => user
        : undefined;
      selected!();
      supplied = void 0;
      Effect.runSync(task);
    `),
  },
  {
    name: 'continues after a choice between two callable alternatives',
    reports: 1,
    source: runtimeSource(`
      declare const condition: boolean;
      const selected = condition ? () => user : () => user;
      selected();
      supplied = void 0;
      Effect.runSync(task);
    `),
  },
  {
    name: 'does not continue after an exact undefined invocation choice',
    reports: 0,
    source: runtimeSource(`
      declare const condition: boolean;
      function select(): (() => typeof user) | undefined {
        return condition ? undefined : undefined;
      }
      select()!();
      supplied = void 0;
      Effect.runSync(task);
    `),
  },
];

const callableChoiceCorrelationCases: readonly ReceiverBindingCase[] = [
  {
    name: 'correlates callable success and undefined failure through catch',
    reports: 0,
    source: runtimeSource(`
      declare const condition: boolean;
      const callableTask: UserTask = Effect.sync(() => load(supplied));
      const catchTask: UserTask = Effect.sync(() => load(supplied));
      const selected: (() => UserResult) | undefined = condition
        ? () => Effect.runSync(callableTask)
        : undefined;
      supplied = void 0;
      try {
        selected!();
      } catch {
        Effect.runSync(catchTask);
      }
      void task;
    `),
  },
  {
    name: 'correlates undefined failure and callable success through catch',
    reports: 0,
    source: runtimeSource(`
      declare const condition: boolean;
      const callableTask: UserTask = Effect.sync(() => load(supplied));
      const catchTask: UserTask = Effect.sync(() => load(supplied));
      const selected: (() => UserResult) | undefined = condition
        ? undefined
        : () => Effect.runSync(callableTask);
      supplied = void 0;
      try {
        selected!();
      } catch {
        Effect.runSync(catchTask);
      }
      void task;
    `),
  },
];

const cases = [
  ...ordinaryReceiverCases,
  ...namedOrdinaryReceiverCases,
  ...repeatedBindCases,
  ...boundOverrideCases,
  ...ownCallCases,
  ...undefinedReceiverCases,
  ...callableChoiceCompletionCases,
  ...callableChoiceCorrelationCases,
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
    cases.map(({ source }, index): readonly [string, string] => [
      `${directory}runtime-receiver-binding-${index}.fixture.ts`,
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
    if (source !== undefined) {
      return ts.createSourceFile(filename, source, languageVersion, true);
    }
    return getSourceFile(filename, languageVersion, onError, shouldCreateNewSourceFile);
  };
  host.readFile = (filename): string | undefined => sources.get(filename) ?? readFile(filename);
  return ts
    .getPreEmitDiagnostics(ts.createProgram([...sources.keys()], options, host))
    .map((diagnostic): string => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
};

const expectReceiverBinding = ({ reports, representative, source }: ReceiverBindingCase): void => {
  expect(
    parseSync('runtime-receiver-binding.ts', source, { sourceType: 'module' }).errors,
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

describe('effect-no-sync-for-promise receiver and binding semantics', (): void => {
  it.each(cases)('$name', (testCase): void => {
    expect.hasAssertions();
    expectReceiverBinding(testCase);
  });

  it('type-checks every receiver binding fixture in strict mode', (): void => {
    expect(strictTypeScriptDiagnostics()).toEqual([]);
  }, 30_000);
});
