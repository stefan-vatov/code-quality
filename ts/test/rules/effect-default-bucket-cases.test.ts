import { describe, expect, it } from 'vitest';
import { runConfiguredRules, runRule, sorted, withAllEffectRules } from './effect-rule-test-utils';
import type { RuleCase } from './effect-rule-test-utils';
import { effectDefaultRuleNames } from '../../src/rules/effect-rule-names';
import { readFileSync } from 'node:fs';
import theThracianOxlint from '../../src/index';

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
    name: 'effect-schema-no-redundant-tag-identifier',
    invalid:
      'import { Schema } from "effect"; ' +
      'class NotFound extends Schema.TaggedClass<NotFound>("NotFound")("NotFound", { id: Schema.String }) {}',
    valid:
      'import { Schema } from "effect"; ' +
      'class NotFound extends Schema.TaggedClass<NotFound>()("NotFound", { id: Schema.String }) {}',
  },
  {
    name: 'effect-no-floating-fiber',
    invalid: 'Effect.fork(worker);',
    valid: 'const fiber = yield* Effect.fork(worker); yield* Fiber.join(fiber);',
  },
  {
    name: 'effect-require-suspend-for-recursion',
    invalid: 'function loop() { return Effect.succeed(loop()); }',
    valid: 'function loop() { return Effect.flatMap(step, () => loop()); }',
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
    name: 'effect-no-catchAll-with-mapError',
    invalid: 'program.pipe(Effect.catchAll((error) => Effect.fail(new Wrapped({ error }))));',
    valid: 'program.pipe(Effect.mapError((error) => new Wrapped({ error })));',
  },
  {
    name: 'effect-require-error-cause-preserved',
    invalid: 'program.pipe(Effect.mapError(() => new WrappedError("x")));',
    valid: 'program.pipe(Effect.mapError((cause) => new WrappedError("x", { cause })));',
  },
  {
    name: 'effect-no-error-channel-widening-to-unknown',
    invalid: 'const p: Effect<string, unknown> = value;',
    valid: 'const p: Effect<string, DomainError> = value;',
  },
  {
    name: 'effect-no-runfork-without-observer',
    invalid: 'Effect.runFork(program);',
    valid: 'const fiber = Effect.runFork(program); fiber.addObserver(() => undefined);',
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
    name: 'effect-require-service-self-match',
    invalid: 'class UserRepo extends Context.Tag("UserRepo")<OrderRepo, Service>() {}',
    valid: 'class UserRepo extends Context.Tag("UserRepo")<UserRepo, Service>() {}',
  },
];

describe('retained non-strict Effect rule behavior', (): void => {
  it('has one behavior case for every retained non-strict rule', (): void => {
    expect(sorted(defaultCases.map((testCase) => testCase.name))).toStrictEqual(
      sorted(effectDefaultRuleNames),
    );
  });

  it.each(defaultCases)('detects and accepts retained non-strict rule $name', (testCase): void => {
    expect(runRule(testCase.name, testCase.invalid, testCase.filename)).toHaveLength(1);
    expect(runRule(testCase.name, testCase.valid, testCase.filename)).toHaveLength(0);
  });

  it.each(defaultCases)(
    'keeps explicitly selected config behavior for Effect rule $name',
    (testCase): void => {
      const config = withAllEffectRules(theThracianOxlint({ effect: true }));
      const invalidRuleNames = runConfiguredRules(config, testCase.invalid, testCase.filename).map(
        (report) => report.ruleName,
      );
      const validRuleNames = runConfiguredRules(config, testCase.valid, testCase.filename).map(
        (report) => report.ruleName,
      );

      expect(invalidRuleNames).toContain(testCase.name);
      expect(validRuleNames).not.toContain(testCase.name);
    },
  );

  it('keeps floating Effect alias detection broad enough for multiline imports', (): void => {
    expect(
      runRule('effect-no-floating-effect', 'import { Effect as E } from\n"effect";\nE.succeed(1);'),
    ).toHaveLength(1);
  });

  it('uses precise token gates for retained source-scan Effect rules', (): void => {
    const source = [
      '../../src/rules/effect-default.ts',
      '../../src/rules/effect-default-compat-rules.ts',
      '../../src/rules/effect-default-env-rules.ts',
    ]
      .map((path): string => readFileSync(new URL(path, import.meta.url), 'utf-8'))
      .join('\n');

    expect(source).toContain("name: 'effect-require-typed-error-in-trypromise'");
    expect(source).toContain("tokens: ['tryPromise']");
    expect(source).toContain("name: 'effect-require-scoped-for-acquireRelease'");
    expect(source).toContain("tokens: ['acquireRelease']");
    expect(source).toContain("name: 'effect-no-known-fake-api'");
    expect(source).toContain("tokens: ['fromPromise', 'tryCatch', 'bracket', 'fromEither']");
  });
});
