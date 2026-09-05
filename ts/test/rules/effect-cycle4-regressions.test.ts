import { describe, expect, it } from 'vitest';
import { runRule } from './effect-rule-test-utils';

describe('Effect cycle 4 regression coverage', () => {
  it('allows assigned multiline piped Effect values', () => {
    const valid = `
      const transformed =
        program.pipe(
          Effect.map((value) => value)
        );
    `;

    const invalid = `
      program.pipe(
        Effect.map((value) => value)
      );
    `;

    expect(runRule('effect-no-floating-effect', valid)).toHaveLength(0);
    expect(runRule('effect-no-floating-effect', invalid)).toHaveLength(1);
  });

  it('requires preserved causes per error mapping instead of per file', () => {
    const invalid = `
      const missing = program.pipe(
        Effect.mapError((error) => new UserError({ message: "x" }))
      );
      const preserved = other.pipe(
        Effect.mapError((error) => new UserError({ cause: error }))
      );
    `;

    const valid = `
      const preserved = program.pipe(
        Effect.mapError((error) => new UserError({ cause: error }))
      );
    `;

    expect(runRule('effect-require-error-cause-preserved', invalid)).toHaveLength(1);
    expect(runRule('effect-require-error-cause-preserved', valid)).toHaveLength(0);
  });
});
