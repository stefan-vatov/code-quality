import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import plugin from '../../src/rules/plugin';
import { runAllRules, runRule, runRuleAtPath } from './effect-rule-test-utils';
import type { Report } from './effect-rule-test-utils';

describe('Effect review overlap regressions', () => {
  function reportedEffectRules(source: string, filename?: string): string[] {
    return runAllRules(source, filename)
      .map((report) => report.ruleName)
      .filter((ruleName): ruleName is string => Boolean(ruleName?.startsWith('effect-')));
  }

  it('does not duplicate string and untagged error diagnostics', () => {
    expect(reportedEffectRules('const failure = Effect.fail("bad");')).toStrictEqual([
      'effect-no-string-errors',
    ]);
  });

  it('does not duplicate catchAll-to-mapError diagnostics', () => {
    const source = `
      const recovered = program.pipe(
        Effect.catchAll((error) => Effect.fail(new Wrapped({ error })))
      );
    `;

    expect(reportedEffectRules(source)).toStrictEqual(['effect-no-catchAll-with-mapError']);
  });

  it('still reports broad catchAll when a separate rethrow is mapped in the same file', () => {
    const source = `
      const transformed = first.pipe(
        Effect.catchAll((error) => Effect.fail(new Wrapped({ error })))
      );
      const recovered = second.pipe(
        Effect.catchAll(() => Effect.succeed(null))
      );
    `;

    expect(runRule('effect-prefer-catchTag-over-catchAll', source)).toHaveLength(1);
  });

  it('does not duplicate exported Effect.gen API diagnostics', () => {
    const exportedConst = `
      export const load = () => Effect.gen(function* () {
        return yield* loadUser;
      });
    `;
    const exportedFunction = `
      export function load() {
        return Effect.gen(function* () {
          return yield* loadUser;
        });
      }
    `;

    expect(reportedEffectRules(exportedConst)).toStrictEqual(['effect-no-function-returning-gen']);
    expect(reportedEffectRules(exportedFunction)).toStrictEqual([
      'effect-no-function-returning-gen',
    ]);
  });

  it('does not require onExit for correctly scoped acquireRelease resources', () => {
    const source = 'Effect.scoped(Effect.acquireRelease(openConnection, cleanup));';

    expect(runRule('effect-require-onExit-for-cleanup', source)).toHaveLength(0);
  });

  it('does not let one scoped acquireRelease hide another unscoped acquireRelease', () => {
    const source = `
      const scoped = Effect.scoped(Effect.acquireRelease(openOne, closeOne));
      const unscoped = Effect.acquireRelease(openTwo, closeTwo);
    `;

    expect(runRule('effect-require-scoped-for-acquireRelease', source)).toHaveLength(1);
  });

  it('does not let one acquireRelease hide a separate unreleased resource acquisition', () => {
    const source = `
      const managed = Effect.acquireRelease(openConnection, closeConnection);
      const raw = Effect.sync(() => openSocket());
    `;

    expect(runRule('effect-require-acquire-release', source)).toHaveLength(1);
  });

  it('does not let one Effect.suspend hide unrelated eager Effect construction', () => {
    const source = `
      const deferred = Effect.suspend(() => Effect.succeed(Date.now()));
      const eager = Effect.succeed(Date.now());
    `;

    expect(runRule('effect-require-suspend-for-lazy-evaluation', source)).toHaveLength(1);
  });

  it('checks runFork observation per fork instead of per file', () => {
    const source = `
      const observed = Effect.runFork(program);
      observed.addObserver(() => undefined);
      Effect.runFork(otherProgram);
    `;

    expect(runRule('effect-no-runfork-without-observer', source)).toHaveLength(1);
  });

  it('checks TestClock fork ordering per test body instead of per file', () => {
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

  it('allows current HttpClient request effects without requiring per-request scoping', () => {
    const source = 'const response = yield* HttpClient.get(url);';

    expect(runRule('effect-require-scoped-for-resources', source)).toHaveLength(0);
  });

  it('allows current Effect types whose success channel name looks environment-like', () => {
    const source = 'const value: Effect.Effect<UserEnv, DomainError, RuntimeContext> = program;';

    expect(runRule('effect-no-global-error-channel', source)).toHaveLength(0);
  });

  it('allows service tags in configured domain service contracts', () => {
    const source = `
      class UserRepo extends Context.Tag("UserRepo")<UserRepo, Service>() {}
    `;

    expect(
      runRule('effect-no-leaked-service-dependencies', source, 'src/domain/user.ts'),
    ).toHaveLength(0);
  });

  it('requires typed catch handlers for object-form tryPromise', () => {
    const source = 'const task = Effect.tryPromise({ try: () => fetch("/users") });';

    expect(runRule('effect-require-typed-error-in-trypromise', source)).toHaveLength(1);
  });

  it('allows returned fibers as explicit ownership transfer', () => {
    const source = `
      const program = Effect.gen(function* () {
        return yield* Effect.fork(worker);
      });
    `;

    expect(runRule('effect-no-floating-fiber', source)).toHaveLength(0);
  });

  it('allows ignored failures that are logged before being ignored', () => {
    const valid = `
      import { Effect } from "effect";

      const program = loadUser.pipe(
        Effect.tapError((error) => Effect.logError(error)),
        Effect.ignore
      );
    `;

    const invalid = `
      import { Effect } from "effect";

      const program = loadUser.pipe(Effect.ignore);
    `;

    expect(runRule('effect-prefer-ignore-logged', valid)).toHaveLength(0);
    expect(runRule('effect-prefer-ignore-logged', invalid)).toHaveLength(1);
  });

  it('does not let one logged ignore hide a separate unlogged ignore', () => {
    const source = `
      const observed = first.pipe(
        Effect.tapError((error) => Effect.logError(error)),
        Effect.ignore
      );
      const hidden = second.pipe(Effect.ignore);
    `;

    expect(runRule('effect-prefer-ignore-logged', source)).toHaveLength(1);
  });

  it('allows TestClock adjustment after the time-dependent work is forked', () => {
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

  it('does not let TestClock usage hide a real sleep in another test', () => {
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

  it('allows memoized Layer constants and rejects layer factories', () => {
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

  it('allows service construction inside layers but not in domain logic', () => {
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

  it('keeps Schema sync, Promise, and parse-error rules non-overlapping', () => {
    const syncDecodeInsideEffect = `
      import { Effect, Schema } from "effect";

      const program = Effect.gen(function* () {
        return Schema.decodeUnknownSync(User)(payload);
      });
    `;

    const promiseDecode = `
      import { Schema } from "effect";

      const user = Schema.decodeUnknownPromise(User)(payload);
    `;

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
      runRule('effect-schema-no-unsafe-sync-decode-in-effect-code', syncDecodeInsideEffect),
    ).toHaveLength(1);
    expect(
      runRule('effect-schema-prefer-decodeUnknown-effect', syncDecodeInsideEffect),
    ).toHaveLength(0);
    expect(runRule('effect-schema-prefer-decodeUnknown-effect', promiseDecode)).toHaveLength(1);
    expect(runRule('effect-schema-require-parse-error-handling', promiseDecode)).toHaveLength(0);
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

  it('names current-style generator adapter guidance without deprecated API wording', () => {
    const adapterGen = `
      import { Effect } from "effect";

      const program = Effect.gen(function* ($) {
        return yield* $(loadUser);
      });
    `;

    expect(plugin.rules).not.toHaveProperty('effect-no-deprecated-gen-adapter');
    expect(runRule('effect-prefer-direct-yield-star', adapterGen)[0]?.message).toContain(
      'yield* effect',
    );
    expect(runRule('effect-prefer-direct-yield-star', adapterGen)[0]?.message).not.toContain(
      'deprecated',
    );
  });

  it('uses current Schema.parseJson naming for JSON string decoding guidance', () => {
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

  it('honors configured strict unit and integration test globs', () => {
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
});
