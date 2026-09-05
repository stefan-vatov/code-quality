import { describe, expect, it } from 'vitest';
import { runRule } from './effect-rule-test-utils';

describe('Effect cycle 21 regression coverage', () => {
  it('detects floating Effects behind inline guards', () => {
    expect(runRule('effect-no-floating-effect', 'if (enabled) Effect.succeed(1);')).toHaveLength(1);
    expect(runRule('effect-no-floating-effect', 'enabled && Effect.succeed(1);')).toHaveLength(1);
  });

  it('does not report guarded Effect-looking text in strings', () => {
    expect(
      runRule('effect-no-floating-effect', 'const docs = "if (enabled) Effect.succeed(1)";'),
    ).toHaveLength(0);
  });
});
