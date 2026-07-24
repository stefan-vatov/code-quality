import { describe, expect, it } from 'vitest';
import { parseSync } from 'oxc-parser';
import { runRule } from './effect-rule-test-utils';
import theThracianOxlint from '../../src/index';
import ts from 'typescript';

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
): RuntimeControlCase => ({
  name,
  reports,
  representative,
  source: runtimeSource(execution),
});

const unknownControlCases: readonly RuntimeControlCase[] = [
  runtimeCase(
    'does not prove the unknown logical AND right operand executes',
    0,
    'declare const condition: boolean; condition && Effect.runSync(task);',
  ),
  runtimeCase(
    'does not prove the unknown logical OR right operand executes',
    0,
    'declare const condition: boolean; condition || Effect.runSync(task);',
  ),
  runtimeCase(
    'does not prove one arm of an unknown conditional executes',
    0,
    'declare const condition: boolean; condition ? Effect.runSync(task) : user;',
  ),
  runtimeCase(
    'does not prove one arm of an unknown if executes',
    0,
    'declare const condition: boolean; if (condition) { Effect.runSync(task); }',
  ),
  runtimeCase(
    'proves execution when both unknown conditional arms run the task',
    1,
    'declare const condition: boolean; condition ? Effect.runSync(task) : Effect.runSync(task);',
    true,
  ),
  runtimeCase(
    'proves execution when both unknown if arms run the task',
    1,
    `
      declare const condition: boolean;
      if (condition) {
        Effect.runSync(task);
      } else {
        Effect.runSync(task);
      }
    `,
  ),
];

const abruptCompletionCases: readonly RuntimeControlCase[] = [
  runtimeCase(
    'stops after a helper throws before the task run',
    0,
    `
      function stop(): never { throw new Error("stop"); }
      stop();
      Effect.runSync(task);
    `,
  ),
  runtimeCase(
    'records a task run before a helper throws',
    1,
    `
      function stop(): never { throw new Error("stop"); }
      Effect.runSync(task);
      stop();
    `,
  ),
  runtimeCase(
    'propagates a nested helper throw before the task run',
    0,
    `
      function stop(): never { throw new Error("stop"); }
      function nested(): never { return stop(); }
      nested();
      Effect.runSync(task);
    `,
  ),
  runtimeCase(
    'stops argument evaluation when the first argument throws',
    0,
    `
      function stop(): never { throw new Error("stop"); }
      function consume(_first: unknown, _second: unknown): void {}
      consume(stop(), Effect.runSync(task));
    `,
  ),
  runtimeCase(
    'continues after an ordinarily returning helper',
    1,
    `
      function done(): void { return; }
      done();
      Effect.runSync(task);
    `,
  ),
  runtimeCase(
    'records a task run evaluated before a throwing argument',
    1,
    `
      function stop(): never { throw new Error("stop"); }
      function consume(_first: unknown, _second: unknown): void {}
      consume(Effect.runSync(task), stop());
    `,
  ),
];

const loopAndSwitchCases: readonly RuntimeControlCase[] = [
  runtimeCase(
    'does not execute the body of while false',
    0,
    'while (false) { Effect.runSync(task); }',
  ),
  runtimeCase(
    'executes the body of do while false once',
    1,
    'do { Effect.runSync(task); } while (false);',
  ),
  runtimeCase(
    'executes the selected iteration of while true',
    1,
    'while (true) { Effect.runSync(task); break; }',
  ),
  runtimeCase(
    'continues after a mutable while condition becomes false',
    1,
    'let flag = true; while (flag) { flag = false; } Effect.runSync(task);',
  ),
  runtimeCase(
    'does not execute the body of for false',
    0,
    'for (; false; ) { Effect.runSync(task); }',
  ),
  runtimeCase(
    'executes the selected iteration of for true',
    1,
    'for (; true; ) { Effect.runSync(task); break; }',
  ),
  runtimeCase(
    'does not reach a task run after continue',
    0,
    'while (true) { continue; Effect.runSync(task); }',
  ),
  runtimeCase(
    'does not prove an unknown while loop executes',
    0,
    `
      declare const condition: boolean;
      while (condition) {
        Effect.runSync(task);
        break;
      }
    `,
  ),
  runtimeCase(
    'does not execute an unselected switch case',
    0,
    `
      let selection: number = 0;
      switch (selection) {
        case 1: Effect.runSync(task); break;
        default: break;
      }
    `,
  ),
  runtimeCase(
    'executes the selected switch case',
    1,
    `
      let selection: number = 1;
      switch (selection) {
        case 1: Effect.runSync(task); break;
        default: break;
      }
    `,
  ),
  runtimeCase(
    'does not prove one unsafe case of an unknown switch executes',
    0,
    `
      declare const selection: number;
      switch (selection) {
        case 1: Effect.runSync(task); break;
        default: break;
      }
    `,
  ),
  runtimeCase(
    'proves execution when every arm of an unknown switch runs the task',
    1,
    `
      declare const selection: number;
      switch (selection) {
        case 1: Effect.runSync(task); break;
        default: Effect.runSync(task); break;
      }
    `,
  ),
  runtimeCase(
    'does not execute a catch clause when the try completes normally',
    0,
    'try { void user; } catch { Effect.runSync(task); }',
  ),
  runtimeCase(
    'executes a catch clause when the try definitely throws',
    1,
    'try { throw new Error("stop"); } catch { Effect.runSync(task); }',
  ),
];

const recursionCases: readonly RuntimeControlCase[] = [
  runtimeCase(
    'does not reach a task after exact self recursion',
    0,
    `
      function recurse(): never { return recurse(); }
      recurse();
      Effect.runSync(task);
    `,
  ),
  runtimeCase(
    'does not reach a task after exact mutual recursion',
    0,
    `
      function first(): never { return second(); }
      function second(): never { return first(); }
      first();
      Effect.runSync(task);
    `,
  ),
  runtimeCase(
    'reaches a base case after a self-recursive argument changes',
    1,
    `
      function recurse(shouldContinue: boolean): UserResult {
        if (shouldContinue) {
          return recurse(false);
        }
        return Effect.runSync(task);
      }
      recurse(true);
    `,
  ),
  runtimeCase(
    'reaches a base case after a mutually recursive argument changes',
    1,
    `
      function first(shouldContinue: boolean): UserResult {
        return shouldContinue ? second(false) : Effect.runSync(task);
      }
      function second(shouldContinue: boolean): UserResult {
        return shouldContinue ? first(false) : Effect.runSync(task);
      }
      first(true);
    `,
  ),
];

const truthinessCases: readonly RuntimeControlCase[] = [
  runtimeCase('treats NaN as falsy for logical AND', 0, 'NaN && Effect.runSync(task);'),
  runtimeCase('treats NaN as falsy for logical OR', 1, 'NaN || Effect.runSync(task);'),
  runtimeCase('short-circuits logical OR for Infinity', 0, 'Infinity || Effect.runSync(task);'),
  runtimeCase('evaluates logical AND for Infinity', 1, 'Infinity && Effect.runSync(task);'),
  runtimeCase(
    'treats unary positive zero as falsy for logical AND',
    0,
    '+0 && Effect.runSync(task);',
  ),
  runtimeCase(
    'treats unary positive zero as falsy for logical OR',
    1,
    '+0 || Effect.runSync(task);',
  ),
  runtimeCase('treats negative zero as falsy for logical AND', 0, '-0 && Effect.runSync(task);'),
  runtimeCase('treats negative one as truthy for logical AND', 1, '-1 && Effect.runSync(task);'),
];

const branchEvents = (whenTrue: string, whenFalse: string): string => `
  declare const condition: boolean;
  if (condition) { ${whenTrue} } else { ${whenFalse} }
`;
const safeRun = 'supplied = user; Effect.runSync(task);';
const unsafeRun = 'supplied = void 0; Effect.runSync(task);';
const sameTaskJoinCases: readonly RuntimeControlCase[] = [
  runtimeCase(
    'reports when both branches run the same task safely then unsafely',
    1,
    branchEvents(`${safeRun} ${unsafeRun}`, `${safeRun} ${unsafeRun}`),
  ),
  runtimeCase(
    'reports mixed safe-unsafe and unsafe-safe sequences of the same task',
    1,
    branchEvents(`${safeRun} ${unsafeRun}`, `${unsafeRun} ${safeRun}`),
  ),
  runtimeCase(
    'does not report when both branches run the same task only safely',
    0,
    branchEvents(`${safeRun} ${safeRun}`, `${safeRun} ${safeRun}`),
  ),
  runtimeCase(
    'does not report when an unsafe same-task event is not guaranteed',
    0,
    branchEvents(`${safeRun} ${unsafeRun}`, `${safeRun} ${safeRun}`),
  ),
];

const cases = [
  ...unknownControlCases,
  ...abruptCompletionCases,
  ...loopAndSwitchCases,
  ...recursionCases,
  ...truthinessCases,
  ...sameTaskJoinCases,
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
      `${process.cwd()}/ts/test/rules/runtime-control-${index}.ts`,
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
    if (fileName && sources.has(fileName)) {
      const source = sources.get(fileName);
      const existing = source === undefined ? undefined : messages.get(source);
      if (source !== undefined) {
        messages.set(source, [
          ...(existing ?? []),
          ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
        ]);
      }
    }
  }
  return messages;
};

const strictDiagnostics = compileStrictFixtures();

const expectRuntimeControl = ({ reports, representative, source }: RuntimeControlCase): void => {
  expect(parseSync('runtime-control.ts', source, { sourceType: 'module' }).errors).toHaveLength(0);
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

describe('effect-no-sync-for-promise adversarial runtime control', (): void => {
  it.each(cases)('$name', expectRuntimeControl);
});
