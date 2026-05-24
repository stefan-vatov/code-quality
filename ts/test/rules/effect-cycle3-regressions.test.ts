import { describe, expect, it } from 'vitest';
import { runAllRules, runRule } from './effect-rule-test-utils';

function reportedEffectRules(source: string, filename?: string, options?: object): string[] {
  return runAllRules(source, filename, options)
    .map((report) => report.ruleName)
    .filter((ruleName): ruleName is string => Boolean(ruleName?.startsWith('effect-')));
}

describe('Effect cycle 3 regression coverage', () => {
  it('allows pure Effect namespace predicates returned from Effect.gen', () => {
    const valid = `
      const program = Effect.gen(function* () {
        return Effect.isEffect(value);
      });
    `;

    const invalid = `
      const program = Effect.gen(function* () {
        return Effect.succeed(value);
      });
    `;

    expect(runRule('effect-require-return-yield-star', valid)).toHaveLength(0);
    expect(runRule('effect-require-return-yield-star', invalid)).toHaveLength(1);
  });

  it('does not treat domain Connection type names as resource allocations', () => {
    const valid = `
      type Connection = { readonly id: string };
      const program = Effect.succeed(connection);
    `;

    const invalid = `
      const program = Socket.open(url).pipe(
        Effect.map((socket) => socket)
      );
    `;

    expect(runRule('effect-require-scoped-for-resources', valid)).toHaveLength(0);
    expect(runRule('effect-require-scoped-for-resources', invalid)).toHaveLength(1);
  });

  it('detects pipe-style floating forks', () => {
    const invalid = `
      const program = Effect.gen(function* () {
        yield* worker.pipe(Effect.fork);
      });
    `;

    const joined = `
      const program = Effect.gen(function* () {
        const fiber = yield* worker.pipe(Effect.fork);
        return yield* Fiber.join(fiber);
      });
    `;

    const returned = `
      const program = Effect.gen(function* () {
        return yield* worker.pipe(Effect.fork);
      });
    `;

    expect(runRule('effect-no-floating-fiber', invalid)).toHaveLength(1);
    expect(runRule('effect-no-floating-fiber', joined)).toHaveLength(0);
    expect(runRule('effect-no-floating-fiber', returned)).toHaveLength(0);
  });

  it('does not let an observed same-name runFork hide a later unobserved fork', () => {
    const invalid = `
      function first() {
        const fiber = Effect.runFork(program);
        fiber.addObserver(() => undefined);
      }

      function second() {
        const fiber = Effect.runFork(otherProgram);
      }
    `;

    expect(runRule('effect-no-runfork-without-observer', invalid)).toHaveLength(1);
  });

  it('does not let a prior fiber join hide a later floating fork', () => {
    const invalid = `
      const program = Effect.gen(function* () {
        yield* Fiber.join(fiber);
        const fiber = yield* Effect.fork(worker);
        return value;
      });
    `;

    expect(runRule('effect-no-floating-fiber', invalid)).toHaveLength(1);
  });

  it('detects multiline bare piped Effect values', () => {
    const invalid = `
      program.pipe(
        Effect.map((value) => value)
      );
    `;

    const valid = `
      const transformed = program.pipe(
        Effect.map((value) => value)
      );
    `;

    expect(runRule('effect-no-floating-effect', invalid)).toHaveLength(1);
    expect(runRule('effect-no-floating-effect', valid)).toHaveLength(0);
  });

  it('checks object-form tryPromise catch handlers without being confused by nested objects', () => {
    const valid = `
      const task = Effect.tryPromise({
        try: () => Promise.resolve({ ok: true }),
        catch: (error) => new FetchError({ error })
      });
    `;

    const invalid = `
      const task = Effect.tryPromise({
        try: () => Promise.resolve({ ok: true })
      });
    `;

    expect(runRule('effect-require-typed-error-in-trypromise', valid)).toHaveLength(0);
    expect(runRule('effect-require-typed-error-in-trypromise', invalid)).toHaveLength(1);
  });

  it('does not let one scoped resource hide a separate unscoped resource workflow', () => {
    const source = `
      const scoped = Effect.scoped(Socket.open(url));
      const unscoped = Socket.open(otherUrl).pipe(Effect.map((socket) => socket));
    `;

    expect(runRule('effect-require-scoped-for-resources', source)).toHaveLength(1);
  });

  it('does not let one scoped layer hide a separate unscoped resource layer', () => {
    const source = `
      const SafeLayer = Layer.scoped(Database, openConnection);
      const UnsafeLayer = Layer.effect(SocketService, openSocket);
    `;

    expect(runRule('effect-require-scoped-for-resource-layers', source)).toHaveLength(1);
  });

  it('does not let one scoped loop hide another loop with unscoped resource acquisition', () => {
    const source = `
      for (const item of safeItems) {
        Effect.scoped(openConnection(item));
      }
      for (const item of unsafeItems) {
        openSocket(item);
      }
    `;

    expect(runRule('effect-require-scoped-in-loops', source)).toHaveLength(1);
  });

  it('does not let one scoped stream hide a separate unsafe resource stream', () => {
    const source = `
      const safe = Stream.scoped(openConnection());
      const unsafe = Stream.fromIterable(openSocket());
    `;

    expect(runRule('effect-require-stream-resource-safety', source)).toHaveLength(1);
  });

  it('does not let one Ref usage hide another unsafe mutable binding', () => {
    const source = `
      import { Effect, Ref } from "effect";

      const counter = Ref.make(0);
      let unsafeCounter = 0;
    `;

    expect(runRule('effect-require-ref-for-shared-mutable-state', source)).toHaveLength(1);
  });

  it('requires timeout on external calls without flagging imports', () => {
    const importOnly = 'import { HttpClient } from "@effect/platform";';
    const externalCall = 'const response = HttpClient.get(url);';
    const timed = 'const response = HttpClient.get(url).pipe(Effect.timeout("1 second"));';

    expect(runRule('effect-require-timeout-on-external-effects', importOnly)).toHaveLength(0);
    expect(runRule('effect-require-timeout-on-external-effects', externalCall)).toHaveLength(1);
    expect(runRule('effect-require-timeout-on-external-effects', timed)).toHaveLength(0);
  });

  it('requires retry policy for idempotent HttpClient calls', () => {
    const missingRetry = 'const response = HttpClient.get(url).pipe(Effect.timeout("1 second"));';
    const retried = 'const response = HttpClient.get(url).pipe(Effect.retry(policy));';

    expect(
      runRule('effect-require-retry-policy-for-idempotent-external-effects', missingRetry),
    ).toHaveLength(1);
    expect(
      runRule('effect-require-retry-policy-for-idempotent-external-effects', retried),
    ).toHaveLength(0);
  });

  it('does not treat distinct layer constants as duplicate layer instances', () => {
    const distinct = `
      const UserLayer = Layer.succeed(UserRepo, userRepo);
      const ClockLayer = Layer.succeed(Clock, clock);
    `;
    const duplicate = `
      const FirstUserLayer = Layer.succeed(UserRepo, userRepo);
      const SecondUserLayer = Layer.succeed(UserRepo, userRepo);
    `;

    expect(runRule('effect-no-duplicate-layer-instances', distinct)).toHaveLength(0);
    expect(runRule('effect-no-duplicate-layer-instances', duplicate)).toHaveLength(1);
  });

  it('uses typed Effect error channels instead of the global Error type', () => {
    const validSuccessNames = `
      const value: Effect.Effect<UserEnv, UserError, RuntimeContext> = program;
    `;
    const invalidGlobalError = `
      const value: Effect.Effect<User, Error, Env> = program;
    `;

    expect(runRule('effect-no-global-error-channel', validSuccessNames)).toHaveLength(0);
    expect(runRule('effect-no-global-error-channel', invalidGlobalError)).toHaveLength(1);
  });

  it('passes strict path options through all-rule diagnostics', () => {
    const options = { configLayers: ['settings/**'] };
    const rules = reportedEffectRules('process.env.API_TOKEN;', 'settings/config.ts', options);

    expect(rules).not.toContain('effect-no-direct-process-env-outside-config-layer');
  });

  it('keeps a canonical world-class Effect module clean across all Effect rules', () => {
    const source = `
      import { Context, Effect, Schema } from "effect";

      class UserRepo extends Context.Tag("UserRepo")<
        UserRepo,
        { readonly load: Effect.Effect<User, UserError, never> }
      >() {}

      class User extends Schema.TaggedClass<User>("User")("User", {
        id: Schema.String
      }) {}

      class UserError extends Schema.TaggedClass<UserError>("UserError")("UserError", {
        cause: Schema.Unknown
      }) {}

      export const loadUser = Effect.fn("loadUser")(function* () {
        return yield* Effect.succeed(new User({ id: "user-1" }));
      });
    `;

    expect(reportedEffectRules(source, 'src/domain/user.ts')).toStrictEqual([]);
  });
});
