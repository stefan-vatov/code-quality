import { describe, expect, it } from 'vitest';
import { runRule } from './effect-rule-test-utils';

describe('Effect cycle 9 regression coverage', () => {
  it('keeps fiber observation inside the same arrow function body', () => {
    const floatingFork = `
      const first = () => Effect.gen(function* () {
        const fiber = yield* Effect.fork(worker);
      });

      const second = () => Effect.gen(function* () {
        return yield* Fiber.join(fiber);
      });
    `;

    const floatingRunFork = `
      const first = () => {
        const fiber = Effect.runFork(program);
      };

      const second = () => Fiber.interrupt(fiber);
    `;

    expect(runRule('effect-no-floating-fiber', floatingFork)).toHaveLength(1);
    expect(runRule('effect-no-runfork-without-observer', floatingRunFork)).toHaveLength(1);
  });
});
