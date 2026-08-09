import { describe, expect, it } from 'vitest';
import { runRule } from './effect-rule-test-utils';

describe('Effect cycle 14 regression coverage', () => {
  it('keeps uninterruptible restore checks local to the uninterruptible call', () => {
    const invalid = `
      Effect.uninterruptible(
        Effect.gen(function* () {
          const fiber = yield* Effect.fork(worker);
          return fiber;
        })
      );

      const restore = auditRestoreMetric;
    `;
    const valid = `
      Effect.uninterruptibleMask((restore) =>
        Effect.gen(function* () {
          return yield* restore(Effect.fork(worker));
        })
      );
    `;

    expect(runRule('effect-require-restore-for-fork-in-uninterruptible', invalid)).toHaveLength(1);
    expect(runRule('effect-require-restore-for-fork-in-uninterruptible', valid)).toHaveLength(0);
  });
});
