import { describe, expect, it } from 'vitest';
import { runRule } from './effect-rule-test-utils';

describe('Effect cycle 5 default regression coverage', () => {
  it('requires yield star for yielded Effect variables inside Effect.gen', () => {
    const invalid = `
      const program = Effect.gen(function* () {
        const user = yield loadUser;
        return user;
      });
    `;

    const valid = `
      const program = Effect.gen(function* () {
        const user = yield* loadUser;
        return user;
      });
    `;

    expect(runRule('effect-require-yield-star', invalid)).toHaveLength(1);
    expect(runRule('effect-require-yield-star', valid)).toHaveLength(0);
  });
});
