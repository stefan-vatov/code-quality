import { describe, expect, it } from 'vitest';
import theThracianOxlint from '../../src/index';
import { runConfiguredRules, runRule } from './effect-rule-test-utils';

function configuredEffectRuleNames(source: string, filename = 'src/domain/user.ts'): string[] {
  return runConfiguredRules(theThracianOxlint({ effect: { strict: true } }), source, filename)
    .map((report) => report.ruleName)
    .filter((ruleName): ruleName is string => Boolean(ruleName))
    .sort();
}

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

  it('keeps overlap-prone configured diagnostics canonical', () => {
    expect(configuredEffectRuleNames('fetch(url);')).toStrictEqual([
      'effect-no-direct-http-fs-outside-platform-services',
    ]);
    expect(
      configuredEffectRuleNames(
        'const program = Effect.tryPromise({ try: () => fetch("/users"), catch: toError });',
        'src/adapters/http.ts',
      ),
    ).toStrictEqual([
      'effect-require-retry-policy-for-idempotent-external-effects',
      'effect-require-span-external',
      'effect-require-timeout-on-external-effects',
    ]);
    expect(
      configuredEffectRuleNames('Effect.runPromise(program);', 'src/user.test.ts'),
    ).toStrictEqual(['effect-test-no-runpromise']);
  });
});
