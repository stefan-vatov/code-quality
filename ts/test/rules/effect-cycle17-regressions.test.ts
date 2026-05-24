import { describe, expect, it } from 'vitest';
import theThracianOxlint from '../../src/index.js';
import { runConfiguredRules, runRule } from './effect-rule-test-utils.js';

function configuredEffectRuleNames(
  source: string,
  config = theThracianOxlint(),
  filename = 'src/domain/user.ts',
): string[] {
  return runConfiguredRules(config, source, filename)
    .map((report) => report.ruleName)
    .filter((ruleName): ruleName is string => Boolean(ruleName));
}

describe('Effect cycle 17 regression coverage', () => {
  it('keeps exact published-config golden diagnostics stable', () => {
    const cleanModule = `
      import { Context, Effect, Schema } from "effect";

      class UserRepo extends Context.Tag("UserRepo")<
        UserRepo,
        { readonly load: Effect.Effect<User, UserError, never> }
      >() {}

      class User extends Schema.TaggedClass<User>("User")("User", {
        id: Schema.String
      }) {}

      class UserError extends Schema.TaggedClass<UserError>("UserError")("UserError", {
        cause: Schema.Unknown
      }) {}

      export const loadUser = Effect.fn("loadUser")(function* () {
        return yield* Effect.succeed(new User({ id: "user-1" }));
      });
    `;
    const strictConfig = theThracianOxlint({ effect: { strict: true } });

    expect(configuredEffectRuleNames(cleanModule)).toStrictEqual([]);
    expect(configuredEffectRuleNames(cleanModule, strictConfig)).toStrictEqual([]);
    expect(configuredEffectRuleNames('const failure = Effect.fail("bad");')).toStrictEqual([
      'effect-no-string-errors',
    ]);
    expect(
      configuredEffectRuleNames('process.env.API_TOKEN;', strictConfig, 'src/domain/user.ts'),
    ).toStrictEqual(['effect-no-direct-process-env-outside-config-layer']);
  });

  it('ignores strings and comments in check-based source rules', () => {
    const effectModuleWithStringOnlyPromise = `
      import { Effect } from "effect";
      const docs = "promise.then(() => value)";
    `;

    expect(
      runRule('effect-no-promise-then-in-effect', effectModuleWithStringOnlyPromise),
    ).toHaveLength(0);
    expect(
      runRule('effect-no-run-outside-entrypoints', '// Effect.runPromise(program)'),
    ).toHaveLength(0);
  });

  it('treats regex literals as non-structural syntax for scanners and pattern rules', () => {
    const hiddenYield = `
      const program = Effect.gen(function* () {
        const closingParen = /\\)/;
        yield Effect.succeed(1);
      });
    `;

    expect(runRule('effect-require-yield-star', hiddenYield)).toHaveLength(1);
    expect(
      runRule('effect-prefer-gen-over-do', 'const effectDoPattern = /Effect.Do/;'),
    ).toHaveLength(0);
  });

  it('detects re-exported values and exported type-only public boundaries', () => {
    const reexportedRunner = `
      const load = () => Effect.runPromise(program);
      export { load };
    `;

    expect(runRule('effect-no-runpromise-in-exported-api', reexportedRunner)).toHaveLength(1);
    expect(
      runRule(
        'effect-no-promise-returning-public-api',
        'export type Loader = () => Promise<User>;',
      ),
    ).toHaveLength(1);
    expect(
      runRule(
        'effect-schema-no-unknown-crossing-boundary',
        'export interface Input { value: unknown }',
      ),
    ).toHaveLength(1);
  });

  it('accepts timeout and retry on enclosing Effect wrappers around external calls', () => {
    const timeout = `
      Effect.tryPromise({ try: () => fetch(url), catch: toError })
        .pipe(Effect.timeout("1 second"));
    `;
    const retry = `
      Effect.tryPromise({ try: () => fetch("/users"), catch: toError })
        .pipe(Effect.retry(policy));
    `;

    expect(runRule('effect-require-timeout-on-external-effects', timeout)).toHaveLength(0);
    expect(
      runRule('effect-require-retry-policy-for-idempotent-external-effects', retry),
    ).toHaveLength(0);
  });

  it('reports precise locations for check-based rules', () => {
    const [report] = runRule(
      'effect-require-yield-star',
      'const program = Effect.gen(function* () {\n  yield Effect.succeed(1);\n});',
    );

    expect(report?.loc).toStrictEqual({ column: 2, line: 2 });
  });
});
