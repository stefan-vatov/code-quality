import { describe, expect, it } from 'vitest';
import { parseSync } from 'oxc-parser';
import { runRule } from './effect-rule-test-utils';
import ts from 'typescript';

interface RuntimeScalarCoercionCase {
  condition: string;
  hasTypeError?: boolean;
  name: string;
  reports: 0 | 1;
  representative?: boolean;
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

const runtimeSource = ({ condition, hasTypeError }: RuntimeScalarCoercionCase): string => `
  import { Effect } from "effect";

  const user = { id: 1 };
  type UserResult = typeof user | Promise<typeof user> | undefined;
  function load(value: UserResult = Promise.resolve(user)): UserResult {
    return value;
  }

  let supplied: UserResult = user;
  const task = ${syncExpression};
  supplied = void 0;
  ${hasTypeError ? '// @ts-expect-error -- intentional JavaScript coercion fixture' : ''}
  if (${condition}) {
    Effect.runSync(task);
  }
`;

const cases: readonly RuntimeScalarCoercionCase[] = [
  {
    condition: '0 == "0"',
    hasTypeError: true,
    name: 'executes when loose equality coerces numeric zero and string zero',
    reports: 1,
    representative: true,
  },
  {
    condition: '0 != "0"',
    hasTypeError: true,
    name: 'skips when loose inequality coerces numeric zero and string zero',
    reports: 0,
  },
  {
    condition: 'null == undefined',
    name: 'executes when loose equality matches null and undefined',
    reports: 1,
  },
  {
    condition: 'null === undefined',
    name: 'skips when strict equality distinguishes null and undefined',
    reports: 0,
  },
  {
    condition: 'false == 0',
    hasTypeError: true,
    name: 'executes when loose equality coerces false and numeric zero',
    reports: 1,
  },
  {
    condition: '"2" < "10"',
    name: 'uses lexicographic ordering when string less-than is false',
    reports: 0,
  },
  {
    condition: '"10" < "2"',
    name: 'uses lexicographic ordering when string less-than is true',
    reports: 1,
  },
  {
    condition: '"2" > "10"',
    name: 'uses lexicographic ordering when string greater-than is true',
    reports: 1,
  },
  {
    condition: '"10" > "2"',
    name: 'uses lexicographic ordering when string greater-than is false',
    reports: 0,
  },
  {
    condition: '2 < 10',
    name: 'keeps less-than numeric for numeric operands',
    reports: 1,
  },
  {
    condition: '10 < 2',
    name: 'keeps false less-than numeric for numeric operands',
    reports: 0,
  },
  {
    condition: '10 > 2',
    name: 'keeps greater-than numeric for numeric operands',
    reports: 1,
  },
  {
    condition: '2 > 10',
    name: 'keeps false greater-than numeric for numeric operands',
    reports: 0,
  },
  {
    condition: '"1" + 1 === "11"',
    name: 'executes when addition concatenates a string and number',
    reports: 1,
  },
  {
    condition: '"1" + 1 === "2"',
    name: 'skips the false string concatenation comparison',
    reports: 0,
  },
  {
    condition: '1 + 1 === 2',
    name: 'executes when addition remains numeric',
    reports: 1,
  },
  {
    condition: '1 + 1 === 3',
    name: 'skips the false numeric addition comparison',
    reports: 0,
  },
];

const opaqueObjectCoercionFixture: RuntimeScalarCoercionCase & { source: string } = {
  condition: '({ valueOf: (): number => 0 }) == 0',
  hasTypeError: true,
  name: 'keeps unsupported object coercion unknown across two unsafe branches',
  reports: 0,
  source: `
    import { Effect } from "effect";

    const user = { id: 1 };
    type UserResult = typeof user | Promise<typeof user> | undefined;
    function load(value: UserResult = Promise.resolve(user)): UserResult {
      return value;
    }

    let supplied: UserResult = user;
    const trueTask = Effect.sync(() => load(supplied));
    const falseTask = Effect.sync(() => load(supplied));
    supplied = void 0;
    // @ts-expect-error -- intentional unsupported JavaScript object coercion fixture
    if (({ valueOf: (): number => 0 }) == 0) {
      Effect.runSync(trueTask);
    } else {
      Effect.runSync(falseTask);
    }
  `,
};

const fixtures: readonly (RuntimeScalarCoercionCase & { source: string })[] = [
  ...cases.map((testCase): RuntimeScalarCoercionCase & { source: string } => ({
    ...testCase,
    source: runtimeSource(testCase),
  })),
  opaqueObjectCoercionFixture,
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
  const fixtureDirectory = new URL('.', import.meta.url).pathname;
  const sources = new Map(
    fixtures.map(({ source }, index): [string, string] => [
      `${fixtureDirectory}runtime-js-scalar-coercion-${index}.ts`,
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

const expectRuntimeScalarCoercion = ({
  reports,
  representative,
  source,
}: RuntimeScalarCoercionCase & { source: string }): void => {
  expect(
    parseSync('runtime-js-scalar-coercion.ts', source, { sourceType: 'module' }).errors,
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

describe('effect-no-sync-for-promise exact JavaScript scalar coercion', (): void => {
  it.each(fixtures)('$name', expectRuntimeScalarCoercion);
});
