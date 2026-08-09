import { describe, expect, it } from 'vitest';
import theThracianOxlint from '../../src/index';
import { effectStrictRuleNames } from '../../src/rules/effect-rule-names';
import {
  runConfiguredRules,
  runRule,
  strictEffectTestPaths,
  withAllEffectRules,
} from './effect-rule-test-utils';

function configuredEffectRuleNames(
  source: string,
  filename = 'src/domain/user.ts',
  config = withAllEffectRules(
    theThracianOxlint({
      effect: { strict: { ...strictEffectTestPaths, rules: effectStrictRuleNames } },
    }),
  ),
): string[] {
  return runConfiguredRules(config, source, filename)
    .map((report) => report.ruleName)
    .filter((ruleName): ruleName is string => Boolean(ruleName));
}

describe('Effect cycle 20 regression coverage', () => {
  it('preserves executable code inside template literal interpolations', () => {
    expect(
      runRule(
        'effect-no-run-outside-entrypoints',
        'const rendered = `${Effect.runPromise(program)}`;',
      ),
    ).toHaveLength(1);
    expect(
      runRule(
        'effect-no-run-outside-entrypoints',
        'const rendered = `Effect.runPromise(program)`;',
      ),
    ).toHaveLength(0);
  });

  it('treats explicit empty strict path arrays as no allowed paths', () => {
    const config = theThracianOxlint({
      effect: {
        strict: {
          ...strictEffectTestPaths,
          enabled: true,
          entrypoints: [],
          rules: effectStrictRuleNames,
        },
      },
    });

    expect(config.rules?.['thethracian/effect-no-run-outside-entrypoints']).toStrictEqual([
      'error',
      {
        entrypoints: [],
        integrationTests: strictEffectTestPaths.integrationTests,
        unitTests: strictEffectTestPaths.unitTests,
      },
    ]);
    expect(
      configuredEffectRuleNames('Effect.runPromise(program);', 'src/main.ts', config),
    ).toContain('effect-no-run-outside-entrypoints');
  });

  it('detects public APIs through exported local function declarations and aliases', () => {
    const reexportedPromiseFunction = `
      async function load(): Promise<User> {
        return promise;
      }
      export { load };
    `;
    expect(
      runRule('effect-no-promise-returning-public-api', reexportedPromiseFunction),
    ).toHaveLength(1);
  });

  it('ignores Effect-looking text in workflow strings', () => {
    const yieldDocs =
      'Effect.gen(function* () { const docs = "yield Effect.succeed(1)"; return 1; });';
    const runSyncDocs = 'const handler = () => { const docs = "Effect.runSync(program)"; };';

    expect(runRule('effect-require-yield-star', yieldDocs)).toHaveLength(0);
    expect(runRule('effect-no-runSync-in-server-request-handlers', runSyncDocs)).toHaveLength(0);
  });

  it('checks public Promise API signatures without matching Promise-looking body strings', () => {
    const publicEffect = `
      export function load(): Effect.Effect<User> {
        const docs = "Promise<User>";
        return program;
      }
    `;

    expect(runRule('effect-no-promise-returning-public-api', publicEffect)).toHaveLength(0);
  });

  it('keeps raw platform calls owned by the direct-platform strict rule', () => {
    const ruleNames = configuredEffectRuleNames('fetch(url);');

    expect(ruleNames).toContain('effect-no-direct-http-fs-outside-platform-services');
    expect(ruleNames).not.toContain('effect-require-timeout-on-external-effects');
    expect(ruleNames).not.toContain('effect-require-retry-policy-for-idempotent-external-effects');
  });

  it('does not add a strict console rule or globally ban contextual console use', () => {
    const config = theThracianOxlint({
      effect: { strict: { ...strictEffectTestPaths, rules: effectStrictRuleNames } },
    });

    expect(config.rules).not.toHaveProperty('no-console');
    expect(config.rules).not.toHaveProperty(
      'thethracian/effect-no-direct-console-outside-logger-layer',
    );
  });
});
