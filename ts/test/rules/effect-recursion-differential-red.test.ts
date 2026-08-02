import { describe, expect, it } from 'vitest';
import { hasRecursiveEffectWithoutSuspend } from '../../src/rules/effect-default-workflow-helpers';

describe('effect recursion current versus HEAD differential', (): void => {
  it('keeps detecting eager recursion in an unterminated function body', (): void => {
    const source = 'import { Effect } from "effect"; function f() { Effect.succeed(f());';

    expect(hasRecursiveEffectWithoutSuspend(source)).toBe(true);
  });
});
