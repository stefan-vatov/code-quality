import { describe, expect, it } from 'vitest';
import { runRule } from './effect-rule-test-utils';

describe('Effect cycle 11 regression coverage', () => {
  it('balances Effect call bodies across parentheses inside strings', () => {
    const source = `
      const program = Effect.gen(function* () {
        const marker = ")";
        yield Effect.succeed(1);
      });
    `;

    expect(runRule('effect-require-yield-star', source)).toHaveLength(1);
  });

  it('does not cut fiber observation off at nested helpers inside the same body', () => {
    const source = `
      const program = Effect.gen(function* () {
        const fiber = yield* Effect.fork(worker);
        const helper = () => 1;
        return yield* Fiber.join(fiber);
      });
    `;

    expect(runRule('effect-no-floating-fiber', source)).toHaveLength(0);
  });
});
