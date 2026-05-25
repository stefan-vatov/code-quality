import { describe, expect, it } from 'vitest';
import { runRule } from './effect-rule-test-utils';

describe('Effect cycle 14 regression coverage', () => {
  it('does not treat Effect mentions in strings or comments as Effect module signals', () => {
    const stringOnly = 'const message = "Effect.succeed"; console.log("debug");';
    const commentOnly = '// Effect.succeed(1)\nconsole.log("debug");';
    const effectImport = 'import { Effect } from "effect"; console.log("debug");';

    expect(runRule('effect-no-console-log-in-effect-code', stringOnly)).toHaveLength(0);
    expect(runRule('effect-no-console-log-in-effect-code', commentOnly)).toHaveLength(0);
    expect(runRule('effect-no-console-log-in-effect-code', effectImport)).toHaveLength(1);
  });

  it('detects Promise then chains through variables inside Effect modules', () => {
    const invalid = `
      import { Effect } from "effect";
      const result = promise.then((value) => value);
    `;
    const valid = 'const result = promise.then((value) => value);';

    expect(runRule('effect-no-promise-then-in-effect', invalid)).toHaveLength(1);
    expect(runRule('effect-no-promise-then-in-effect', valid)).toHaveLength(0);
  });

  it('detects mixed Effect import styles in either order', () => {
    const namedThenNamespace = `
      import { Effect } from "effect";
      import * as EffectModule from "effect/Effect";
    `;
    const namespaceThenNamed = `
      import * as EffectModule from "effect/Effect";
      import { Effect } from "effect";
    `;
    const valid = 'import { Effect, Schema } from "effect";';

    expect(runRule('effect-no-mixed-effect-import-styles', namedThenNamespace)).toHaveLength(1);
    expect(runRule('effect-no-mixed-effect-import-styles', namespaceThenNamed)).toHaveLength(1);
    expect(runRule('effect-no-mixed-effect-import-styles', valid)).toHaveLength(0);
  });

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
