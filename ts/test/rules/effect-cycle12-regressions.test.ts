import { describe, expect, it } from 'vitest';
import { runRule } from './effect-rule-test-utils';

describe('Effect cycle 12 regression coverage', () => {
  it('does not count unexecuted Fiber joins as observation', () => {
    const source = `
      const program = Effect.gen(function* () {
        const fiber = yield* Effect.fork(worker);
        Fiber.join(fiber);
      });
    `;

    expect(runRule('effect-no-floating-fiber', source)).toHaveLength(1);
  });
});
