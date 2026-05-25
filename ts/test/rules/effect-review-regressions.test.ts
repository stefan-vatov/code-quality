import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import plugin from '../../src/rules/plugin';
import { runAllRules, runRule, runRuleAtPath } from './effect-rule-test-utils';
import type { Report } from './effect-rule-test-utils';

describe('Effect review regression coverage', () => {
  it('does not reuse stale source after a file changes at the same path', () => {
    const root = mkdtempSync(join(tmpdir(), 'thx-effect-review-stale-'));
    const filePath = join(root, 'src/domain/user.ts');
    const reports: Report[] = [];

    mkdirSync(dirname(filePath), { recursive: true });

    try {
      writeFileSync(filePath, 'import { Effect } from "effect";\nEffect.fail(new Error("bad"));\n');
      runRuleAtPath('effect-no-untagged-errors', filePath, reports);

      writeFileSync(
        filePath,
        'import { Effect } from "effect";\nEffect.fail(new TaggedError());\n',
      );
      runRuleAtPath('effect-no-untagged-errors', filePath, reports);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }

    expect(reports).toHaveLength(1);
  });

  it('honors consumer strict project path configuration instead of only hardcoded src globs', () => {
    const options = {
      entrypoints: ['workers/main.ts'],
      configLayers: ['settings/config.ts'],
    };

    const entrypoint = `
      import { Effect } from "effect";

      export const main = () => Effect.runPromise(program);
    `;

    const configLayer = `
      import { Config } from "effect";

      export const port = Config.integer("PORT");
    `;

    expect(
      runRule('effect-no-run-outside-entrypoints', entrypoint, 'workers/main.ts', options),
    ).toHaveLength(0);
    expect(
      runRule(
        'effect-no-direct-process-env-outside-config-layer',
        'process.env.PORT',
        'settings/config.ts',
        options,
      ),
    ).toHaveLength(0);
    expect(
      runRule('effect-schema-require-config-schema', configLayer, 'settings/config.ts', options),
    ).toHaveLength(1);
  });

  it('does not make catchTag both required and forbidden', () => {
    const singleSpecificRecovery = `
      import { Effect } from "effect";

      const program = loadUser.pipe(
        Effect.catchTag("NotFound", () => Effect.succeed(null))
      );
    `;

    const repeatedSpecificRecovery = `
      import { Effect } from "effect";

      const program = loadUser.pipe(
        Effect.catchTag("NotFound", () => Effect.succeed(null)),
        Effect.catchTag("PermissionDenied", () => Effect.succeed(null))
      );
    `;

    expect(runRule('effect-prefer-catchTag-over-catchAll', singleSpecificRecovery)).toHaveLength(0);
    expect(plugin.rules).not.toHaveProperty('effect-require-exhaustive-catchTags');
    expect(
      runRule('effect-prefer-catchTags-for-multiple-tags', singleSpecificRecovery),
    ).toHaveLength(0);
    expect(
      runRule('effect-prefer-catchTags-for-multiple-tags', repeatedSpecificRecovery)[0]?.message,
    ).toContain('Effect.catchTags');
  });

  it('does not label current Effect APIs as fake or deprecated', () => {
    const valid = `
      import { Config, Context, Effect } from "effect";

      const fromMaybe = Effect.fromNullable("value");
      const apiKey = Config.redacted("API_TOKEN");
      class UserRepo extends Context.Tag("UserRepo")<UserRepo, {
        readonly load: (id: string) => Effect.Effect<User>
      }>() {}
    `;

    const invalid = `
      import { Config, Effect } from "effect";

      const legacySecret = Config.secret("API_TOKEN");
      const fromPromise = Effect.fromPromise(() => fetch("/users"));
      const fromEither = Effect.fromEither(eitherValue);
      const LegacyRepo = Context.Tag<UserRepo>("UserRepo");
    `;

    expect(runRule('effect-no-known-fake-api', valid)).toHaveLength(0);
    expect(runRule('effect-no-deprecated-context-tag-function', valid)).toHaveLength(0);
    expect(runRule('effect-no-known-fake-api', invalid)).toHaveLength(1);
    expect(plugin.rules).not.toHaveProperty('effect-no-deprecated-config-secret');
    expect(runRule('effect-prefer-config-redacted', invalid)[0]?.message).toContain(
      'Config.redacted',
    );
    expect(runRule('effect-prefer-config-redacted', invalid)[0]?.message).not.toContain(
      'deprecated',
    );
    expect(runRule('effect-no-deprecated-context-tag-function', invalid)).toHaveLength(1);
  });

  it('only reports runtime execution when it is actually inside Effect composition', () => {
    const boundaryRunInSameFile = `
      import { Effect } from "effect";

      const program = Effect.gen(function* () {
        return yield* loadUser;
      });

      export const main = () => Effect.runPromise(program);
    `;

    const nestedRun = `
      import { Effect } from "effect";

      const program = Effect.gen(function* () {
        return yield* Effect.promise(() => Effect.runPromise(loadUser));
      });
    `;

    const nestedFnRun = `
      import { Effect } from "effect";

      export const load = Effect.fn("load")(function* () {
        return yield* Effect.promise(() => Effect.runPromise(loadUser));
      });
    `;

    expect(runRule('effect-no-run-inside-effect', boundaryRunInSameFile)).toHaveLength(0);
    expect(runRule('effect-no-run-inside-effect', nestedRun)).toHaveLength(1);
    expect(runRule('effect-no-run-inside-effect', nestedFnRun)).toHaveLength(1);
  });

  it('does not require Effect.fn for exported helpers that call non-effect Effect APIs', () => {
    const predicateHelper = `
      import { Effect } from "effect";

      export const isEffectValue = (value: unknown) => Effect.isEffect(value);
    `;

    const serviceAccessor = `
      import { Effect } from "effect";

      export const loadUser = Effect.serviceFunction(UserRepo, (_) => _.load);
    `;

    expect(runRule('effect-prefer-effect-fn-for-exported-effects', predicateHelper)).toHaveLength(
      0,
    );
    expect(runRule('effect-prefer-effect-fn-for-exported-effects', serviceAccessor)).toHaveLength(
      0,
    );
  });

  it('does not flag the valid service and scoped-resource patterns strict rules require', () => {
    const validService = `
      import { Context } from "effect";

      class UserRepo extends Context.Tag("UserRepo")<UserRepo, {
        readonly load: (id: string) => Effect.Effect<User>
      }>() {}
    `;

    const legacyService = `
      import { Context } from "effect";

      const UserRepo = Context.GenericTag<UserRepo>("UserRepo");
    `;

    const scopedResource = `
      import { Effect } from "effect";

      export const resource = Effect.scoped(
        Effect.acquireRelease(openConnection, (connection) => connection.close())
      );
    `;

    expect(runRule('effect-require-service-class-pattern', validService)).toHaveLength(0);
    expect(runRule('effect-require-service-class-pattern', legacyService)).toHaveLength(1);
    expect(runRule('effect-require-scoped-for-acquireRelease', scopedResource)).toHaveLength(0);
  });

  it('accepts the documented TestClock fork-adjust-join order', () => {
    const valid = `
      import { Duration, Effect, Fiber, TestClock } from "effect";

      const program = Effect.gen(function* () {
        const fiber = yield* Effect.sleep(Duration.minutes(5)).pipe(Effect.fork);
        yield* TestClock.adjust(Duration.minutes(1));
        return yield* Fiber.join(fiber);
      });
    `;

    const invalid = `
      import { Duration, Effect, TestClock } from "effect";

      const program = Effect.gen(function* () {
        yield* TestClock.adjust(Duration.minutes(1));
        return yield* Effect.sleep(Duration.minutes(5));
      });
    `;

    expect(runRule('effect-testClock-requires-fork', valid, 'src/user.test.ts')).toHaveLength(0);
    expect(runRule('effect-testClock-requires-fork', invalid, 'src/user.test.ts')).toHaveLength(1);
  });

  it('treats Effect.Do as a generator-style preference, not a deprecated API', () => {
    const doNotation = `
      import { Effect } from "effect";

      const program = Effect.Do.pipe(
        Effect.bind("user", () => loadUser)
      );
    `;

    expect(plugin.rules).not.toHaveProperty('effect-no-deprecated-do-notation');
    expect(runRule('effect-prefer-gen-over-do', doNotation)[0]?.message).toContain(
      'Prefer Effect.gen over Effect.Do',
    );
  });

  it('allows documented synchronous Schema decoding outside Effect workflows', () => {
    const pureSchemaUtility = `
      import * as Schema from "effect/Schema";

      export const parseUser = Schema.decodeUnknownSync(User);
    `;

    const effectWorkflow = `
      import { Effect, Schema } from "effect";

      const program = Effect.gen(function* () {
        return Schema.decodeUnknownSync(User)(payload);
      });
    `;

    const mixedModule = `
      import { Effect, Schema } from "effect";

      export const parseUser = Schema.decodeUnknownSync(User);
      export const program = Effect.gen(function* () {
        return yield* loadUser;
      });
    `;

    expect(runRule('effect-schema-prefer-decodeUnknown-effect', pureSchemaUtility)).toHaveLength(0);
    expect(runRule('effect-schema-prefer-decodeUnknown-effect', effectWorkflow)).toHaveLength(0);
    expect(
      runRule('effect-schema-no-unsafe-sync-decode-in-effect-code', pureSchemaUtility),
    ).toHaveLength(0);
    expect(
      runRule('effect-schema-no-unsafe-sync-decode-in-effect-code', effectWorkflow),
    ).toHaveLength(1);
    expect(runRule('effect-schema-no-unsafe-sync-decode-in-effect-code', mixedModule)).toHaveLength(
      0,
    );
  });

  it('accepts precise Effect rule suppressions with a reason and tracking ticket', () => {
    const valid = `
      // oxlint-disable-next-line thethracian/effect-no-throw -- reason: generated compatibility shim ABC-123
      risky();
      // eslint-disable-next-line thethracian/effect-no-throw -- because legacy interop #456
      riskyAgain();
    `;

    const invalid = `
      // oxlint-disable-next-line thethracian/effect-no-throw
      risky();
    `;

    expect(runRule('effect-require-effect-suppression-reason-and-ticket', valid)).toHaveLength(0);
    expect(runRule('effect-require-effect-suppression-reason-and-ticket', invalid)).toHaveLength(1);
  });

  it('allows forked fibers that are explicitly joined', () => {
    const valid = `
      import { Effect, Fiber } from "effect";

      const program = Effect.gen(function* () {
        const fiber = yield* Effect.fork(loadUser);
        return yield* Fiber.join(fiber);
      });
    `;

    const invalid = `
      import { Effect } from "effect";

      const program = Effect.gen(function* () {
        yield* Effect.fork(loadUser);
      });
    `;

    expect(runRule('effect-no-floating-fiber', valid)).toHaveLength(0);
    expect(runRule('effect-no-floating-fiber', invalid)).toHaveLength(1);
  });

  it('allows runFork when the returned fiber is observed', () => {
    const valid = `
      import { Effect } from "effect";

      const fiber = Effect.runFork(program);
      fiber.addObserver(() => undefined);
    `;

    const invalid = `
      import { Effect } from "effect";

      Effect.runFork(program);
    `;

    expect(runRule('effect-no-runfork-without-observer', valid)).toHaveLength(0);
    expect(runRule('effect-no-runfork-without-observer', invalid)).toHaveLength(1);
  });

  it('does not let one observed fork hide an unrelated floating fork', () => {
    const invalid = `
      import { Effect, Fiber } from "effect";

      const program = Effect.gen(function* () {
        const observed = yield* Effect.fork(loadUser);
        yield* Fiber.join(observed);
        yield* Effect.fork(sendTelemetry);
      });
    `;

    expect(runRule('effect-no-floating-fiber', invalid)).toHaveLength(1);
  });

  it('detects floating Effect values that are not direct Effect namespace calls', () => {
    const pipedProgram = `
      import { Effect } from "effect";

      program.pipe(Effect.map((value) => value));
    `;

    const schemaDecode = `
      import { Schema } from "effect";

      Schema.decodeUnknown(User)(payload);
    `;

    expect(runRule('effect-no-floating-effect', pipedProgram)).toHaveLength(1);
    expect(runRule('effect-no-floating-effect', schemaDecode)).toHaveLength(1);
  });

  it('does not treat explicit runtime boundaries as floating lazy Effects', () => {
    const boundaryCalls = `
      import { Effect } from "effect";

      Effect.runPromise(program);
      Effect.runPromiseExit(program);
      Effect.runSync(program);
      Effect.runSyncExit(program);
      Effect.runFork(program);
    `;

    expect(runRule('effect-no-floating-effect', boundaryCalls, 'src/main.ts')).toHaveLength(0);
  });

  it('reports each string failure occurrence instead of collapsing the file to one diagnostic', () => {
    const invalid = `
      import { Effect } from "effect";

      Effect.fail("first");
      Effect.fail("second");
    `;

    expect(runRule('effect-no-string-errors', invalid)).toHaveLength(2);
  });

  it('emits one canonical diagnostic for deprecated schema package imports', () => {
    const invalid = 'import { Schema } from "@effect/schema";';
    const effectRuleNames = runAllRules(invalid)
      .map((report) => report.ruleName)
      .filter((ruleName) => ruleName?.startsWith('effect-'));

    expect(effectRuleNames).toStrictEqual(['effect-no-deprecated-schema-package']);
  });
});
