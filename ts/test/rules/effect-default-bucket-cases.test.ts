import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import theThracianOxlint from '../../src/index.js';
import { effectDefaultRuleNames } from '../../src/rules/effect-rule-names.js';
import { runConfiguredRules, runRule, sorted } from './effect-rule-test-utils.js';
import type { RuleCase } from './effect-rule-test-utils.js';

const defaultCases: RuleCase[] = [
  {
    name: 'effect-no-floating-effect',
    invalid: 'Effect.succeed(1);',
    valid: 'const value = Effect.succeed(1);',
  },
  {
    name: 'effect-require-yield-star',
    invalid: 'const p = Effect.gen(function* () { yield Effect.succeed(1); });',
    valid: 'const p = Effect.gen(function* () { yield* Effect.succeed(1); });',
  },
  {
    name: 'effect-require-return-yield-star',
    invalid: 'const p = Effect.gen(function* () { return Effect.succeed(1); });',
    valid: 'const p = Effect.gen(function* () { return yield* Effect.succeed(1); });',
  },
  {
    name: 'effect-prefer-gen-for-nested-flatmap',
    invalid: 'Effect.flatMap(a, () => Effect.flatMap(b, () => c));',
    valid: 'a.pipe(Effect.flatMap((value) => b(value)));',
  },
  {
    name: 'effect-no-function-returning-gen',
    invalid: 'export function load() { return Effect.gen(function* () { return 1; }); }',
    valid: 'export const load = Effect.fn("load")(function* () { return 1; });',
  },
  {
    name: 'effect-prefer-effect-fn-for-exported-effects',
    invalid: 'export const load = () => Effect.succeed(1);',
    valid: 'export const load = Effect.fn("load")(function* () { return 1; });',
  },
  {
    name: 'effect-no-unnecessary-gen',
    invalid: 'const p = Effect.gen(function* () { return yield* Effect.succeed(1); });',
    valid: 'const p = Effect.succeed(1);',
  },
  {
    name: 'effect-no-effect-in-array-foreach',
    invalid: 'items.forEach((item) => Effect.succeed(item));',
    valid: 'Effect.forEach(items, (item) => Effect.succeed(item));',
  },
  {
    name: 'effect-no-effect-in-promise-callback',
    invalid: 'promise.then((value) => Effect.succeed(value));',
    valid: 'Effect.tryPromise(() => promise);',
  },
  {
    name: 'effect-no-floating-fiber',
    invalid: 'Effect.fork(worker);',
    valid: 'const fiber = yield* Effect.fork(worker); yield* Fiber.join(fiber);',
  },
  {
    name: 'effect-require-suspend-for-recursion',
    invalid: 'function loop() { return Effect.flatMap(step, () => loop()); }',
    valid: 'function loop() { return Effect.suspend(() => Effect.flatMap(step, () => loop())); }',
  },
  {
    name: 'effect-require-suspend-for-lazy-evaluation',
    invalid: 'Effect.succeed(Date.now());',
    valid: 'Effect.suspend(() => Effect.succeed(Date.now()));',
  },
  {
    name: 'effect-no-async-await-in-effect',
    invalid: 'Effect.gen(async () => { await fetch("/"); });',
    valid: 'Effect.tryPromise(() => fetch("/"));',
  },
  {
    name: 'effect-no-promise-then-in-effect',
    invalid: 'import { Effect } from "effect"; fetch("/").then((r) => r.text());',
    valid: 'import { Effect } from "effect"; Effect.tryPromise(() => fetch("/"));',
  },
  {
    name: 'effect-no-throw',
    invalid: 'Effect.gen(function* () { throw new Error("x"); });',
    valid: 'Effect.gen(function* () { return yield* Effect.fail(new TaggedError()); });',
  },
  {
    name: 'effect-no-string-errors',
    invalid: 'Effect.fail("x");',
    valid: 'Effect.fail(new TaggedError());',
  },
  {
    name: 'effect-no-untagged-errors',
    invalid: 'Effect.fail(new Error("x"));',
    valid: 'Effect.fail(new TaggedError());',
  },
  {
    name: 'effect-no-silent-error-swallowing',
    invalid: 'program.pipe(Effect.catchAll(() => Effect.succeed(undefined)));',
    valid:
      'program.pipe(Effect.catchAll((error) => Effect.logError(error).pipe(Effect.andThen(Effect.fail(error)))));',
  },
  {
    name: 'effect-require-typed-error-in-trypromise',
    invalid: 'Effect.tryPromise(() => fetch("/"));',
    valid:
      'Effect.tryPromise({ try: () => fetch("/"), catch: (error) => new FetchError({ error }) });',
  },
  {
    name: 'effect-prefer-catchTag-over-catchAll',
    invalid: 'program.pipe(Effect.catchAll(() => Effect.succeed(1)));',
    valid: 'program.pipe(Effect.catchTag("NotFound", () => Effect.succeed(1)));',
  },
  {
    name: 'effect-no-catchAll-with-mapError',
    invalid: 'program.pipe(Effect.catchAll((error) => Effect.fail(new Wrapped({ error }))));',
    valid: 'program.pipe(Effect.mapError((error) => new Wrapped({ error })));',
  },
  {
    name: 'effect-prefer-mapError-over-catchAll-rethrow',
    invalid: 'program.pipe(catchAll((error) => Effect.fail(new Wrapped({ error }))));',
    valid: 'program.pipe(Effect.mapError((error) => new Wrapped({ error })));',
  },
  {
    name: 'effect-require-error-cause-preserved',
    invalid: 'program.pipe(Effect.mapError(() => new WrappedError("x")));',
    valid: 'program.pipe(Effect.mapError((cause) => new WrappedError("x", { cause })));',
  },
  {
    name: 'effect-prefer-ignore-logged',
    invalid: 'Effect.ignore(program);',
    valid: 'program.pipe(Effect.catchAll((error) => Effect.logError(error)));',
  },
  {
    name: 'effect-prefer-catchTags-for-multiple-tags',
    invalid: 'program.pipe(Effect.catchTag("A", a), Effect.catchTag("B", b));',
    valid: 'program.pipe(Effect.catchTags({ A: a, B: b }));',
  },
  {
    name: 'effect-no-error-channel-widening-to-unknown',
    invalid: 'const p: Effect<string, unknown> = value;',
    valid: 'const p: Effect<string, DomainError> = value;',
  },
  {
    name: 'effect-no-run-inside-effect',
    invalid:
      'Effect.gen(function* () { return yield* Effect.promise(() => Effect.runPromise(load)); });',
    valid: 'Effect.gen(function* () { return yield* load; });',
  },
  {
    name: 'effect-no-runpromise-in-exported-api',
    invalid: 'export const load = () => Effect.runPromise(program);',
    valid: 'export const load = () => program;',
  },
  {
    name: 'effect-no-runfork-without-observer',
    invalid: 'Effect.runFork(program);',
    valid: 'const fiber = Effect.runFork(program); fiber.addObserver(() => undefined);',
  },
  {
    name: 'effect-no-sync-for-promise',
    invalid: 'Effect.sync(() => fetch("/"));',
    valid: 'Effect.tryPromise(() => fetch("/"));',
  },
  {
    name: 'effect-no-sync-for-throwing-ops',
    invalid: 'Effect.sync(() => JSON.parse(body));',
    valid: 'Effect.try(() => JSON.parse(body));',
  },
  {
    name: 'effect-no-console-log-in-effect-code',
    invalid: 'import { Effect } from "effect"; console.log("x");',
    valid: 'import { Effect } from "effect"; Effect.logInfo("x");',
  },
  {
    name: 'effect-no-process-env-in-effect-code',
    invalid: 'import { Effect } from "effect"; process.env.API_TOKEN;',
    valid: 'import { Config } from "effect"; Config.string("API_TOKEN");',
  },
  {
    name: 'effect-no-date-now-in-effect-code',
    invalid: 'import { Effect } from "effect"; Date.now();',
    valid: 'import { Clock } from "effect"; Clock.currentTimeMillis;',
  },
  {
    name: 'effect-no-math-random-in-effect-code',
    invalid: 'import { Effect } from "effect"; Math.random();',
    valid: 'import { Random } from "effect"; Random.next;',
  },
  {
    name: 'effect-no-json-parse-cast',
    invalid: 'const user = JSON.parse(body) as User;',
    valid: 'const user = Schema.decodeUnknown(User)(JSON.parse(body));',
  },
  {
    name: 'effect-schema-prefer-decodeUnknown-effect',
    invalid: 'Schema.decodeUnknownPromise(User)(payload);',
    valid: 'Schema.decodeUnknown(User)(payload);',
  },
  {
    name: 'effect-schema-require-parse-error-handling',
    invalid: 'Schema.decodeUnknown(User)(payload).pipe(Effect.orDie);',
    valid: 'return Schema.decodeUnknown(User)(payload);',
  },
  {
    name: 'effect-schema-use-decodeUnknown-for-external-data',
    invalid: 'const body = response.json();',
    valid: 'Schema.decodeUnknown(User)(yield* response.json);',
  },
  {
    name: 'effect-schema-no-unsafe-sync-decode-in-effect-code',
    invalid:
      'import { Effect, Schema } from "effect"; Effect.gen(function* () { return Schema.decodeSync(User)(payload); });',
    valid: 'import { Effect, Schema } from "effect"; Schema.decodeUnknown(User)(payload);',
  },
  {
    name: 'effect-schema-require-parseJson-for-json-strings',
    invalid: 'Schema.decodeUnknown(User)(JSON.parse(body));',
    valid: 'Schema.decodeUnknown(Schema.parseJson(User))(body);',
  },
  {
    name: 'effect-schema-correct-number-type-for-parsed-json',
    invalid: 'const parsed = Schema.decodeUnknownSync(Schema.NumberFromString)(JSON.parse(body));',
    valid: 'const parsed = JSON.parse(body); const S = Schema.Number;',
  },
  {
    name: 'effect-schema-prefer-taggedClass-over-manual-tag',
    invalid: 'Schema.Struct({ _tag: Schema.Literal("UserError"), message: Schema.String });',
    valid:
      'class UserError extends Schema.TaggedClass<UserError>("UserError")("UserError", { message: Schema.String }) {}',
  },
  {
    name: 'effect-schema-avoid-old-type-names',
    invalid: 'Schema.string();',
    valid: 'Schema.String;',
  },
  {
    name: 'effect-schema-no-cast-after-decode',
    invalid: 'const user = Schema.decodeUnknown(User)(payload) as User;',
    valid: 'const user = Schema.decodeUnknown(User)(payload);',
  },
  {
    name: 'effect-require-acquire-release',
    invalid: 'Effect.tryPromise(() => openConnection());',
    valid: 'Effect.acquireRelease(openConnection, closeConnection);',
  },
  {
    name: 'effect-require-scoped-for-acquireRelease',
    invalid: 'Effect.acquireRelease(openConnection, closeConnection);',
    valid: 'Effect.scoped(Effect.acquireRelease(openConnection, closeConnection));',
  },
  {
    name: 'effect-require-scoped-for-resources',
    invalid: 'Connection.open(url).pipe(Effect.map(identity));',
    valid: 'Effect.scoped(Connection.open(url));',
  },
  {
    name: 'effect-no-fork-daemon-without-cleanup',
    invalid: 'Effect.forkDaemon(worker);',
    valid: 'Effect.scoped(Effect.forkScoped(worker));',
  },
  {
    name: 'effect-prefer-fork-scoped-for-listeners',
    invalid: 'Effect.fork(listenForEvents);',
    valid: 'Effect.forkScoped(listenForEvents);',
  },
  {
    name: 'effect-require-restore-for-fork-in-uninterruptible',
    invalid: 'Effect.uninterruptible(Effect.fork(worker));',
    valid: 'Effect.uninterruptibleMask(({ restore }) => restore(Effect.fork(worker)));',
  },
  {
    name: 'effect-require-bounded-concurrency',
    invalid: 'Effect.forEach(items, work, { concurrency: "unbounded" });',
    valid: 'Effect.forEach(items, work, { concurrency: 8 });',
  },
  {
    name: 'effect-require-bounded-flatMap-concurrency',
    invalid: 'Effect.flatMap(items, work, { concurrency: "unbounded" });',
    valid: 'Effect.flatMap(items, work, { concurrency: 8 });',
  },
  {
    name: 'effect-no-unbounded-queue',
    invalid: 'Queue.unbounded();',
    valid: 'Queue.bounded(128);',
  },
  {
    name: 'effect-no-unbounded-stream-buffer',
    invalid: 'Stream.buffer(source, Infinity);',
    valid: 'Stream.buffer(source, 128);',
  },
  {
    name: 'effect-test-no-runpromise',
    filename: 'src/user.test.ts',
    invalid: 'Effect.runPromise(program);',
    valid: 'it.effect("works", () => program);',
  },
  {
    name: 'effect-prefer-it-effect-for-unit-tests',
    filename: 'src/user.test.ts',
    invalid: 'it("works", () => Effect.succeed(1));',
    valid: 'it.effect("works", () => Effect.succeed(1));',
  },
  {
    name: 'effect-testClock-requires-fork',
    filename: 'src/user.test.ts',
    invalid: 'TestClock.adjust("1 second");',
    valid: 'const fiber = yield* Effect.fork(program); yield* TestClock.adjust("1 second");',
  },
  {
    name: 'effect-testClock-requires-testContext',
    filename: 'src/user.test.ts',
    invalid: 'it("works", () => TestClock.adjust("1 second"));',
    valid: 'it.effect("works", () => TestClock.adjust("1 second"));',
  },
  {
    name: 'effect-no-real-sleep-in-tests',
    filename: 'src/user.test.ts',
    invalid: 'Effect.sleep("1 second");',
    valid: 'TestClock.adjust("1 second");',
  },
  {
    name: 'effect-use-exit-for-failure-tests',
    filename: 'src/user.test.ts',
    invalid: 'await expect(Effect.fail(new TaggedError())).rejects.toThrow();',
    valid: 'const exit = yield* Effect.exit(program);',
  },
  {
    name: 'effect-no-focused-effect-tests',
    filename: 'src/user.test.ts',
    invalid: 'it.effect.only("works", () => program);',
    valid: 'it.effect("works", () => program);',
  },
  {
    name: 'effect-no-skipped-effect-tests',
    filename: 'src/user.test.ts',
    invalid: 'it.effect.skip("works", () => program);',
    valid: 'it.effect("works", () => program);',
  },
  {
    name: 'effect-no-obsolete-imports',
    invalid: 'import { Effect } from "@effect/io";',
    valid: 'import { Schema } from "effect";',
  },
  {
    name: 'effect-no-known-fake-api',
    invalid: 'Effect.fromPromise(() => fetch("/"));',
    valid: 'Effect.fromNullable(value);',
  },
  {
    name: 'effect-prefer-gen-over-do',
    invalid: 'Effect.Do;',
    valid: 'Effect.gen(function* () { return 1; });',
  },
  {
    name: 'effect-prefer-direct-yield-star',
    invalid: 'Effect.gen(function* ($) { return yield* $(program); });',
    valid: 'Effect.gen(function* () { return yield* program; });',
  },
  {
    name: 'effect-prefer-config-redacted',
    invalid: 'Config.secret("API_TOKEN");',
    valid: 'Config.redacted("API_TOKEN");',
  },
  {
    name: 'effect-no-deprecated-schema-package',
    invalid: 'import { Schema } from "@effect/schema";',
    valid: 'import { Schema } from "effect";',
  },
  {
    name: 'effect-no-deprecated-context-tag-function',
    invalid: 'const UserRepo = Context.Tag<UserRepo>("UserRepo");',
    valid: 'class UserRepo extends Context.Tag("UserRepo")<UserRepo, Service>() {}',
  },
  {
    name: 'effect-no-global-error-channel',
    invalid: 'const value: Effect.Effect<User, Error, Env> = program;',
    valid: 'const value: Effect.Effect<User, UserError, Env> = program;',
  },
  {
    name: 'effect-use-duration-constructors',
    invalid: 'Effect.sleep(1000);',
    valid: 'Effect.sleep("1 second");',
  },
  {
    name: 'effect-no-mixed-effect-import-styles',
    invalid: 'import * as Effect from "effect"; import { Effect as EffectType } from "effect";',
    valid: 'import { Effect } from "effect";',
  },
  {
    name: 'effect-prefer-effect-is',
    invalid: 'value._op === "Effect";',
    valid: 'Effect.isEffect(value);',
  },
  {
    name: 'effect-no-try-catch-in-effect-gen',
    invalid:
      'const program = Effect.gen(function* () { try { yield* load; } catch (error) { return yield* Effect.fail(error); } });',
    valid:
      'const program = Effect.gen(function* () { return yield* load.pipe(Effect.catchTag("Missing", recover)); });',
  },
  {
    name: 'effect-no-new-promise',
    invalid: 'import { Effect } from "effect"; const task = new Promise((resolve) => resolve(1));',
    valid: 'const task = Effect.promise(() => load());',
  },
  {
    name: 'effect-no-global-timers',
    invalid: 'import { Effect } from "effect"; setTimeout(() => Effect.runFork(task), 1000);',
    valid: 'const task = Effect.sleep(Duration.seconds(1));',
  },
  {
    name: 'effect-no-native-error-classes',
    invalid: 'import { Effect } from "effect"; class UserError extends Error {}',
    valid:
      'class UserError extends Schema.TaggedErrorClass<UserError>("UserError")("UserError", {}) {}',
  },
  {
    name: 'effect-no-unsafe-effect-type-assertion',
    invalid: 'const narrowed = program as Effect.Effect<User, never, never>;',
    valid: 'const program: Effect.Effect<User, UserError, UserRepo> = loadUser;',
  },
  {
    name: 'effect-require-service-self-match',
    invalid: 'class UserRepo extends Context.Tag("UserRepo")<OrderRepo, Service>() {}',
    valid: 'class UserRepo extends Context.Tag("UserRepo")<UserRepo, Service>() {}',
  },
  {
    name: 'effect-no-effect-fn-iife',
    invalid: 'const program = Effect.fn("load")(function* () { return yield* load; })();',
    valid: 'export const load = Effect.fn("load")(function* () { return yield* repo.load; });',
  },
];

describe('Effect always-on rule behavior', () => {
  it('has one behavior case for every always-on rule', () => {
    expect(sorted(defaultCases.map((testCase) => testCase.name))).toStrictEqual(
      sorted(effectDefaultRuleNames),
    );
  });

  it.each(defaultCases)('detects and accepts always-on rule $name', (testCase) => {
    expect(runRule(testCase.name, testCase.invalid, testCase.filename)).toHaveLength(1);
    expect(runRule(testCase.name, testCase.valid, testCase.filename)).toHaveLength(0);
  });

  it.each(defaultCases)('keeps exported config behavior for always-on rule $name', (testCase) => {
    const config = theThracianOxlint();
    const invalidRuleNames = runConfiguredRules(config, testCase.invalid, testCase.filename).map(
      (report) => report.ruleName,
    );
    const validRuleNames = runConfiguredRules(config, testCase.valid, testCase.filename).map(
      (report) => report.ruleName,
    );

    expect(invalidRuleNames).toContain(testCase.name);
    expect(validRuleNames).not.toContain(testCase.name);
  });

  it.each([
    [
      'effect-no-console-log-in-effect-code',
      'import { Effect } from "effect"; console\n.log("x");',
    ],
    [
      'effect-no-process-env-in-effect-code',
      'import { Effect } from "effect"; process\n.env.API_TOKEN;',
    ],
    ['effect-no-date-now-in-effect-code', 'import { Effect } from "effect"; Date\n.now();'],
    ['effect-no-math-random-in-effect-code', 'import { Effect } from "effect"; Math\n.random();'],
    [
      'effect-no-new-promise',
      'import { Effect } from "effect"; const task = new\nPromise((resolve) => resolve(1));',
    ],
    [
      'effect-no-native-error-classes',
      'import { Effect } from "effect"; class UserError extends\nError {}',
    ],
  ])('keeps token gates broad enough for valid multiline syntax in %s', (ruleName, source) => {
    expect(runRule(ruleName, source)).toHaveLength(1);
  });

  it('keeps effect signal token groups broad enough for namespace imports', () => {
    expect(
      runRule(
        'effect-no-new-promise',
        'import * as E from "effect"; E.succeed(1); const task = new Promise((resolve) => resolve(1));',
      ),
    ).toHaveLength(1);
  });

  it('keeps floating Effect alias detection broad enough for multiline imports', () => {
    expect(
      runRule('effect-no-floating-effect', 'import { Effect as E } from\n"effect";\nE.succeed(1);'),
    ).toHaveLength(1);
  });

  it('uses precise token gates for common source-scan Effect rules', () => {
    const source = readFileSync(
      new URL('../../src/rules/effect-default.ts', import.meta.url),
      'utf-8',
    );

    expect(source).toContain("name: 'effect-no-effect-in-promise-callback'");
    expect(source).toContain("tokens: ['.then', '.catch']");
    expect(source).toContain("name: 'effect-require-typed-error-in-trypromise'");
    expect(source).toContain("tokens: ['tryPromise']");
    expect(source).toContain("name: 'effect-require-scoped-for-acquireRelease'");
    expect(source).toContain("tokens: ['acquireRelease']");
    expect(source).toContain("name: 'effect-no-known-fake-api'");
    expect(source).toContain("tokens: ['fromPromise', 'tryCatch', 'bracket', 'fromEither']");
    expect(source).toContain("name: 'effect-no-try-catch-in-effect-gen'");
    expect(source).toContain("tokenGroups: [['gen'], ['try']]");
  });
});
