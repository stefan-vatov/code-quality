import { describe, expect, it } from 'vitest';
import { runRule } from './effect-rule-test-utils';

const registerConfigurationAndAPITests = (): void => {
  it('does not label current Effect APIs as fake or deprecated', () => {
    const valid = `
      import { Context, Effect } from "effect";

      const fromMaybe = Effect.fromNullable("value");
      class UserRepo extends Context.Tag("UserRepo")<UserRepo, {
        readonly load: (id: string) => Effect.Effect<User>
      }>() {}
    `;

    const invalid = `
      import { Effect } from "effect";

      const fromPromise = Effect.fromPromise(() => fetch("/users"));
      const fromEither = Effect.fromEither(eitherValue);
      const LegacyRepo = Context.Tag<UserRepo>("UserRepo");
    `;

    expect(runRule('effect-no-known-fake-api', valid)).toHaveLength(0);
    expect(runRule('effect-no-known-fake-api', invalid)).toHaveLength(1);
  });

  it('does not flag the valid service and scoped-resource patterns strict rules require', () => {
    const scopedResource = `
      import { Effect } from "effect";

      export const resource = Effect.scoped(
        Effect.acquireRelease(openConnection, (connection) => connection.close())
      );
    `;
    expect(runRule('effect-require-scoped-for-acquireRelease', scopedResource)).toHaveLength(0);
  });
};

const registerSuppressionAndFiberTests = (): void => {
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
};

describe('Effect review regression coverage', (): void => {
  registerConfigurationAndAPITests();
  registerSuppressionAndFiberTests();
});
