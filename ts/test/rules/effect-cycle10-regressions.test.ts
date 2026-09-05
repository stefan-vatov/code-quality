import { describe, expect, it } from 'vitest';
import { runRule } from './effect-rule-test-utils';

describe('Effect cycle 10 regression coverage', () => {
  it('keeps fiber observation in the enclosing block when local helpers appear first', () => {
    const forked = `
      function first() {
        const fiber = yield* Effect.fork(worker);
        const helper = () => value;
        return yield* Fiber.join(fiber);
      }
    `;

    const runForked = `
      function first() {
        const fiber = Effect.runFork(program);
        const helper = () => value;
        fiber.addObserver(() => undefined);
      }
    `;

    expect(runRule('effect-no-floating-fiber', forked)).toHaveLength(0);
    expect(runRule('effect-no-runfork-without-observer', runForked)).toHaveLength(0);
  });
});
