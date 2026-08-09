import { describe, expect, it } from 'vitest';
import { runAllRules, runRule } from './effect-rule-test-utils';

function reportedEffectRules(source: string, filename = 'src/domain/user.ts'): string[] {
  return runAllRules(source, filename)
    .map((report) => report.ruleName)
    .filter((ruleName): ruleName is string => Boolean(ruleName?.startsWith('effect-')));
}

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

  it('detects exported local bindings and public type surfaces', () => {
    const exportedPromiseType = 'export type Loader = () => Promise<User>;';
    const exportedUnknownInterface = 'export interface Input { value: unknown }';

    expect(runRule('effect-no-promise-returning-public-api', exportedPromiseType)).toHaveLength(1);
    expect(
      runRule('effect-schema-no-unknown-crossing-boundary', exportedUnknownInterface),
    ).toHaveLength(1);
  });

  it('accepts timeout and retry on the enclosing Effect promise wrapper', () => {
    const timed = `
      Effect.tryPromise({ try: () => fetch(url), catch: toError })
        .pipe(Effect.timeout("1 second"));
    `;
    const retried = `
      Effect.tryPromise({ try: () => fetch(url), catch: toError })
        .pipe(Effect.retry(policy));
    `;

    expect(runRule('effect-require-timeout-on-external-effects', timed)).toHaveLength(0);
    expect(
      runRule('effect-require-retry-policy-for-idempotent-external-effects', retried),
    ).toHaveLength(0);
  });

  it('keeps GenericTag diagnostics owned by one strict rule', () => {
    const missingIdentifier = 'const UserRepo = Context.GenericTag<UserRepo>();';
    const legacyService = 'const UserRepo = Context.GenericTag<UserRepo>("UserRepo");';

    expect(reportedEffectRules(missingIdentifier)).toStrictEqual(['effect-require-tag-identifier']);
    expect(reportedEffectRules(legacyService)).toStrictEqual([
      'effect-require-service-class-pattern',
    ]);
  });
});
