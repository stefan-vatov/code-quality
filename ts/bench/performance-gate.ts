#!/usr/bin/env node
import {
  type BenchRow,
  type BudgetFile,
  type Fixture,
  type VisitorMap,
  dispatchNodes,
  parseFixture,
  withSourceCodeServices,
} from './performance-gate-support';
import {
  type CandidateShape,
  type CandidateSubsystem,
  candidateSource,
} from './performance-candidate-fixtures';
import { assertBudgetManifest, failedBudgetRows } from './performance-gate-budgets';
import { benchmarkCodemodFixtures, benchmarkCodemods } from './performance-gate-codemods';
import {
  groupedBudgets,
  measureBenchmark,
  measurePreparedBenchmark,
  medianBenchmarkRows,
  percentile,
} from './performance-gate-measurement';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import plugin from '../src/rules/plugin';

const minimumTimedSamples = 20;
const defaultRuleIterations = 20;
const defaultCodemodIterations = 20;
const defaultRuns = 20;
const candidateRuns = 20;
const ruleOperationsPerSample = 1;
const codemodOperationsPerSample = 1;
const medianBudgetFloorNs = 25_000;
const p95BudgetFloorNs = 100_000;
const budgetLimitMultiplier = 6;
const budgetConfirmationMeasurements = 3;
const candidateBaseLimitNs = 1_000_000;
const candidateNodeLimitNs = 10_000;
const linearGrowthTolerance = 6;
const hotWarmupIterations = 10;

interface RuleBenchmarkHits {
  candidateHits: number;
  referenceEntryHits: number;
}

const ruleBenchmarkHits = new Map<string, RuleBenchmarkHits>();
let activeRuleName: string | undefined;
const benchmarkHitsFor = (name: string): RuleBenchmarkHits => {
  const existing = ruleBenchmarkHits.get(name);
  if (existing) {
    return existing;
  }
  const created = { candidateHits: 0, referenceEntryHits: 0 };
  ruleBenchmarkHits.set(name, created);
  return created;
};

const requiredBenchmarkHits = {
  nativeReferenceHits: 0,
  candidateHits: 0,
  onReferenceEntry(): void {
    if (activeRuleName) {
      benchmarkHitsFor(activeRuleName).referenceEntryHits += 1;
    }
  },
};

const assertBenchmarkHits = (): void => {
  const missing = Object.entries(requiredBenchmarkHits)
    .filter(([name, hits]): boolean => typeof hits === 'number' && hits === 0)
    .map(([name]) => name);
  if (missing.length > 0) {
    throw new Error(`Benchmark work paths were not exercised: ${missing.join(', ')}`);
  }
};

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
      import * as E from "effect/Effect"; import { runPromise } from "effect/Effect"; class Repo{load():Promise<User>{return promise}} export{Repo};
      export interface Input { payload: Record<string, unknown>; } export type Loader = () => Promise<User>;
      const docs = "Effect.runPromise(program) Effect.timeout( Effect.retry("; const raw = JSON.parse(body); const responseData = response.json();
      const User = Schema.Struct({ age: Schema.NumberFromString, _tag: Schema.Literal("User") });
      const program = Effect.gen(function* () {
        const decoded = Schema.decodeUnknown(User)(payload); const user = decoded as User;
        const fiber = yield* Effect.fork(worker); yield* Effect.sleep(Duration.seconds(1)); return Effect.succeed(user);
      });
      export const load = () => Effect.runPromise(program); const promiseInsideSync = Effect.sync(() => Promise.resolve(user));
      const mapped = Effect.flatMap(program, (value) => Effect.succeed(value)); E.gen(function* () { return E.succeed(1); }); runPromise(program);
      Effect.tryPromise({ try: () => fetch("/users"), catch: (error) => ({ error }) });
      Effect.forEach(items, work, { concurrency: "unbounded" }); Effect.fail("bad"); Effect.fail(new Error("bad"));
    `,
  },
  {
    filename: 'src/adapters/http.ts',
    source: `import { Effect, HttpClient, Schedule, Duration } from "effect";
      export const getUser = Effect.tryPromise({ try: () => fetch("/users"), catch: FetchError.fromUnknown }); const http = HttpClient.get("/users").pipe(Effect.retry(Schedule.exponential("1 second"))); const file = FileSystem.readFileString(path);`,
  },
  {
    filename: 'src/server.ts',
    source: `import { Effect, HttpRouter, Schema } from "effect";
      const route = () => Effect.runSync(program); Effect.runPromise(program); const handler = HttpRouter.get("/users", Effect.succeed(Response.json(input)));`,
  },
  {
    filename: 'src/config/env.ts',
    source: `import { Config, Effect, Schema } from "effect";
      const token = process.env.API_TOKEN; const raw = Config.string("API_TOKEN"); const parsed = Schema.decodeUnknown(ConfigSchema)(raw); const now = Date.now(); const random = Math.random();`,
  },
  {
    filename: 'tests/unit/user.test.ts',
    source: `import { Effect, TestClock, Duration } from "effect";
      it.effect.only("focused", () => program); it.effect.skip("skipped", () => program); it.effect("time", () => Effect.sleep(Duration.seconds(1))); it.effect("clock", () => TestClock.adjust("1 second"));`,
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
  {
    filename: 'src/domain/native-scope.ts',
    source: `import { Effect as Fx } from "effect"; import { flatMap as chain, succeed as done } from "effect/Effect";
      const mapped = chain(program, (value) => done(value)); const promised = Fx.sync(() => Promise.resolve(1));
      // const abandoned = Fx.succeed(0);
      function shadow(Promise: any, chain: any, Fx: any) { return Fx.sync(() => Promise.resolve(chain())); }`,
  },
];

const codemodFixtures = benchmarkCodemodFixtures;
const codemods = benchmarkCodemods;
const args = new Set(process.argv.slice(2));
const stringArg = (name: string, fallback: string): string => {
  const index = process.argv.indexOf(name);
  if (index === -1) {
    return fallback;
  }
  return process.argv[index + 1] ?? fallback;
};
const numericArg = (name: string, fallback: number): number => {
  const index = process.argv.indexOf(name);
  if (index === -1) {
    return fallback;
  }
  return Number(process.argv[index + 1] ?? fallback);
};
const budgetPath = stringArg(
  '--budget',
  new URL('./performance-budgets.json', import.meta.url).pathname,
);

const nativeServices = [
  'getText',
  'isGlobalReference',
  'scopeManager',
  'text',
  'visitorKeys',
] as const;
const parseBenchmarkFixture = (fixture: Fixture): Fixture =>
  withSourceCodeServices(parseFixture(fixture, requiredBenchmarkHits), nativeServices);
const parsedRuleFixtures = ruleFixtures.map(parseBenchmarkFixture);
const uniqueFixture = (fixture: Fixture, sample: number): Fixture =>
  parseBenchmarkFixture({
    filename: fixture.filename.replace(/\.ts$/u, `.cold-${sample}.ts`),
    source: `${fixture.source}${'\n'.repeat(sample + 1)}`,
  });

const runRule = (name: string, fixture: Fixture): number => {
  const hits = benchmarkHitsFor(name);
  const rule = plugin.rules[name as keyof typeof plugin.rules];
  const create = rule.create as unknown as (context: object) => VisitorMap;
  let reports = 0;
  activeRuleName = name;
  try {
    const visitors = create({
      filename: fixture.filename,
      options: [strictOptions],
      report(): void {
        reports += 1;
        hits.candidateHits += 1;
        requiredBenchmarkHits.candidateHits += 1;
      },
      sourceCode: fixture.sourceCode,
    });
    for (const node of dispatchNodes(name, fixture, visitors)) {
      visitors[node.type]?.(node);
    }
    return reports;
  } finally {
    activeRuleName = undefined;
  }
};

const benchmark = measureBenchmark;
const ruleNames = Object.keys(plugin.rules).sort();
const coldRuleRows = (iterations: number): BenchRow[] =>
  ruleNames.map((name) =>
    measurePreparedBenchmark(
      name,
      iterations,
      ruleOperationsPerSample,
      (sample) => uniqueFixture(ruleFixtures[sample % ruleFixtures.length], sample),
      (fixture) => void runRule(name, fixture),
      ruleFixtures.length,
    ),
  );
const hotRuleRows = (iterations: number): BenchRow[] =>
  ruleNames.map((name) =>
    benchmark(
      name,
      parsedRuleFixtures,
      iterations,
      ruleOperationsPerSample,
      (fixture) => void runRule(name, fixture),
      hotWarmupIterations,
    ),
  );
const codemodRows = (iterations: number, warmups: number): BenchRow[] =>
  Object.entries(codemods)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, fn]) =>
      benchmark(
        name,
        codemodFixtures,
        iterations,
        codemodOperationsPerSample,
        (source) => void fn(source),
        warmups,
      ),
    );

interface CandidateFixture extends Fixture {
  candidateScale: number;
  candidateShape: CandidateShape;
  subsystem: CandidateSubsystem;
}

// Every rule is timed on shared candidate-free fixtures. This smaller matrix additionally measures
// candidate-position and input-scaling behavior for the recursion and native-reference hot paths;
// rule correctness and positive candidates remain covered by focused unit tests for each rule.
const candidateSubsystems = [
  {
    candidate:
      'function loop(): Effect.Effect<number> { Effect.succeed(undefined); return loop(); }',
    name: 'recursion',
    ruleName: 'effect-require-suspend-for-recursion',
  },
  {
    candidate: 'const request = Effect.tryPromise(() => fetch("/users"));',
    name: 'native',
    ruleName: 'effect-no-global-fetch',
  },
].map((subsystem): CandidateSubsystem => subsystem);
const candidateShapes = ['candidate-free', 'early-candidate', 'late-candidate'] as const;
const candidateScales = [100, 1_000, 5_000] as const;
const candidateStressFixtures = candidateSubsystems.flatMap((subsystem) =>
  candidateShapes.flatMap((shape) =>
    candidateScales.map(
      (scale): CandidateFixture => ({
        ...parseBenchmarkFixture({
          filename: `src/domain/bench-${subsystem.name}-${shape}-${scale}.ts`,
          source: candidateSource(subsystem, shape, scale),
        }),
        candidateScale: scale,
        candidateShape: shape,
        subsystem,
      }),
    ),
  ),
);

const assertRuleBenchmarkHits = (): void => {
  const missing = candidateSubsystems.flatMap(({ name, ruleName }) => {
    const hits = benchmarkHitsFor(ruleName);
    const failures =
      hits.candidateHits > 0 ? [] : [`${name}/${ruleName} did not exercise a candidate`];
    if (name === 'native' && hits.referenceEntryHits === 0) {
      failures.push(`${name}/${ruleName} did not enter native references`);
    }
    return failures;
  });
  if (missing.length > 0) {
    throw new Error(`Per-rule benchmark work was incomplete: ${missing.join(', ')}`);
  }
};

const normalizedP95NsPerNode = new Map<string, number[]>();
const candidateColdRows: BenchRow[] = [];
const candidateHotRows: BenchRow[] = [];
const benchmarkCandidateMatrix = (): void => {
  normalizedP95NsPerNode.clear();
  candidateColdRows.length = 0;
  candidateHotRows.length = 0;
  for (const fixture of candidateStressFixtures) {
    const shouldReport = fixture.candidateShape !== 'candidate-free';
    const { ruleName } = fixture.subsystem;
    if (runRule(ruleName, fixture) > 0 !== shouldReport) {
      throw new Error(
        `${ruleName} candidate expectation failed at ${fixture.candidateShape}/${fixture.candidateScale}`,
      );
    }
    const coldRow = measurePreparedBenchmark(
      `${ruleName}:candidate:cold:${fixture.candidateShape}:${fixture.candidateScale}`,
      candidateRuns,
      1,
      (sample) =>
        parseBenchmarkFixture({
          filename: fixture.filename.replace(/\.ts$/u, `.cold-${sample}.ts`),
          source: candidateSource(
            fixture.subsystem,
            fixture.candidateShape,
            fixture.candidateScale,
            sample,
          ),
        }),
      (input) => void runRule(ruleName, input),
      1,
    );
    candidateColdRows.push(coldRow);
    const hotRow = benchmark(
      `${ruleName}:candidate:hot:${fixture.candidateShape}:${fixture.candidateScale}`,
      [fixture],
      candidateRuns,
      1,
      (input) => void runRule(ruleName, input),
      hotWarmupIterations,
      1,
    );
    candidateHotRows.push(hotRow);
    for (const row of [coldRow, hotRow]) {
      const phase = ((): string => {
        if (row === coldRow) {
          return 'cold';
        }
        return 'hot';
      })();
      const nodeCount = fixture.visitorNodes?.length ?? fixture.candidateScale;
      const normalizedCandidateLimitNs = candidateNodeLimitNs + candidateBaseLimitNs / nodeCount;
      const normalized = row.p95Ns / nodeCount;
      if (normalized > normalizedCandidateLimitNs) {
        throw new Error(
          `${row.name} exceeded its normalized candidate ceiling: ${Math.round(row.p95Ns)}ns`,
        );
      }
      const key = `${phase}/${fixture.subsystem.name}/${fixture.candidateShape}`;
      const observed = normalizedP95NsPerNode.get(key) ?? [];
      observed.push(normalized);
      normalizedP95NsPerNode.set(key, observed);
    }
  }
  for (const [key, observations] of normalizedP95NsPerNode) {
    if (observations.length !== candidateScales.length) {
      throw new Error(`${key} did not measure every candidate scale`);
    }
    const lowest = Math.min(...observations);
    const highest = Math.max(...observations);
    if (highest > Math.max(candidateNodeLimitNs, lowest * linearGrowthTolerance)) {
      throw new Error(`${key} did not retain linear candidate scaling`);
    }
  }
};

const measureAll = (runs: number): { codemods: BenchRow[]; rules: BenchRow[] } => {
  const ruleIterations = Math.max(defaultRuleIterations, runs);
  const codemodIterations = Math.max(defaultCodemodIterations, runs);
  const coldRows = [...coldRuleRows(ruleIterations), ...codemodRows(codemodIterations, 0)];
  const hotRows = [
    ...hotRuleRows(ruleIterations),
    ...codemodRows(codemodIterations, hotWarmupIterations),
  ];
  const coldMedianNs = percentile(
    coldRows.map((row) => row.medianNs),
    0.5,
  );
  const hotMedianNs = percentile(
    hotRows.map((row) => row.medianNs),
    0.5,
  );
  const coldP95Ns = percentile(
    coldRows.map((row) => row.p95Ns),
    0.95,
  );
  const hotP95Ns = percentile(
    hotRows.map((row) => row.p95Ns),
    0.95,
  );
  benchmarkCandidateMatrix();
  assertBenchmarkHits();
  assertRuleBenchmarkHits();
  process.stdout.write(
    `Benchmark phases: cold ${Math.round(coldMedianNs)}ns/${Math.round(coldP95Ns)}ns, hot ${Math.round(hotMedianNs)}ns/${Math.round(hotP95Ns)}ns.\n`,
  );
  const ruleCount = ruleNames.length;
  return {
    codemods: [...coldRows.slice(ruleCount), ...hotRows.slice(ruleCount)],
    rules: [...coldRows.slice(0, ruleCount), ...hotRows.slice(0, ruleCount)],
  };
};

const readBudgets = (): BudgetFile => JSON.parse(readFileSync(budgetPath, 'utf8')) as BudgetFile;

const budgetFailures = (
  rows: { codemods: readonly BenchRow[]; rules: readonly BenchRow[] },
  budgets: BudgetFile,
): string[] => [
  ...failedBudgetRows('rule', rows.rules, budgets.rules),
  ...failedBudgetRows('codemod', rows.codemods, budgets.codemods),
];

const measuredRuns = (): number => Math.max(minimumTimedSamples, numericArg('--runs', defaultRuns));
const updateBudgets = (): void => {
  const runs = measuredRuns();
  const rows = measureAll(runs);
  const budgets: BudgetFile = {
    codemods: groupedBudgets(
      rows.codemods,
      runs,
      medianBudgetFloorNs,
      p95BudgetFloorNs,
      budgetLimitMultiplier,
    ),
    rules: groupedBudgets(
      rows.rules,
      runs,
      medianBudgetFloorNs,
      p95BudgetFloorNs,
      budgetLimitMultiplier,
    ),
  };
  writeFileSync(budgetPath, `${JSON.stringify(budgets, null, 2)}\n`, 'utf8');
  process.stdout.write(
    `Updated ${join('ts', 'bench', 'performance-budgets.json')} from ${runs} runs.\n`,
  );
};
const checkBudgets = (): void => {
  const budgets = readBudgets();
  const codemodNames = Object.keys(codemods).sort();
  assertBudgetManifest(ruleNames, codemodNames, budgets);
  const initialRows = measureAll(defaultRuns);
  let failures = budgetFailures(initialRows, budgets);
  if (failures.length > 0) {
    process.stdout.write(
      `Confirming apparent budget breach across ${budgetConfirmationMeasurements} measurements.\n`,
    );
    const measurements = [initialRows];
    for (let index = 1; index < budgetConfirmationMeasurements; index += 1) {
      measurements.push(measureAll(defaultRuns));
    }
    failures = budgetFailures(
      {
        codemods: medianBenchmarkRows(measurements.map((rows) => rows.codemods)),
        rules: medianBenchmarkRows(measurements.map((rows) => rows.rules)),
      },
      budgets,
    );
  }
  if (failures.length > 0) {
    throw new Error(`Performance gate failed.\n${failures.join('\n')}`);
  }
  process.stdout.write(
    `Performance gate passed for ${ruleNames.length} candidate-free rule paths, ${candidateSubsystems.length} representative candidate subsystems, and ${Object.keys(codemods).length} codemods.\n`,
  );
};

if (args.has('--update')) {
  updateBudgets();
} else {
  checkBudgets();
}
