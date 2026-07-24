import { describe, expect, it } from 'vitest';
import { parseSync } from 'oxc-parser';
import { runRule } from './effect-rule-test-utils';
import theThracianOxlint from '../../src/index';
import ts from 'typescript';

interface TryCompletionCase {
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
  function load(value: UserResult = Promise.resolve(user)): UserResult {
    return value;
  }
  let supplied: UserResult = user;
  const task = ${syncExpression};
  supplied = void 0;
  ${execution}
`;

const runtimeCase = (
  name: string,
  reports: 0 | 1,
  execution: string,
  representative = false,
): TryCompletionCase => ({
  name,
  reports,
  representative,
  source: runtimeSource(execution),
});

const cases: readonly TryCompletionCase[] = [
  runtimeCase(
    'does not reach a task when finally throws over a try return',
    0,
    `
      function stop(): void {
        try {
          return;
        } finally {
          throw new Error("stop");
        }
      }
      stop();
      Effect.runSync(task);
    `,
  ),
  runtimeCase(
    'does not reach a task after an uncaught try throw passes through finally',
    0,
    `
      try {
        throw new Error("stop");
      } finally {
        void user;
      }
      Effect.runSync(task);
    `,
  ),
  runtimeCase(
    'does not reach a task after a catch clause rethrows',
    0,
    `
      try {
        throw new Error("first");
      } catch {
        throw new Error("second");
      }
      Effect.runSync(task);
    `,
  ),
  runtimeCase(
    'reaches a task after a catch clause handles a throw',
    1,
    `
      try {
        throw new Error("handled");
      } catch {
        void user;
      }
      Effect.runSync(task);
    `,
    true,
  ),
  runtimeCase(
    'reaches a task after a normally completing try and finally',
    1,
    `
      try {
        void user;
      } finally {
        void user;
      }
      Effect.runSync(task);
    `,
  ),
  runtimeCase(
    'records a task run in the first case test of an unknown switch',
    1,
    `
      declare const selection: number;
      function probe(): number {
        Effect.runSync(task);
        return 1;
      }
      switch (selection) {
        case probe(): break;
        default: break;
      }
    `,
  ),
  runtimeCase(
    'does not reach a default task after a selected case test throws',
    0,
    `
      function stop(): never { throw new Error("stop"); }
      switch (0) {
        case stop(): break;
        default: Effect.runSync(task); break;
      }
    `,
  ),
  runtimeCase(
    'reaches a selected case body after its test completes normally',
    1,
    `
      function selected(): number { return 1; }
      switch (1) {
        case selected(): Effect.runSync(task); break;
        default: break;
      }
    `,
  ),
  runtimeCase(
    'does not execute a nonselected case when its test completes normally',
    0,
    `
      function other(): number { return 1; }
      switch (0) {
        case other(): Effect.runSync(task); break;
        default: void user; break;
      }
    `,
  ),
  runtimeCase(
    'does not execute a for-of body for an empty tuple',
    0,
    `
      for (const value of [] as const) {
        void value;
        Effect.runSync(task);
      }
    `,
  ),
  runtimeCase(
    'executes a for-of body for a one-element tuple',
    1,
    `
      for (const value of [user] as const) {
        void value;
        Effect.runSync(task);
      }
    `,
  ),
  runtimeCase(
    'does not reach a task after breaking from its labeled block',
    0,
    `
      boundary: {
        break boundary;
        Effect.runSync(task);
      }
    `,
  ),
  runtimeCase(
    'reaches a task in a normally completing labeled block',
    1,
    `
      boundary: {
        void user;
        Effect.runSync(task);
      }
    `,
  ),
];

const compileStrictFixtures = (): ReadonlyMap<string, readonly string[]> => {
  const options: ts.CompilerOptions = {
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    noEmit: true,
    skipLibCheck: true,
    strict: true,
    target: ts.ScriptTarget.ES2022,
  };
  const sources = new Map(
    cases.map(({ source }, index): [string, string] => [
      `${process.cwd()}/ts/test/rules/runtime-try-completion-${index}.ts`,
      source,
    ]),
  );
  const host = ts.createCompilerHost(options, true);
  const readFile = host.readFile.bind(host);
  const fileExists = host.fileExists.bind(host);
  const getSourceFile = host.getSourceFile.bind(host);
  host.fileExists = (fileName): boolean => sources.has(fileName) || fileExists(fileName);
  host.readFile = (fileName): string | undefined => sources.get(fileName) ?? readFile(fileName);
  host.getSourceFile = (fileName, languageVersion, onError, shouldCreateNewSourceFile) => {
    const source = sources.get(fileName);
    if (source === undefined) {
      return getSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile);
    }
    return ts.createSourceFile(fileName, source, languageVersion, true);
  };
  const program = ts.createProgram({ host, options, rootNames: [...sources.keys()] });
  const messages = new Map<string, string[]>();
  for (const diagnostic of ts.getPreEmitDiagnostics(program)) {
    const fileName = diagnostic.file?.fileName;
    const source = fileName === undefined ? undefined : sources.get(fileName);
    if (source !== undefined) {
      messages.set(source, [
        ...(messages.get(source) ?? []),
        ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
      ]);
    }
  }
  return messages;
};

const strictDiagnostics = compileStrictFixtures();

const expectTryCompletion = ({ reports, representative, source }: TryCompletionCase): void => {
  expect(
    parseSync('runtime-try-completion.ts', source, { sourceType: 'module' }).errors,
  ).toHaveLength(0);
  expect(strictDiagnostics.get(source) ?? []).toEqual([]);
  const actualReports = runRule(ruleName, source);
  expect(actualReports).toHaveLength(reports);
  if (!representative || reports !== 1 || actualReports.length !== 1) {
    return;
  }

  expect.soft(theThracianOxlint().rules).toHaveProperty(ruleID, 'error');
  const [report] = actualReports;
  expect(report).toBeDefined();
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

describe('effect-no-sync-for-promise adversarial try completion', (): void => {
  it.each(cases)('$name', expectTryCompletion);
});
