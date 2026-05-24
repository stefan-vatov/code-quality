#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
import plugin from '../src/rules/plugin.js';
import { effectAgenticRuleNames, effectStrictRuleNames } from '../src/rules/effect-rule-names.js';

type BenchFixture = {
  filename: string;
  source: string;
};

type BenchRow = {
  inputSamples: number;
  iterations: number;
  medianPerOpNs: number;
  name: string;
  opsPerSec: number;
  p95PerOpNs: number;
  reports: number;
  totalMs: number;
};

const iterationsArgIndex = process.argv.indexOf('--iterations');
const outputArgIndex = process.argv.indexOf('--json');
const ITERATIONS =
  iterationsArgIndex === -1 ? 2_000 : Number(process.argv[iterationsArgIndex + 1] ?? 2_000);
const outputPath = outputArgIndex === -1 ? undefined : process.argv[outputArgIndex + 1];

const programNode = { range: [0, 0], type: 'Program' };
const strictOptions = {
  adapterLayers: ['src/adapters/**'],
  compositionRoots: ['src/main.ts', 'src/server.ts', 'src/cli.ts'],
  configLayers: ['src/config/**'],
  domain: ['src/domain/**'],
  entrypoints: ['src/main.ts', 'src/server.ts', 'src/cli.ts'],
  integrationTests: ['tests/integration/**'],
  unitTests: ['tests/unit/**', '**/*.test.ts'],
};

const fixtures: BenchFixture[] = [
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
      const run = Effect.tryPromise({ try: () => fetch("/users", { method: "GET" }), catch: (error) => ({ error }) });
      const all = Effect.forEach(items, work, { concurrency: "unbounded" });
      const flat = Effect.flatMap(program, work, { concurrency: "unbounded" });
      const layer = Layer.effect(UserRepo, openConnection());
      const q = Queue.unbounded();
      Stream.asyncPush(emit);
      Effect.catchAll(() => Effect.succeed(undefined));
      Effect.fail("bad");
      Effect.fail(new Error("bad"));
      Effect.succeed(Date.now());
      enabled || Effect.succeed(1);
      E.gen(function* () { return E.succeed(1); });
      runPromise(program);
    `,
  },
  {
    filename: 'src/adapters/http.ts',
    source: `
      import { Effect, HttpClient, Schedule, Duration } from "effect";
      export const getUser = Effect.tryPromise({
        try: () => fetch("/users", { method: "GET", headers }),
        catch: FetchError.fromUnknown
      }).pipe(Effect.timeout(Duration.seconds(1)));
      export const postUser = Effect.tryPromise({
        try: () => fetch("/users", { method: "POST" }),
        catch: FetchError.fromUnknown
      });
      const http = HttpClient.get("/users").pipe(Effect.retry(Schedule.exponential("1 second")));
      const file = FileSystem.readFileString(path);
      const sql = SqlClient.query("select * from users");
    `,
  },
  {
    filename: 'src/server.ts',
    source: `
      import { Effect, HttpRouter, HttpServerRequest, Schema } from "effect";
      const route = () => Effect.runSync(program);
      const handler = HttpRouter.get("/users", Effect.gen(function* () {
        const body = yield* request.json;
        const input = yield* Schema.decodeUnknown(User)(body);
        return Response.json(input);
      }));
      Effect.runPromise(program);
      Effect.runFork(program);
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
    filename: 'tests/unit/user.ts',
    source: `
      import { Effect, TestClock, Duration } from "effect";
      it("fails", async () => {
        await expect(Effect.runPromise(program)).rejects.toThrow();
      });
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
        return yield* repo.find(input).pipe(
          Effect.timeout(Duration.seconds(1)),
          Effect.retry(policy)
        );
      });
      export const UserRepoLayer = Layer.succeed(UserRepo, service);
    `,
  },
];

const effectRuleNames = [...effectAgenticRuleNames, ...effectStrictRuleNames];

function runRule(ruleName: string, fixture: BenchFixture): number {
  const rule = plugin.rules[ruleName as keyof typeof plugin.rules];
  if (!rule) {
    throw new Error(`Missing rule ${ruleName}`);
  }

  let reports = 0;
  const visitors = rule.create({
    filename: fixture.filename,
    options: [strictOptions],
    report() {
      reports++;
    },
    sourceCode: {
      text: fixture.source,
    },
  });
  visitors.Program?.(programNode);
  return reports;
}

function benchmarkRule(ruleName: string): BenchRow {
  const times: number[] = [];
  let totalNs = 0;
  let reports = 0;

  for (let iteration = 0; iteration < Math.max(100, Math.floor(ITERATIONS / 10)); iteration++) {
    runRule(ruleName, fixtures[iteration % fixtures.length]);
  }

  for (let iteration = 0; iteration < ITERATIONS; iteration++) {
    const fixture = fixtures[iteration % fixtures.length];
    const startedAt = process.hrtime.bigint();
    reports += runRule(ruleName, fixture);
    const elapsedNs = Number(process.hrtime.bigint() - startedAt);
    times.push(elapsedNs);
    totalNs += elapsedNs;
  }

  times.sort((left, right) => left - right);
  const totalMs = totalNs / 1_000_000;
  return {
    inputSamples: fixtures.length,
    iterations: ITERATIONS,
    medianPerOpNs: times[Math.floor(times.length / 2)] ?? 0,
    name: ruleName,
    opsPerSec: Math.round(ITERATIONS / (totalNs / 1_000_000_000)),
    p95PerOpNs: times[Math.floor(times.length * 0.95)] ?? 0,
    reports,
    totalMs,
  };
}

const rows = effectRuleNames.map(benchmarkRule);

if (outputPath) {
  writeFileSync(outputPath, `${JSON.stringify(rows, null, 2)}\n`, 'utf-8');
}

console.log(`Effect rule benchmarks - ${ITERATIONS.toLocaleString()} iterations/rule`);
console.log('| Rule | ops/sec | median ns | p95 ns | total ms | reports |');
console.log('|---|---:|---:|---:|---:|---:|');
for (const row of rows) {
  console.log(
    `| ${row.name} | ${row.opsPerSec.toLocaleString()} | ${row.medianPerOpNs.toLocaleString()} | ${row.p95PerOpNs.toLocaleString()} | ${row.totalMs.toFixed(2)} | ${row.reports.toLocaleString()} |`,
  );
}
