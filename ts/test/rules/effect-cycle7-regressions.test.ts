import { describe, expect, it } from 'vitest';
import { runRule } from './effect-rule-test-utils';

describe('Effect cycle 7 regression coverage', () => {
  it('allows pipeable scoped acquireRelease resources', () => {
    const source = 'Effect.acquireRelease(openConnection, closeConnection).pipe(Effect.scoped);';

    expect(runRule('effect-require-scoped-for-acquireRelease', source)).toHaveLength(0);
  });

  it('keeps fiber observation inside the same function body', () => {
    const floatingFork = `
      function first() {
        const fiber = yield* Effect.fork(worker);
      }

      function second() {
        return yield* Fiber.join(fiber);
      }
    `;

    const floatingRunFork = `
      function first() {
        const fiber = Effect.runFork(program);
      }

      function second() {
        return Fiber.interrupt(fiber);
      }
    `;

    expect(runRule('effect-no-floating-fiber', floatingFork)).toHaveLength(1);
    expect(runRule('effect-no-runfork-without-observer', floatingRunFork)).toHaveLength(1);
  });
});
