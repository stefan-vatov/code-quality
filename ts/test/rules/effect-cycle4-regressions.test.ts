import { describe, expect, it } from 'vitest';
import theThracianOxlint from '../../src/index';
import { runAllRules, runConfiguredRules, runRule } from './effect-rule-test-utils';

function reportedEffectRules(source: string): string[] {
  return runAllRules(source)
    .map((report) => report.ruleName)
    .filter((ruleName): ruleName is string => Boolean(ruleName?.startsWith('effect-')));
}

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

  it('rejects untagged object literal failures while allowing tagged object errors', () => {
    const invalid = 'Effect.fail({ message: "bad" });';
    const valid = 'Effect.fail({ _tag: "UserNotFound", message: "bad" });';

    expect(runRule('effect-no-untagged-errors', invalid)).toHaveLength(1);
    expect(runRule('effect-no-untagged-errors', valid)).toHaveLength(0);
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

  it('does not duplicate legacy Context.Tag service diagnostics', () => {
    const source = 'const UserRepo = Context.Tag<UserRepo>("UserRepo");';

    expect(reportedEffectRules(source)).toStrictEqual([
      'effect-no-deprecated-context-tag-function',
    ]);
  });

  it('runs all-rule golden checks through the published config profiles', () => {
    const source = 'Effect.runPromise(program);';
    const defaultRules = runConfiguredRules(theThracianOxlint(), source, 'src/domain/user.ts');
    const strictRules = runConfiguredRules(
      theThracianOxlint({ effect: { strict: true } }),
      source,
      'src/domain/user.ts',
    );

    expect(defaultRules.map((report) => report.ruleName)).not.toContain(
      'effect-no-run-outside-entrypoints',
    );
    expect(strictRules.map((report) => report.ruleName)).toContain(
      'effect-no-run-outside-entrypoints',
    );
  });
});
