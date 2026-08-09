import { describe, expect, it } from 'vitest';
import { runRule } from './effect-rule-test-utils';

describe('Effect cycle 5 regression coverage', () => {
  it('keeps return-yield-star checks scoped to the current Effect.gen call', () => {
    const valid = `
      const program = Effect.gen(function* () {
        return yield* loadUser;
      });

      function helper() {
        return Effect.succeed(1);
      }
    `;
    const invalid = `
      const program = Effect.gen(function* () {
        return Effect.succeed(1);
      });
    `;

    expect(runRule('effect-require-return-yield-star', valid)).toHaveLength(0);
    expect(runRule('effect-require-return-yield-star', invalid)).toHaveLength(1);
  });

  it('allows daemon fibers only when explicit cleanup or supervision is present', () => {
    const valid = 'Effect.forkDaemon(worker.pipe(Effect.ensuring(cleanup)));';
    const invalid = 'Effect.forkDaemon(worker);';

    expect(runRule('effect-no-fork-daemon-without-cleanup', valid)).toHaveLength(0);
    expect(runRule('effect-no-fork-daemon-without-cleanup', invalid)).toHaveLength(1);
  });
});
