import { describe, expect, it } from 'vitest';
import { runRule } from './effect-rule-test-utils';

describe('Effect cycle 16 regression coverage', () => {
  it('balances Effect call bodies across regex literals', () => {
    const source = `
      const program = Effect.gen(function* () {
        const re = /\\)/;
        yield Effect.succeed(1);
      });
    `;

    expect(runRule('effect-require-yield-star', source)).toHaveLength(1);
  });
});
