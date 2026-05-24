import { describe, expect, it } from 'vitest';
import { runRule } from './effect-rule-test-utils.js';

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

  it('keeps exported API checks inside exported function bodies', () => {
    const functionSource = `
      export function healthCheck() {
        return "ok";
      }

      function localProgram() {
        return Effect.succeed(1);
      }
    `;

    const arrowSource = `
      export const healthCheck = () => "ok";

      const localProgram = () => Effect.gen(function* () {
        return yield* Effect.succeed(1);
      });
    `;

    expect(runRule('effect-prefer-effect-fn-for-exported-effects', functionSource)).toHaveLength(0);
    expect(runRule('effect-no-function-returning-gen', arrowSource)).toHaveLength(0);
  });
});
