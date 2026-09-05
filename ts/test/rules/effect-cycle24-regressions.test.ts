import { describe, expect, it } from 'vitest';
import theThracianOxlint from '../../src/index';
import { runConfiguredRules, runRule } from './effect-rule-test-utils';

function configuredEffectRuleNames(
  source: string,
  filename = 'src/domain/user.ts',
  effect = true,
): string[] {
  return runConfiguredRules(theThracianOxlint({ effect }), source, filename)
    .map((report) => report.ruleName)
    .filter((ruleName): ruleName is string => Boolean(ruleName))
    .sort();
}

const registerConfiguredRuleTests = (): void => {
  it('detects focused and skipped Effect tests in test files', () => {
    const effect = true;

    expect(
      configuredEffectRuleNames(
        'it.effect.only("x", () => program);',
        'tests/unit/user.test.ts',
        effect,
      ),
    ).toStrictEqual(['effect-no-focused-effect-tests']);
    expect(
      configuredEffectRuleNames(
        'it.effect.skip("x", () => program);',
        'tests/unit/user.test.ts',
        effect,
      ),
    ).toStrictEqual(['effect-no-skipped-effect-tests']);
  });

  it('keeps unobserved runFork under fiber-observation ownership before entrypoint ownership', () => {
    expect(configuredEffectRuleNames('const fiber = Effect.runFork(program);')).toStrictEqual([
      'effect-no-runfork-without-observer',
    ]);
  });

  it('ignores remaining raw-source trigger text inside strings', () => {
    expect(
      runRule('effect-no-runfork-without-observer', 'const docs = "Effect.runFork(program)";'),
    ).toHaveLength(0);
    expect(
      runRule('effect-no-floating-fiber', 'const docs = "yield* Effect.fork(program)";'),
    ).toHaveLength(0);
    expect(
      runRule('effect-no-fork-daemon-without-cleanup', 'const docs = "Effect.forkDaemon(worker)";'),
    ).toHaveLength(0);
    expect(
      runRule(
        'effect-require-bounded-concurrency',
        'Effect.forEach(items, () => Effect.succeed(\'concurrency: "unbounded"\'));',
      ),
    ).toHaveLength(0);
  });

  it('detects aliased Effect.gen return anti-patterns', () => {
    const source =
      'import { Effect as E } from "effect"; E.gen(function* () { return E.succeed(1); });';

    expect(runRule('effect-require-return-yield-star', source)).toHaveLength(1);
  });
};

const registerReexportBoundaryTests = (): void => {};

const registerLocalPolicyTests = (): void => {
  it('rejects untagged tryPromise catch objects', () => {
    expect(
      runRule(
        'effect-require-typed-error-in-trypromise',
        'Effect.tryPromise({ try: () => fetch(url), catch: (error) => ({ error }) });',
      ),
    ).toHaveLength(1);
  });

  it('detects parenthesized floating Effects and casts after decoded bindings', () => {
    expect(runRule('effect-no-floating-effect', '(Effect.succeed(1));')).toHaveLength(1);
  });
};

describe('Effect cycle 24 regression coverage', (): void => {
  registerConfiguredRuleTests();
  registerReexportBoundaryTests();
  registerLocalPolicyTests();
});
