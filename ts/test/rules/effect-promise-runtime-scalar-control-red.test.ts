import { describe, expect, it } from 'vitest';
import { parseSync } from 'oxc-parser';
import { runRule } from './effect-rule-test-utils';
import ts from 'typescript';

interface RuntimeScalarControlCase {
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
): RuntimeScalarControlCase => ({
  name,
  reports,
  representative,
  source: runtimeSource(execution),
});

const loopCases: readonly RuntimeScalarControlCase[] = [
  runtimeCase(
    'executes one iteration of while with an exact true literal comparison',
    1,
    'while (1 < 2) { Effect.runSync(task); break; }',
    true,
  ),
  runtimeCase(
    'skips while with an exact false literal comparison',
    0,
    'while (2 < 1) { Effect.runSync(task); }',
  ),
  runtimeCase(
    'executes one bounded for iteration with exact numeric state',
    1,
    'for (let i = 0; i < 1; i++) { Effect.runSync(task); }',
  ),
  runtimeCase(
    'skips a bounded for body whose exact initial comparison is false',
    0,
    'for (let i = 0; i < 0; i++) { Effect.runSync(task); }',
  ),
  runtimeCase(
    'continues after an exact bounded for update terminates the loop',
    1,
    'for (let i = 0; i < 1; i++) {} Effect.runSync(task);',
  ),
  runtimeCase(
    'does not continue after an exact for condition stays true without an update',
    0,
    'for (let i = 0; i < 1; ) {} Effect.runSync(task);',
  ),
  runtimeCase(
    'continues after an exact while body update terminates the loop',
    1,
    'let i = 0; while (i < 1) { i += 1; } Effect.runSync(task);',
  ),
  runtimeCase(
    'does not continue after an exact while condition stays true without an update',
    0,
    'let i = 0; while (i < 1) {} Effect.runSync(task);',
  ),
  runtimeCase(
    'executes for-in over an exact nonempty object literal',
    1,
    'for (const key in { user }) { void key; Effect.runSync(task); }',
  ),
  runtimeCase(
    'skips for-in over an exact empty object literal',
    0,
    'for (const key in {}) { void key; Effect.runSync(task); }',
  ),
];

const switchCases: readonly RuntimeScalarControlCase[] = [
  runtimeCase(
    'selects an exact undefined switch case',
    1,
    `
      switch (undefined) {
        case undefined: Effect.runSync(task); break;
        default: break;
      }
    `,
  ),
  runtimeCase(
    'skips a mismatched case for exact undefined',
    0,
    `
      switch (undefined as unknown) {
        case null: Effect.runSync(task); break;
        default: break;
      }
    `,
  ),
  runtimeCase(
    'selects an exact null switch case',
    1,
    `
      switch (null) {
        case null: Effect.runSync(task); break;
        default: break;
      }
    `,
  ),
  runtimeCase(
    'skips a mismatched case for exact null',
    0,
    `
      switch (null as unknown) {
        case undefined: Effect.runSync(task); break;
        default: break;
      }
    `,
  ),
  runtimeCase(
    'selects an exact boolean switch case',
    1,
    `
      switch (true) {
        case true: Effect.runSync(task); break;
        default: break;
      }
    `,
  ),
  runtimeCase(
    'skips a mismatched case for an exact boolean',
    0,
    `
      switch (true as unknown) {
        case false: Effect.runSync(task); break;
        default: break;
      }
    `,
  ),
  runtimeCase(
    'selects an exact string switch case',
    1,
    `
      switch ("selected") {
        case "selected": Effect.runSync(task); break;
        default: break;
      }
    `,
  ),
  runtimeCase(
    'skips a mismatched case for an exact string',
    0,
    `
      switch ("selected" as unknown) {
        case "other": Effect.runSync(task); break;
        default: break;
      }
    `,
  ),
  runtimeCase(
    'selects an exact numeric switch case',
    1,
    `
      switch (1) {
        case 1: Effect.runSync(task); break;
        default: break;
      }
    `,
  ),
  runtimeCase(
    'skips a mismatched case for an exact number',
    0,
    `
      switch (1 as unknown) {
        case 2: Effect.runSync(task); break;
        default: break;
      }
    `,
  ),
];

const cases = [...loopCases, ...switchCases];

const compileStrictFixtures = (): ReadonlyMap<string, readonly string[]> => {
  const options: ts.CompilerOptions = {
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    noEmit: true,
    skipLibCheck: true,
    strict: true,
    target: ts.ScriptTarget.ES2022,
  };
  const fixtureDirectory = new URL('.', import.meta.url).pathname;
  const sources = new Map(
    cases.map(({ source }, index): [string, string] => [
      `${fixtureDirectory}runtime-scalar-control-${index}.ts`,
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
    if (!fileName || !sources.has(fileName)) {
      continue;
    }
    const source = sources.get(fileName);
    if (source) {
      messages.set(source, [
        ...(messages.get(source) ?? []),
        ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
      ]);
    }
  }
  return messages;
};

const strictDiagnostics = compileStrictFixtures();

const expectRuntimeScalarControl = ({
  reports,
  representative,
  source,
}: RuntimeScalarControlCase): void => {
  expect(parseSync('runtime-scalar-control.ts', source, { sourceType: 'module' }).errors).toEqual(
    [],
  );
  expect(strictDiagnostics.get(source) ?? []).toEqual([]);

  const actualReports = runRule(ruleName, source);
  expect(actualReports).toHaveLength(reports);
  if (!representative || reports !== 1 || actualReports.length !== 1) {
    return;
  }

  const report = actualReports[0];
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

describe('effect-no-sync-for-promise exact scalar runtime control', (): void => {
  it.each(cases)('$name', expectRuntimeScalarControl);
});
