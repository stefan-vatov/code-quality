import { describe, expect, it } from 'vitest';
import plugin from '../../src/rules/plugin';
import { runAllRules, runRule } from './effect-rule-test-utils';

const reportedEffectRules = (source: string, filename?: string): string[] =>
  runAllRules(source, filename)
    .map((report) => report.ruleName)
    .filter((ruleName): ruleName is string => Boolean(ruleName?.startsWith('effect-')));

const registerResourceAndFiberOverlapTests = (): void => {
  it('does not duplicate catchAll-to-mapError diagnostics', (): void => {
    const source = `
      const recovered = program.pipe(
        Effect.catchAll((error) => Effect.fail(new Wrapped({ error })))
      );
    `;

    expect(reportedEffectRules(source)).toStrictEqual(['effect-no-catchAll-with-mapError']);
  });

  it('does not require onExit for correctly scoped acquireRelease resources', (): void => {
    const source = 'Effect.scoped(Effect.acquireRelease(openConnection, cleanup));';

    expect(runRule('effect-require-onExit-for-cleanup', source)).toHaveLength(0);
  });

  it('does not let one scoped acquireRelease hide another unscoped acquireRelease', (): void => {
    const source = `
      const scoped = Effect.scoped(Effect.acquireRelease(openOne, closeOne));
      const unscoped = Effect.acquireRelease(openTwo, closeTwo);
    `;

    expect(runRule('effect-require-scoped-for-acquireRelease', source)).toHaveLength(1);
  });

  it('does not let one acquireRelease hide a separate unreleased resource acquisition', (): void => {
    const source = `
      const managed = Effect.acquireRelease(openConnection, closeConnection);
      const raw = Effect.sync(() => openSocket());
    `;

    expect(runRule('effect-require-acquire-release', source)).toHaveLength(1);
  });

  it('checks runFork observation per fork instead of per file', (): void => {
    const source = `
      const observed = Effect.runFork(program);
      observed.addObserver(() => undefined);
      Effect.runFork(otherProgram);
    `;

    expect(runRule('effect-no-runfork-without-observer', source)).toHaveLength(1);
  });

  it('checks TestClock fork ordering per test body instead of per file', (): void => {
    const source = `
      it.effect("forks", () =>
        Effect.gen(function* () {
          const fiber = yield* Effect.fork(Effect.sleep("1 second"));
          yield* TestClock.adjust("1 second");
          yield* fiber.await;
        })
      );

      it.effect("does not fork", () =>
        Effect.gen(function* () {
          yield* TestClock.adjust("1 second");
          yield* Effect.sleep("1 second");
        })
      );
    `;

    expect(runRule('effect-testClock-requires-fork', source, 'src/user.test.ts')).toHaveLength(1);
  });

  it('allows current HttpClient request effects without requiring per-request scoping', (): void => {
    const source = 'const response = yield* HttpClient.get(url);';

    expect(runRule('effect-require-scoped-for-resources', source)).toHaveLength(0);
  });

  it('allows service tags in configured domain service contracts', (): void => {
    const source = `
      class UserRepo extends Context.Tag("UserRepo")<UserRepo, Service>() {}
    `;

    expect(
      runRule('effect-no-leaked-service-dependencies', source, 'src/domain/user.ts'),
    ).toHaveLength(0);
  });

  it('requires typed catch handlers for object-form tryPromise', (): void => {
    const source = 'const task = Effect.tryPromise({ try: () => fetch("/users") });';

    expect(runRule('effect-require-typed-error-in-trypromise', source)).toHaveLength(1);
  });

  it('allows returned fibers as explicit ownership transfer', (): void => {
    const source = `
      const program = Effect.gen(function* () {
        return yield* Effect.fork(worker);
      });
    `;

    expect(runRule('effect-no-floating-fiber', source)).toHaveLength(0);
  });

  it('allows TestClock adjustment after the time-dependent work is forked', (): void => {
    const valid = `
      import { Effect, TestClock } from "effect";
      import { it } from "@effect/vitest";

      it.effect("waits deterministically", () =>
        Effect.gen(function* () {
          const fiber = yield* Effect.fork(Effect.sleep("1 second"));
          yield* TestClock.adjust("1 second");
          yield* fiber.await;
        })
      );
    `;

    const invalid = `
      import { Effect, TestClock } from "effect";
      import { it } from "@effect/vitest";

      it.effect("waits deterministically", () =>
        Effect.gen(function* () {
          yield* TestClock.adjust("1 second");
          yield* Effect.sleep("1 second");
        })
      );
    `;

    expect(runRule('effect-testClock-requires-fork', valid, 'src/user.test.ts')).toHaveLength(0);
    expect(runRule('effect-testClock-requires-fork', invalid, 'src/user.test.ts')).toHaveLength(1);
  });

  it('does not let TestClock usage hide a real sleep in another test', (): void => {
    const source = `
      it.effect("virtual", () =>
        Effect.gen(function* () {
          yield* TestClock.adjust("1 second");
        })
      );

      it.effect("real", () =>
        Effect.gen(function* () {
          yield* Effect.sleep("1 second");
        })
      );
    `;

    expect(runRule('effect-no-real-sleep-in-tests', source, 'src/user.test.ts')).toHaveLength(1);
  });
};

const registerLayerAndSchemaOverlapTests = (): void => {
  it('allows memoized Layer constants and rejects layer factories', (): void => {
    const valid = `
      import { Layer } from "effect";

      export const UserRepoLayer = Layer.succeed(UserRepo, service);
    `;

    const invalid = `
      import { Layer } from "effect";

      export const makeUserRepoLayer = () => Layer.succeed(UserRepo, service);
    `;

    expect(runRule('effect-require-layer-memoization-constant', valid)).toHaveLength(0);
    expect(runRule('effect-require-layer-memoization-constant', invalid)).toHaveLength(1);
  });

  it('allows service construction inside layers but not in domain logic', (): void => {
    const valid = `
      import { Layer } from "effect";

      export const UserRepoLayer = Layer.succeed(UserRepo, new UserRepoService());
    `;

    const invalid = `
      export const repo = new UserRepoService();
    `;

    expect(
      runRule('effect-no-service-construction-outside-layer', valid, 'src/layers/user.ts'),
    ).toHaveLength(0);
    expect(runRule('effect-no-service-construction-outside-layer', invalid)).toHaveLength(1);
  });

  it('keeps Schema parse-error diagnostics non-overlapping', (): void => {
    const propagatedEffectDecode = `
      import { Schema } from "effect";

      return Schema.decodeUnknown(User)(payload);
    `;

    const yieldedEffectDecode = `
      import { Effect, Schema } from "effect";

      const program = Effect.gen(function* () {
        const user = yield* Schema.decodeUnknown(User)(payload);
        return user;
      });
    `;

    const unsafeParseErrorHandling = `
      import { Schema, Effect } from "effect";

      const user = Schema.decodeUnknown(User)(payload).pipe(Effect.orDie);
    `;

    expect(
      runRule('effect-schema-require-parse-error-handling', propagatedEffectDecode),
    ).toHaveLength(0);
    expect(runRule('effect-schema-require-parse-error-handling', yieldedEffectDecode)).toHaveLength(
      0,
    );
    expect(
      runRule('effect-schema-require-parse-error-handling', unsafeParseErrorHandling),
    ).toHaveLength(1);
  });

  it('uses current Schema.parseJson naming for JSON string decoding guidance', (): void => {
    const jsonStringDecode = `
      import { Schema } from "effect";

      const user = Schema.decodeUnknown(User)(JSON.parse(body));
    `;

    expect(plugin.rules).not.toHaveProperty(
      'effect-schema-require-fromJsonString-for-json-strings',
    );
    expect(
      runRule('effect-schema-require-parseJson-for-json-strings', jsonStringDecode)[0]?.message,
    ).toContain('Schema.parseJson');
    expect(
      runRule('effect-schema-require-parseJson-for-json-strings', jsonStringDecode)[0]?.message,
    ).not.toContain('fromJsonString');
  });

  it('honors configured strict unit and integration test globs', (): void => {
    const options = {
      integrationTests: ['tests/integration/**'],
      unitTests: ['tests/unit/**'],
    };
    const liveLayer = 'const layer = UserRepoLive;';
    const realLayer = 'const layer = realUserRepo;';

    expect(
      runRule('effect-no-live-services-in-unit-tests', liveLayer, 'tests/unit/user.ts', options),
    ).toHaveLength(1);
    expect(
      runRule('effect-prefer-in-memory-implementations', liveLayer, 'tests/unit/user.ts', options),
    ).toHaveLength(0);
    expect(
      runRule('effect-prefer-in-memory-implementations', realLayer, 'tests/unit/user.ts', options),
    ).toHaveLength(1);
    expect(
      runRule('effect-no-live-services-in-unit-tests', realLayer, 'tests/unit/user.ts', options),
    ).toHaveLength(0);
    expect(
      runRule(
        'effect-no-live-services-in-unit-tests',
        liveLayer,
        'tests/integration/user.ts',
        options,
      ),
    ).toHaveLength(0);
  });
};

describe('Effect review overlap regressions', (): void => {
  registerResourceAndFiberOverlapTests();
  registerLayerAndSchemaOverlapTests();
});
