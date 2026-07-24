import { describe, expect, it } from 'vitest';
import { parseSync } from 'oxc-parser';
import { runRule } from './effect-rule-test-utils';
import ts from 'typescript';

interface AssignmentPatternCase {
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
  const safe = Effect.succeed(user) as typeof task;
  supplied = void 0;
  ${execution}
`;

const runtimeCase = (
  name: string,
  reports: 0 | 1,
  execution: string,
  representative = false,
): AssignmentPatternCase => ({
  name,
  reports,
  representative,
  source: runtimeSource(execution),
});

const logicalAssignmentCases: readonly AssignmentPatternCase[] = [
  runtimeCase(
    'assigns a task through nullish assignment when the target is undefined',
    1,
    `
      let selected: typeof task | undefined = undefined;
      selected ??= task;
      Effect.runSync(selected as typeof task);
    `,
    true,
  ),
  runtimeCase(
    'keeps an existing safe value through nullish assignment',
    0,
    `
      let selected: typeof task | undefined = safe;
      selected ??= task;
      Effect.runSync(selected as typeof task);
    `,
  ),
  runtimeCase(
    'replaces a truthy task with a safe value through logical and assignment',
    0,
    `
      let selected: typeof task | undefined = task;
      selected &&= safe;
      Effect.runSync(selected as typeof task);
    `,
  ),
  runtimeCase(
    'does not assign a task through logical and assignment when undefined',
    0,
    `
      let selected: typeof task | undefined = undefined;
      selected &&= task;
      Effect.runSync(selected as typeof task);
    `,
  ),
  runtimeCase(
    'keeps a truthy safe value through logical or assignment',
    0,
    `
      let selected: typeof task | undefined = safe;
      selected ||= task;
      Effect.runSync(selected as typeof task);
    `,
  ),
  runtimeCase(
    'assigns a task through logical or assignment when undefined',
    1,
    `
      let selected: typeof task | undefined = undefined;
      selected ||= task;
      Effect.runSync(selected as typeof task);
    `,
  ),
];

const memberLogicalAssignmentCases: readonly AssignmentPatternCase[] = [
  runtimeCase(
    'assigns a task through nullish assignment to an undefined member',
    1,
    `
      const holder: { value?: typeof task } = {};
      holder.value ??= task;
      Effect.runSync(holder.value as typeof task);
    `,
  ),
  runtimeCase(
    'keeps an existing safe member through nullish assignment',
    0,
    `
      const holder: { value?: typeof task } = { value: safe };
      holder.value ??= task;
      Effect.runSync(holder.value as typeof task);
    `,
  ),
  runtimeCase(
    'replaces a truthy task member with a safe logical and assignment',
    0,
    `
      const holder: { value?: typeof task } = { value: task };
      holder.value &&= safe;
      Effect.runSync(holder.value as typeof task);
    `,
  ),
  runtimeCase(
    'does not assign a task member through logical and assignment when undefined',
    0,
    `
      const holder: { value?: typeof task } = {};
      holder.value &&= task;
      Effect.runSync(holder.value as typeof task);
    `,
  ),
  runtimeCase(
    'assigns a task through logical or assignment to an undefined member',
    1,
    `
      const holder: { value?: typeof task } = {};
      holder.value ||= task;
      Effect.runSync(holder.value as typeof task);
    `,
  ),
  runtimeCase(
    'keeps a truthy safe member through logical or assignment',
    0,
    `
      const holder: { value?: typeof task } = { value: safe };
      holder.value ||= task;
      Effect.runSync(holder.value as typeof task);
    `,
  ),
  runtimeCase(
    'keeps a truthy task member through logical or assignment',
    1,
    `
      const holder: { value?: typeof task } = { value: task };
      holder.value ||= safe;
      Effect.runSync(holder.value as typeof task);
    `,
  ),
];

const objectAndArrayCases: readonly AssignmentPatternCase[] = [
  runtimeCase(
    'assigns a task through an object destructuring assignment',
    1,
    `
      let selected = safe;
      ({ value: selected } = { value: task });
      Effect.runSync(selected);
    `,
  ),
  runtimeCase(
    'replaces a task with a safe object destructuring assignment',
    0,
    `
      let selected = task;
      ({ value: selected } = { value: safe });
      Effect.runSync(selected);
    `,
  ),
  runtimeCase(
    'assigns a task through an array destructuring assignment',
    1,
    `
      let selected = safe;
      [selected] = [task];
      Effect.runSync(selected);
    `,
  ),
  runtimeCase(
    'replaces a task with a safe array destructuring assignment',
    0,
    `
      let selected = task;
      [selected] = [safe];
      Effect.runSync(selected);
    `,
  ),
  runtimeCase(
    'assigns a task through an object rest assignment',
    1,
    `
      let rest = { value: safe };
      ({ ...rest } = { value: task });
      Effect.runSync(rest.value);
    `,
  ),
  runtimeCase(
    'replaces a task through a safe object rest assignment',
    0,
    `
      let rest = { value: task };
      ({ ...rest } = { value: safe });
      Effect.runSync(rest.value);
    `,
  ),
  runtimeCase(
    'assigns a task through an array rest assignment',
    1,
    `
      let rest: Array<typeof task> = [safe];
      [...rest] = [task];
      Effect.runSync(rest[0] as typeof task);
    `,
  ),
  runtimeCase(
    'replaces a task through a safe array rest assignment',
    0,
    `
      let rest: Array<typeof task> = [task];
      [...rest] = [safe];
      Effect.runSync(rest[0] as typeof task);
    `,
  ),
];

const defaultAndComputedCases: readonly AssignmentPatternCase[] = [
  runtimeCase(
    'uses a task default in an assignment pattern for an undefined property',
    1,
    `
      let selected: typeof task | undefined = undefined;
      ({ value: selected = task } = {} as { value?: typeof task });
      Effect.runSync(selected as typeof task);
    `,
  ),
  runtimeCase(
    'uses a supplied safe value instead of an assignment pattern default',
    0,
    `
      let selected: typeof task | undefined = undefined;
      ({ value: selected = task } = { value: safe });
      Effect.runSync(selected as typeof task);
    `,
  ),
  runtimeCase(
    'evaluates a computed declaration key to select a task',
    1,
    `
      const key = "value" as const;
      const { [key]: selected } = { value: task };
      Effect.runSync(selected);
    `,
  ),
  runtimeCase(
    'evaluates a computed declaration key to select a safe value',
    0,
    `
      const key = "value" as const;
      const { [key]: selected } = { value: safe };
      Effect.runSync(selected);
    `,
  ),
  runtimeCase(
    'evaluates a computed assignment key to select a task',
    1,
    `
      const key = "value" as const;
      let selected = safe;
      ({ [key]: selected } = { value: task });
      Effect.runSync(selected);
    `,
  ),
  runtimeCase(
    'evaluates a computed assignment key to select a safe value',
    0,
    `
      const key = "value" as const;
      let selected = task;
      ({ [key]: selected } = { value: safe });
      Effect.runSync(selected);
    `,
  ),
];

const cases = [
  ...logicalAssignmentCases,
  ...memberLogicalAssignmentCases,
  ...objectAndArrayCases,
  ...defaultAndComputedCases,
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
      `${process.cwd()}/ts/test/rules/runtime-assignment-pattern-${index}.ts`,
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

const expectAssignmentPattern = ({
  reports,
  representative,
  source,
}: AssignmentPatternCase): void => {
  expect(
    parseSync('runtime-assignment-pattern.ts', source, { sourceType: 'module' }).errors,
  ).toEqual([]);
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

describe('effect-no-sync-for-promise runtime assignment patterns', (): void => {
  it.each(cases)('$name', expectAssignmentPattern);
});
