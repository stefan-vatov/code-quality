import { describe, expect, it } from 'vitest';
import { runRule } from './effect-rule-test-utils';

describe('Effect cycle 15 regression coverage', () => {
  it('reports voided Effect values as floating effects', () => {
    expect(runRule('effect-no-floating-effect', 'void Effect.succeed(1);')).toHaveLength(1);
  });

  it('does not count unexecuted runFork joins as observation', () => {
    const source = `
      function main() {
        const fiber = Effect.runFork(program);
        Fiber.join(fiber);
      }
    `;

    expect(runRule('effect-no-runfork-without-observer', source)).toHaveLength(1);
  });
});
