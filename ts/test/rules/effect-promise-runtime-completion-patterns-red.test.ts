import { describe, expect, it } from 'vitest';
import { parseSync } from 'oxc-parser';
import { runRule } from './effect-rule-test-utils';
import theThracianOxlint from '../../src/index';
import ts from 'typescript';

interface CompletionPatternCase {
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
): CompletionPatternCase => ({
  name,
  reports,
  representative,
  source: runtimeSource(execution),
});

const tryCompletionCases: readonly CompletionPatternCase[] = [
  runtimeCase(
    'does not execute finally after an exactly nonterminating try',
    0,
    `
      try {
        while (true) {}
      } finally {
        Effect.runSync(task);
      }
    `,
  ),
  runtimeCase(
    'executes finally after a terminating try',
    1,
    `
      try {
        void user;
      } finally {
        Effect.runSync(task);
      }
    `,
    true,
  ),
  runtimeCase(
    'does not prove finally executes after mixed normal and nonterminating paths',
    0,
    `
      declare const condition: boolean;
      try {
        if (condition) {
          while (true) {}
        } else {
          void user;
        }
      } finally {
        Effect.runSync(task);
      }
    `,
  ),
  runtimeCase(
    'executes finally when every unknown branch completes normally',
    1,
    `
      declare const condition: boolean;
      try {
        if (condition) {
          void user;
        } else {
          void user;
        }
      } finally {
        Effect.runSync(task);
      }
    `,
  ),
  runtimeCase(
    'binds a thrown task to its catch parameter',
    1,
    `
      try {
        throw task;
      } catch (value) {
        Effect.runSync(value as typeof task);
      }
    `,
  ),
  runtimeCase(
    'does not select an unthrown unsafe task through a safe catch value',
    0,
    `
      try {
        throw Effect.succeed(user);
      } catch (value) {
        Effect.runSync(value as typeof task);
      }
    `,
  ),
  runtimeCase(
    'binds a thrown task through a structured catch parameter',
    1,
    `
      try {
        throw { value: task };
      } catch ({ value }: any) {
        Effect.runSync(value);
      }
    `,
  ),
  runtimeCase(
    'keeps an unsafe task separate from a safe structured catch value',
    0,
    `
      try {
        throw { value: Effect.succeed(user) };
      } catch ({ value }: any) {
        Effect.runSync(value);
      }
    `,
  ),
  runtimeCase(
    'continues after either normal try completion or a handled throw',
    1,
    `
      declare const condition: boolean;
      try {
        if (condition) {
          throw new Error("handled");
        }
      } catch {
        void user;
      }
      Effect.runSync(task);
    `,
  ),
  runtimeCase(
    'retains a guaranteed task run split between the normal and catch paths',
    1,
    `
      declare const condition: boolean;
      try {
        if (condition) {
          throw new Error("handled");
        }
        Effect.runSync(task);
      } catch {
        Effect.runSync(task);
      }
    `,
  ),
];

const helperCompletionCases: readonly CompletionPatternCase[] = [
  runtimeCase(
    'continues after a helper that optionally returns or falls through',
    1,
    `
      declare const condition: boolean;
      function finishOptionally(value: boolean): void {
        if (value) {
          return;
        }
      }
      finishOptionally(condition);
      Effect.runSync(task);
    `,
  ),
  runtimeCase(
    'does not prove continuation after a helper that optionally throws',
    0,
    `
      declare const condition: boolean;
      function throwOptionally(value: boolean): void {
        if (value) {
          throw new Error("stop");
        }
      }
      throwOptionally(condition);
      Effect.runSync(task);
    `,
  ),
];

const destructuringCases: readonly CompletionPatternCase[] = [
  runtimeCase(
    'runs a task selected by local object destructuring',
    1,
    'const { value } = { value: task }; Effect.runSync(value);',
  ),
  runtimeCase(
    'keeps an unsafe task separate from safe local object destructuring',
    0,
    'const { value } = { value: Effect.succeed(user) }; Effect.runSync(value);',
  ),
  runtimeCase(
    'runs a task selected by local array destructuring',
    1,
    'const [value] = [task] as const; Effect.runSync(value);',
  ),
  runtimeCase(
    'keeps an unsafe task separate from safe local array destructuring',
    0,
    'const [value] = [Effect.succeed(user)] as const; Effect.runSync(value);',
  ),
  runtimeCase(
    'runs a task selected through local object rest destructuring',
    1,
    'const { ...rest } = { value: task }; Effect.runSync(rest.value);',
  ),
  runtimeCase(
    'keeps an unsafe task separate from safe local rest destructuring',
    0,
    'const { ...rest } = { value: Effect.succeed(user) }; Effect.runSync(rest.value);',
  ),
  runtimeCase(
    'runs a task selected through local array-rest destructuring',
    1,
    `
      const [first, ...rest] = [user, task] as const;
      void first;
      Effect.runSync(rest[0]);
    `,
  ),
  runtimeCase(
    'keeps an unsafe task separate from safe local array-rest destructuring',
    0,
    `
      const [first, ...rest] = [user, Effect.succeed(user)] as const;
      void first;
      Effect.runSync(rest[0]);
    `,
  ),
  runtimeCase(
    'uses a task from a local object destructuring default',
    1,
    `
      const { value = task }: { value?: typeof task } = {};
      Effect.runSync(value);
    `,
  ),
  runtimeCase(
    'uses a supplied safe value instead of a local destructuring default task',
    0,
    `
      const { value = task }: { value?: typeof task } = {
        value: Effect.succeed(user),
      };
      Effect.runSync(value);
    `,
  ),
];

const iterationAndSpreadCases: readonly CompletionPatternCase[] = [
  runtimeCase(
    'binds a task through a for-of declaration object pattern',
    1,
    `
      for (const { value } of [{ value: task }] as const) {
        Effect.runSync(value);
      }
    `,
  ),
  runtimeCase(
    'keeps an unsafe task separate from a safe for-of object pattern',
    0,
    `
      for (const { value } of [{ value: Effect.succeed(user) }] as const) {
        Effect.runSync(value);
      }
    `,
  ),
  runtimeCase(
    'expands an exact task tuple into a helper call',
    1,
    `
      function execute(value: typeof task): UserResult {
        return Effect.runSync(value);
      }
      execute(...[task]);
    `,
  ),
  runtimeCase(
    'keeps an unsafe task separate from an exact safe call spread',
    0,
    `
      function execute(value: typeof task): UserResult {
        return Effect.runSync(value);
      }
      execute(...[Effect.succeed(user)]);
    `,
  ),
];

const cases = [
  ...tryCompletionCases,
  ...helperCompletionCases,
  ...destructuringCases,
  ...iterationAndSpreadCases,
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
      `${process.cwd()}/ts/test/rules/runtime-completion-pattern-${index}.ts`,
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

const expectCompletionPattern = ({
  reports,
  representative,
  source,
}: CompletionPatternCase): void => {
  expect(
    parseSync('runtime-completion-pattern.ts', source, { sourceType: 'module' }).errors,
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

describe('effect-no-sync-for-promise completion and binding patterns', (): void => {
  it.each(cases)('$name', expectCompletionPattern);
});
