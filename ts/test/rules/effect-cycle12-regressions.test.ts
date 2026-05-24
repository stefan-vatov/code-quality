import { describe, expect, it } from 'vitest';
import { runRule } from './effect-rule-test-utils';

describe('Effect cycle 12 regression coverage', () => {
  it('treats NodeRuntime.runMain as a production runtime boundary', () => {
    expect(
      runRule('effect-no-run-outside-entrypoints', 'NodeRuntime.runMain(program);'),
    ).toHaveLength(1);
  });

  it('rejects throwing and async callbacks inside Effect.sync', () => {
    const throwing = 'Effect.sync(() => { throw new Error("bad"); });';
    const asyncCallback = 'Effect.sync(async () => compute());';

    expect(runRule('effect-no-sync-for-throwing-ops', throwing)).toHaveLength(1);
    expect(runRule('effect-no-sync-for-promise', asyncCallback)).toHaveLength(1);
  });

  it('does not count unexecuted Fiber joins as observation', () => {
    const source = `
      const program = Effect.gen(function* () {
        const fiber = yield* Effect.fork(worker);
        Fiber.join(fiber);
      });
    `;

    expect(runRule('effect-no-floating-fiber', source)).toHaveLength(1);
  });

  it('treats current effect subpath imports as Effect code signals', () => {
    const source = 'import * as Effect from "effect/Effect"; console.log("x");';

    expect(runRule('effect-no-console-log-in-effect-code', source)).toHaveLength(1);
  });

  it('requires retry policies for default and explicit GET fetch calls inside Effect wrappers', () => {
    expect(
      runRule(
        'effect-require-retry-policy-for-idempotent-external-effects',
        'Effect.tryPromise({ try: () => fetch("/users"), catch: toError });',
      ),
    ).toHaveLength(1);
    expect(
      runRule(
        'effect-require-retry-policy-for-idempotent-external-effects',
        'Effect.tryPromise({ try: () => fetch("/users", { method: "GET" }), catch: toError });',
      ),
    ).toHaveLength(1);
  });

  it('detects generic Context.Tag calls without identifiers', () => {
    const source = 'const UserRepo = Context.Tag<UserRepo>();';

    expect(runRule('effect-require-tag-identifier', source)).toHaveLength(1);
  });

  it('does not treat service object shorthand properties as layer allocation', () => {
    const source = 'Layer.effect(UserService, Effect.succeed({ openConnection, load }));';

    expect(runRule('effect-require-scoped-for-resource-layers', source)).toHaveLength(0);
  });
});
