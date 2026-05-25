import { describe, expect, it } from 'vitest';
import { runRule } from './effect-rule-test-utils';

describe('Effect cycle 4 strict regression coverage', () => {
  it('does not let one scoped resource layer hide another unscoped resource layer', () => {
    const source = `
      const safe = Layer.scoped(Service, Effect.acquireRelease(openOne, closeOne));
      const unsafe = Layer.effect(Service, Effect.sync(() => openSocket()));
    `;

    expect(runRule('effect-require-scoped-for-resource-layers', source)).toHaveLength(1);
  });

  it('does not let one Schema decode hide another undecoded input boundary', () => {
    const source = `
      const safe = Schema.decodeUnknown(User)(request.body);
      const unsafe = command.payload;
    `;

    expect(runRule('effect-schema-require-validation-at-input-boundaries', source)).toHaveLength(1);
  });

  it('does not let one Schema decode hide another undecoded persistence read', () => {
    const source = `
      const safe = Schema.decodeUnknown(User)(row);
      const unsafe = db.select("users");
    `;

    expect(runRule('effect-schema-require-persistence-schema', source)).toHaveLength(1);
  });

  it('does not let one provided service hide another unprovided service in tests', () => {
    const source = `
      it.effect("provided", () =>
        program.pipe(Effect.provide(UserRepoTest))
      );

      it.effect("unprovided", () =>
        Effect.gen(function* () {
          return yield* UserRepo;
        })
      );
    `;

    expect(
      runRule('effect-require-provided-services-in-tests', source, 'src/user.test.ts'),
    ).toHaveLength(1);
  });

  it('does not let one TestClock test hide another time-dependent test', () => {
    const source = `
      it.effect("virtual", () =>
        Effect.gen(function* () {
          yield* TestClock.adjust("1 second");
        })
      );

      it.effect("real", () =>
        Effect.gen(function* () {
          yield* Effect.timeout(program, "1 second");
        })
      );
    `;

    expect(
      runRule('effect-require-testclock-for-time-code', source, 'src/user.test.ts'),
    ).toHaveLength(1);
  });

  it('does not let one Ref hide another mutable variable in Effect code', () => {
    const source = `
      const state = Ref.make(0);
      let leaked = 0;
      const program = Effect.succeed(leaked);
    `;

    expect(runRule('effect-require-ref-for-shared-mutable-state', source)).toHaveLength(1);
  });
});
