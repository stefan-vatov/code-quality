import { describe, expect, it } from 'vitest';
import theThracianOxlint from '../../src/index';
import { runConfiguredRules, runRule } from './effect-rule-test-utils';

function configuredEffectRuleNames(
  source: string,
  filename = 'src/domain/user.ts',
  config = theThracianOxlint({ effect: { strict: true } }),
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
        'effect-no-process-env-in-effect-code',
        'import { Effect } from "effect"; const rendered = `${process.env.API_TOKEN}`;',
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
    const config = theThracianOxlint({ effect: { strict: { enabled: true, entrypoints: [] } } });

    expect(config.rules?.['thethracian/effect-no-run-outside-entrypoints']).toStrictEqual([
      'error',
      { entrypoints: [] },
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
    const aliasedRunner = `
      function start() {
        return Effect.runPromise(program);
      }
      export { start as main };
    `;

    expect(
      runRule('effect-no-promise-returning-public-api', reexportedPromiseFunction),
    ).toHaveLength(1);
    expect(runRule('effect-no-runpromise-in-exported-api', aliasedRunner)).toHaveLength(1);
  });

  it('ignores Effect-looking text inside callback strings', () => {
    expect(
      runRule(
        'effect-no-effect-in-array-foreach',
        'items.forEach(() => console.log("Effect.succeed(item)"));',
      ),
    ).toHaveLength(0);
    expect(
      runRule(
        'effect-no-effect-in-promise-callback',
        'Promise.resolve(1).then(() => console.log("Effect.succeed(1)"));',
      ),
    ).toHaveLength(0);
  });

  it('ignores Effect-looking text in workflow strings and non-Effect import prose', () => {
    const importDocs = 'const docs = "from \'effect\'"; promise.then(handle);';
    const runtimeDocs =
      'Effect.gen(function* () { const docs = "Effect.runPromise(program)"; return 1; });';
    const yieldDocs =
      'Effect.gen(function* () { const docs = "yield Effect.succeed(1)"; return 1; });';
    const awaitDocs = 'Effect.gen(function* () { const docs = "await promise"; return 1; });';
    const runSyncDocs = 'const handler = () => { const docs = "Effect.runSync(program)"; };';
    const flatMapDocs = 'const docs = `Effect.flatMap(a, () => b.pipe(Effect.flatMap(c)))`;';

    expect(runRule('effect-no-promise-then-in-effect', importDocs)).toHaveLength(0);
    expect(runRule('effect-no-run-inside-effect', runtimeDocs)).toHaveLength(0);
    expect(runRule('effect-require-yield-star', yieldDocs)).toHaveLength(0);
    expect(runRule('effect-no-async-await-in-effect', awaitDocs)).toHaveLength(0);
    expect(runRule('effect-no-runSync-in-server-request-handlers', runSyncDocs)).toHaveLength(0);
    expect(runRule('effect-prefer-gen-for-nested-flatmap', flatMapDocs)).toHaveLength(0);
  });

  it('allows exported resource constants while still checking exported effectful functions', () => {
    const exportedResource = `
      export const resource = Effect.scoped(
        Effect.acquireRelease(openConnection, closeConnection),
      );
    `;
    const exportedFunction = 'export const load = () => Effect.succeed(user);';

    expect(runRule('effect-prefer-effect-fn-for-exported-effects', exportedResource)).toHaveLength(
      0,
    );
    expect(runRule('effect-prefer-effect-fn-for-exported-effects', exportedFunction)).toHaveLength(
      1,
    );
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

  it('lets test-specific runner rules own test files in strict mode', () => {
    const ruleNames = configuredEffectRuleNames('Effect.runPromise(program);', 'src/user.test.ts');

    expect(ruleNames).toContain('effect-test-no-runpromise');
    expect(ruleNames).not.toContain('effect-no-run-outside-entrypoints');
  });

  it('keeps raw platform calls owned by the direct-platform strict rule', () => {
    const ruleNames = configuredEffectRuleNames('fetch(url);');

    expect(ruleNames).toContain('effect-no-direct-http-fs-outside-platform-services');
    expect(ruleNames).not.toContain('effect-require-timeout-on-external-effects');
    expect(ruleNames).not.toContain('effect-require-retry-policy-for-idempotent-external-effects');
  });

  it('does not enable a redundant strict console rule because no-console owns console statements', () => {
    const config = theThracianOxlint({ effect: { strict: true } });

    expect(config.rules).toHaveProperty('no-console', 'error');
    expect(config.rules).not.toHaveProperty(
      'thethracian/effect-no-direct-console-outside-logger-layer',
    );
  });
});
