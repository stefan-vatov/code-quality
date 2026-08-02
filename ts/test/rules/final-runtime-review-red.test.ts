import { describe, expect, it } from 'vitest';
import { hasRecursiveEffectWithoutSuspend } from '../../src/rules/effect-default-workflow-helpers';

describe('final runtime review regressions', (): void => {
  it('does not let an earlier unrelated arrow parameter shadow later recursion', (): void => {
    const source = `
      import { Effect } from "effect";
      const wrapper = (loop) => Effect.succeed(loop);
      function loop() {
        Effect.succeed(undefined);
        return loop();
      }
    `;

    expect(hasRecursiveEffectWithoutSuspend(source)).toBe(true);
  });
});
