#!/usr/bin/env node
/* -------------------------------------------------------------------------- */
/*       Performance gate for custom Oxlint rules and shipped codemods.       */
/* -------------------------------------------------------------------------- */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseSync } from 'oxc-parser';
import { addInternalExportDocs } from '../src/codemods/internal-export-docs';
import { addVoidReturnTypes } from '../src/codemods/explicit-return-types';
import { applyCodemodFixToSource } from '../src/codemod-fix/index';
import { formatFileHeaderComment } from '../src/codemods/format-file-header';
import { formatJSDocComments } from '../src/codemods/format-jsdoc-comments';
import { inlineLocalExportLists } from '../src/codemods/inline-export-lists';
import { preferConciseArrowBodies } from '../src/codemods/arrow-body-style';
import { preferExplicitBranches } from '../src/codemods/no-ternary';
import { preferFunctionExpressions } from '../src/codemods/function-declarations';
import { renameMisCasedAcronyms } from '../src/codemods/rename-acronyms';
import { sortImportDeclarations } from '../src/codemods/sort-imports';
import plugin from '../src/rules/plugin';

interface BudgetEntry {
  inputSamples: number;
  iterations: number;
  medianLimitNs: number;
  observedMedianNs: number;
  observedP95Ns: number;
  operationsPerSample: number;
  p95LimitNs: number;
  runs: number;
}

interface BudgetFile {
  codemods: Record<string, BudgetEntry>;
  rules: Record<string, BudgetEntry>;
}

interface BenchRow {
  inputSamples: number;
  iterations: number;
  medianNs: number;
  name: string;
  operationsPerSample: number;
  p95Ns: number;
}

interface Fixture {
  ast?: object;
  filename: string;
  source: string;
}

const defaultRuleIterations = 80;
const defaultCodemodIterations = 8;
const defaultRuns = 5;
const ruleOperationsPerSample = 8;
const codemodOperationsPerSample = 1;
const nsPerMs = 1_000_000;
const ruleBudgetFloorNs = 250_000;
const codemodBudgetFloorNs = 2 * nsPerMs;
const p95Tolerance = 4;
const medianTolerance = 3;

const strictOptions = {
  adapterLayers: ['src/adapters/**'],
  compositionRoots: ['src/main.ts', 'src/server.ts', 'src/cli.ts'],
  configLayers: ['src/config/**'],
  domain: ['src/domain/**'],
  entrypoints: ['src/main.ts', 'src/server.ts', 'src/cli.ts'],
  integrationTests: ['tests/integration/**'],
  unitTests: ['tests/unit/**', '**/*.test.ts'],
};

const ruleFixtures: Fixture[] = [
  {
    filename: 'src/domain/user.ts',
    source: `
      import { Effect, Schema, Layer, Context, Queue, Stream, Schedule, Duration } from "effect";
      import * as E from "effect/Effect";
      import { runPromise } from "effect/Effect";
      export interface Input { payload: Record<string, unknown>; }
      export type Loader = () => Promise<User>;
      class Repo { load(): Promise<User> { return promise; } }
      export { Repo };
      const docs = "Effect.runPromise(program) Effect.timeout( Effect.retry(";
      const User = Schema.Struct({ age: Schema.NumberFromString, _tag: Schema.Literal("User") });
      const raw = JSON.parse(body);
      const responseData = response.json();
      const program = Effect.gen(function* () {
        const decoded = Schema.decodeUnknown(User)(payload);
        const user = decoded as User;
        const fiber = yield* Effect.fork(worker);
        yield* Effect.sleep(Duration.seconds(1));
        return Effect.succeed(user);
      });
      export const load = () => Effect.runPromise(program);
      Effect.tryPromise({ try: () => fetch("/users"), catch: (error) => ({ error }) });
      Effect.forEach(items, work, { concurrency: "unbounded" });
      Effect.fail("bad");
      Effect.fail(new Error("bad"));
      E.gen(function* () { return E.succeed(1); });
      runPromise(program);
    `,
  },
  {
    filename: 'src/adapters/http.ts',
    source: `
      import { Effect, HttpClient, Schedule, Duration } from "effect";
      export const getUser = Effect.tryPromise({ try: () => fetch("/users"), catch: FetchError.fromUnknown });
      const http = HttpClient.get("/users").pipe(Effect.retry(Schedule.exponential("1 second")));
      const file = FileSystem.readFileString(path);
    `,
  },
  {
    filename: 'src/server.ts',
    source: `
      import { Effect, HttpRouter, Schema } from "effect";
      const route = () => Effect.runSync(program);
      const handler = HttpRouter.get("/users", Effect.gen(function* () {
        const body = yield* request.json;
        const input = yield* Schema.decodeUnknown(User)(body);
        return Response.json(input);
      }));
      Effect.runPromise(program);
    `,
  },
  {
    filename: 'src/config/env.ts',
    source: `
      import { Config, Effect, Schema } from "effect";
      const token = process.env.API_TOKEN;
      const raw = Config.string("API_TOKEN");
      const parsed = Schema.decodeUnknown(ConfigSchema)(raw);
      const now = Date.now();
      const random = Math.random();
    `,
  },
  {
    filename: 'tests/unit/user.test.ts',
    source: `
      import { Effect, TestClock, Duration } from "effect";
      it.effect.only("focused", () => program);
      it.effect.skip("skipped", () => program);
      it.effect("time", () => Effect.sleep(Duration.seconds(1)));
      it.effect("clock", () => TestClock.adjust("1 second"));
    `,
  },
  {
    filename: 'src/domain/clean.ts',
    source: `
      import { Effect, Schema, Layer, Duration } from "effect";
      export const load = Effect.fn(function* (id: UserId) {
        const input = yield* Schema.decodeUnknown(UserId)(id);
        return yield* repo.find(input).pipe(Effect.timeout(Duration.seconds(1)), Effect.retry(policy));
      });
      export const UserRepoLayer = Layer.succeed(UserRepo, service);
    `,
  },
];

const codemodFixtures = [
  `
    import zed from './zed';
    import { beta, alpha } from './letters';
    const apiUrl = '/users';
    const helper = () => { return apiUrl; };
    function value() { return undefined; }
    export { helper, value };
  `,
  `
    /** Internal helper exported for package-local composition. */
    export const run = (input: string) => {
      if (input) { return "ok"; } else { return "bad"; }
    };
  `,
  `
    const result = enabled ? makeEnabled() : makeDisabled();
    export const mapper = (value: string) => { return { value }; };
  `,
  `
    export function parse(input: string) { return undefined; }
    export const httpApi = () => fetch('/users');
  `,
];

const codemods = {
  addInternalExportDocs,
  addVoidReturnTypes,
  applyCodemodFixToSource,
  formatFileHeaderComment,
  formatJSDocComments,
  inlineLocalExportLists,
  preferConciseArrowBodies,
  preferExplicitBranches,
  preferFunctionExpressions,
  renameMisCasedAcronyms,
  sortImportDeclarations,
} satisfies Record<string, (source: string) => string>;

const args = new Set(process.argv.slice(2));
const stringArg = (name: string, fallback: string): string => {
  const index = process.argv.indexOf(name);
  if (index === -1) {
    return fallback;
  }
  return process.argv[index + 1] ?? fallback;
};

const budgetPath = stringArg(
  '--budget',
  new URL('./performance-budgets.json', import.meta.url).pathname,
);
const numericArg = (name: string, fallback: number): number => {
  const index = process.argv.indexOf(name);
  if (index === -1) {
    return fallback;
  }
  return Number(process.argv[index + 1] ?? fallback);
};

const percentile = (values: readonly number[], percentileValue: number): number =>
  [...values].sort((left, right) => left - right)[Math.floor(values.length * percentileValue)] ?? 0;

const parseFixture = (fixture: Fixture): Fixture => ({
  ...fixture,
  ast: parseSync(fixture.filename, fixture.source, { sourceType: 'module' }).program as object,
});

const isNode = (value: unknown): value is { type: string } =>
  Boolean(
    value && typeof value === 'object' && typeof (value as { type?: unknown }).type === 'string',
  );

const traverse = (
  node: unknown,
  visitors: Record<string, ((node: object) => void) | undefined>,
): void => {
  if (!isNode(node)) {
    return;
  }
  if (node.type !== 'Program') {
    visitors[node.type]?.(node);
  }
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        traverse(item, visitors);
      }
      continue;
    }
    traverse(value, visitors);
  }
};

const runRule = (name: string, fixture: Fixture): void => {
  const rule = plugin.rules[name as keyof typeof plugin.rules];
  const visitors = rule.create({
    filename: fixture.filename,
    options: [strictOptions],
    report() {},
    sourceCode: { text: fixture.source },
  });
  visitors.Program?.(fixture.ast ?? {});
  traverse(fixture.ast, visitors);
};

const benchmark = (
  name: string,
  inputs: readonly Fixture[] | readonly string[],
  iterations: number,
  operationsPerSample: number,
  fn: (input: Fixture | string) => void,
): BenchRow => {
  const times: number[] = [];
  const warmupIterations = Math.max(10, Math.floor(iterations / 4));
  for (let iteration = 0; iteration < warmupIterations; iteration++) {
    fn(inputs[iteration % inputs.length]);
  }
  for (let iteration = 0; iteration < iterations; iteration++) {
    const startedAt = process.hrtime.bigint();
    for (let operation = 0; operation < operationsPerSample; operation++) {
      fn(inputs[(iteration + operation) % inputs.length]);
    }
    times.push(Number(process.hrtime.bigint() - startedAt) / operationsPerSample);
  }
  return {
    inputSamples: inputs.length,
    iterations,
    medianNs: percentile(times, 0.5),
    name,
    operationsPerSample,
    p95Ns: percentile(times, 0.95),
  };
};

const ruleRows = (iterations: number): BenchRow[] => {
  const fixtures = ruleFixtures.map(parseFixture);
  return Object.keys(plugin.rules)
    .sort()
    .map((name) =>
      benchmark(name, fixtures, iterations, ruleOperationsPerSample, (fixture) =>
        runRule(name, fixture as Fixture),
      ),
    );
};

const codemodRows = (iterations: number): BenchRow[] =>
  Object.entries(codemods)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, fn]) =>
      benchmark(
        name,
        codemodFixtures,
        iterations,
        codemodOperationsPerSample,
        (source) => void fn(source as string),
      ),
    );

const readBudgets = (): BudgetFile => JSON.parse(readFileSync(budgetPath, 'utf8')) as BudgetFile;

const budgetEntry = (rows: readonly BenchRow[], runs: number, floorNs: number): BudgetEntry => {
  const p95Values = rows.map((row) => row.p95Ns);
  const medianValues = rows.map((row) => row.medianNs);
  const observedP95Ns = Math.max(...p95Values);
  const observedMedianNs = Math.max(...medianValues);
  return {
    inputSamples: rows[0]?.inputSamples ?? 0,
    iterations: rows[0]?.iterations ?? 0,
    medianLimitNs: Math.ceil(Math.max(floorNs, observedMedianNs * medianTolerance)),
    observedMedianNs,
    observedP95Ns,
    operationsPerSample: rows[0]?.operationsPerSample ?? 0,
    p95LimitNs: Math.ceil(Math.max(floorNs, observedP95Ns * p95Tolerance)),
    runs,
  };
};

const groupedBudgets = (
  rows: readonly BenchRow[],
  runs: number,
  floorNs: number,
): Record<string, BudgetEntry> =>
  Object.fromEntries(
    [...new Set(rows.map((row) => row.name))].sort().map((name) => [
      name,
      budgetEntry(
        rows.filter((row) => row.name === name),
        runs,
        floorNs,
      ),
    ]),
  );

const measureAll = (runs: number): { codemods: BenchRow[]; rules: BenchRow[] } => {
  const rules: BenchRow[] = [];
  const codemodsRows: BenchRow[] = [];
  for (let run = 0; run < runs; run++) {
    rules.push(...ruleRows(defaultRuleIterations));
    codemodsRows.push(...codemodRows(defaultCodemodIterations));
  }
  return { codemods: codemodsRows, rules };
};

const missingEntries = (actual: readonly string[], expected: Record<string, unknown>): string[] =>
  actual.filter((name) => !Object.hasOwn(expected, name));

const staleEntries = (actual: readonly string[], expected: Record<string, unknown>): string[] =>
  Object.keys(expected).filter((name) => !actual.includes(name));

const assertManifest = (budgets: BudgetFile): void => {
  const ruleNames = Object.keys(plugin.rules).sort();
  const codemodNames = Object.keys(codemods).sort();
  const missingRules = missingEntries(ruleNames, budgets.rules);
  const missingCodemods = missingEntries(codemodNames, budgets.codemods);
  const staleRules = staleEntries(ruleNames, budgets.rules);
  const staleCodemods = staleEntries(codemodNames, budgets.codemods);
  const problems = [
    ...missingRules.map((name) => `missing rule budget: ${name}`),
    ...missingCodemods.map((name) => `missing codemod budget: ${name}`),
    ...staleRules.map((name) => `stale rule budget: ${name}`),
    ...staleCodemods.map((name) => `stale codemod budget: ${name}`),
  ];
  if (problems.length > 0) {
    throw new Error(
      `Performance budget manifest is out of sync.\n${problems.join('\n')}\nRun: pnpm run performance:calibrate`,
    );
  }
};

const checkRows = (
  kind: 'codemod' | 'rule',
  rows: readonly BenchRow[],
  budgets: Record<string, BudgetEntry>,
): string[] =>
  rows.flatMap((row) => {
    const budget = budgets[row.name];
    if (!budget) {
      return [`missing ${kind} budget: ${row.name}`];
    }
    if (row.p95Ns > budget.p95LimitNs || row.medianNs > budget.medianLimitNs) {
      return [
        `${kind} ${row.name} exceeded budget: median ${row.medianNs}ns/${budget.medianLimitNs}ns, p95 ${row.p95Ns}ns/${budget.p95LimitNs}ns`,
      ];
    }
    return [];
  });

const updateBudgets = (): void => {
  const runs = numericArg('--runs', defaultRuns);
  const rows = measureAll(runs);
  const budgets: BudgetFile = {
    codemods: groupedBudgets(rows.codemods, runs, codemodBudgetFloorNs),
    rules: groupedBudgets(rows.rules, runs, ruleBudgetFloorNs),
  };
  writeFileSync(budgetPath, `${JSON.stringify(budgets, null, 2)}\n`, 'utf8');
  process.stdout.write(
    `Updated ${join('ts', 'bench', 'performance-budgets.json')} from ${runs} run(s).\n`,
  );
};

const checkBudgets = (): void => {
  const budgets = readBudgets();
  assertManifest(budgets);
  const rows = measureAll(1);
  const failures = [
    ...checkRows('rule', rows.rules, budgets.rules),
    ...checkRows('codemod', rows.codemods, budgets.codemods),
  ];
  if (failures.length > 0) {
    throw new Error(
      `Performance gate failed.\n${failures.join('\n')}\nRun: pnpm run performance:calibrate`,
    );
  }
  process.stdout.write(
    `Performance gate passed for ${rows.rules.length} custom rules and ${rows.codemods.length} codemods.\n`,
  );
};

if (args.has('--update')) {
  updateBudgets();
} else {
  checkBudgets();
}
