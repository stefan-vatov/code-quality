import { describe, expect, it } from 'vitest';
import { runRule } from './effect-rule-test-utils';

describe('Effect cycle 17 regression coverage', () => {
  it('treats regex literals as non-structural syntax for scanners and pattern rules', () => {
    const hiddenYield = `
      const program = Effect.gen(function* () {
        const closingParen = /\\)/;
        yield Effect.succeed(1);
      });
    `;

    expect(runRule('effect-require-yield-star', hiddenYield)).toHaveLength(1);
  });

  it('reports precise locations for check-based rules', () => {
    const [report] = runRule(
      'effect-require-yield-star',
      'const program = Effect.gen(function* () {\n  yield Effect.succeed(1);\n});',
    );

    expect(report?.loc).toStrictEqual({ column: 2, line: 2 });
  });
});
