import { describe, expect, it } from 'vitest';
import { runAllRules, runRule } from './effect-rule-test-utils';

const registerEffectAndFiberTests = (): void => {
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
};

const registerResourceAndPolicyTests = (): void => {
  it('does not let one scoped resource hide a separate unscoped resource workflow', () => {
    const source = `
      const scoped = Effect.scoped(Socket.open(url));
      const unscoped = Socket.open(otherUrl).pipe(Effect.map((socket) => socket));
    `;

    expect(runRule('effect-require-scoped-for-resources', source)).toHaveLength(1);
  });

  it('keeps a canonical world-class Effect module clean across all Effect rules', () => {
    const source = `
      import { Context, Effect, Schema } from "effect";

      class UserRepo extends Context.Tag("UserRepo")<
        UserRepo,
        { readonly load: Effect.Effect<User, UserError, never> }
      >() {}

      class User extends Schema.TaggedClass<User>()("User", {
        id: Schema.String
      }) {}

      class UserError extends Schema.TaggedClass<UserError>()("UserError", {
        cause: Schema.Unknown
      }) {}

      export const loadUser = Effect.fn("loadUser")(function* () {
        return yield* Effect.succeed(new User({ id: "user-1" }));
      });
    `;

    expect(runAllRules(source, 'src/domain/user.ts')).toStrictEqual([]);
  });
};

describe('Effect cycle 3 regression coverage', (): void => {
  registerEffectAndFiberTests();
  registerResourceAndPolicyTests();
});
