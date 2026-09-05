import { describe, expect, it } from 'vitest';
import { runRule } from './effect-rule-test-utils';

describe('Effect cycle 18 regression coverage', () => {
  it('keeps balanced Effect call parsing stable across regex literals', () => {
    const source = `
      const program = Effect.gen(function* () {
        const pattern = /\\)/;
        yield Effect.succeed(1);
      });
    `;

    expect(runRule('effect-require-yield-star', source)).toHaveLength(1);
    expect(runRule('effect-require-yield-star', source)[0]?.loc).toBeDefined();
  });
});
