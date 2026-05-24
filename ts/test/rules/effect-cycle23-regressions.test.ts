import { describe, expect, it } from 'vitest';
import { runAllRules, runRule } from './effect-rule-test-utils.js';

function reportedEffectRules(source: string, filename = 'src/domain/user.ts'): string[] {
  return runAllRules(source, filename)
    .map((report) => report.ruleName)
    .filter((ruleName): ruleName is string => Boolean(ruleName?.startsWith('effect-')));
}

describe('Effect cycle 23 regression coverage', () => {
  it('ignores nested template strings inside template literal interpolations', () => {
    expect(
      runRule(
        'effect-no-run-outside-entrypoints',
        'const rendered = `${`Effect.runPromise(program)`}`;',
      ),
    ).toHaveLength(0);
  });

  it('ignores Effect workflow trigger text inside strings', () => {
    const returnDocs =
      'Effect.gen(function* () { const docs = "return Effect.succeed(1)"; return 1; });';
    const decodeDocs =
      'Effect.gen(function* () { const docs = "Schema.decodeSync(User)(payload)"; return 1; });';
    const promiseDocs = 'const docs = "Schema.decodeUnknownPromise(User)(payload)";';
    const tryPromiseDocs = 'const docs = "Effect.tryPromise(async () => fetch(url))";';

    expect(runRule('effect-require-return-yield-star', returnDocs)).toHaveLength(0);
    expect(runRule('effect-schema-no-unsafe-sync-decode-in-effect-code', decodeDocs)).toHaveLength(
      0,
    );
    expect(runRule('effect-schema-prefer-decodeUnknown-effect', promiseDocs)).toHaveLength(0);
    expect(runRule('effect-require-typed-error-in-trypromise', tryPromiseDocs)).toHaveLength(0);
  });

  it('ignores resource, layer, provide, and leaked dependency text inside strings', () => {
    expect(
      runRule(
        'effect-require-scoped-for-acquireRelease',
        'const docs = "Effect.acquireRelease(openConnection, closeConnection)";',
      ),
    ).toHaveLength(0);
    expect(
      runRule('effect-require-scoped-for-resources', 'const docs = "Socket.open()";'),
    ).toHaveLength(0);
    expect(
      runRule(
        'effect-require-scoped-for-resource-layers',
        'const docs = "Layer.effect(UserRepo, openConnection())";',
      ),
    ).toHaveLength(0);
    expect(
      runRule('effect-require-centralized-provision', 'const docs = "Effect.provide(Live)";'),
    ).toHaveLength(0);
    expect(
      runRule(
        'effect-no-leaked-service-dependencies',
        'const docs = "Layer.succeed(UserRepo, Live)";',
      ),
    ).toHaveLength(0);
  });

  it('ignores test-specific trigger text inside strings', () => {
    expect(
      runRule(
        'effect-no-focused-effect-tests',
        'const docs = "it.effect.only(name, fn)";',
        'src/user.test.ts',
      ),
    ).toHaveLength(0);
    expect(
      runRule(
        'effect-no-skipped-effect-tests',
        'const docs = "it.effect.skip(name, fn)";',
        'src/user.test.ts',
      ),
    ).toHaveLength(0);
    expect(
      runRule(
        'effect-no-real-sleep-in-tests',
        'const docs = "Effect.sleep(1000)";',
        'src/user.test.ts',
      ),
    ).toHaveLength(0);
  });

  it('checks exported Promise API surfaces without arbitrary body arrows and includes class methods', () => {
    const effectFunctionWithFetchThunk = `
      export function load(): Effect.Effect<User> {
        const thunk = () => fetch(url);
        return program;
      }
    `;
    const exportedClass = `
      export class Repo {
        load(): Promise<User> { return promise; }
      }
    `;

    expect(
      runRule('effect-no-promise-returning-public-api', effectFunctionWithFetchThunk),
    ).toHaveLength(0);
    expect(runRule('effect-no-promise-returning-public-api', exportedClass)).toHaveLength(1);
  });

  it('detects aliased Effect runtime execution imports', () => {
    const source = 'import { Effect as E } from "effect"; E.runPromise(program);';

    expect(runRule('effect-no-run-outside-entrypoints', source)).toHaveLength(1);
  });

  it('does not treat export prose strings as re-exports', () => {
    const source = 'const load = () => Effect.runPromise(program); const docs = "export { load }";';

    expect(runRule('effect-no-runpromise-in-exported-api', source)).toHaveLength(0);
  });

  it('detects default exported runtime execution functions', () => {
    expect(
      runRule(
        'effect-no-runpromise-in-exported-api',
        'export default () => Effect.runPromise(program);',
      ),
    ).toHaveLength(1);
  });

  it('detects floating Effects in or and ternary expression statements', () => {
    expect(runRule('effect-no-floating-effect', 'enabled || Effect.succeed(1);')).toHaveLength(1);
    expect(
      runRule('effect-no-floating-effect', 'enabled ? Effect.succeed(1) : Effect.void;'),
    ).toHaveLength(1);
  });

  it('keeps external-data, cast-after-decode, and parsed-json checks local', () => {
    const undecodedResponse = `
      const data = response.json();
      const decoder = Schema.decodeUnknown(User);
    `;
    const unrelatedCast = `
      const decode = Schema.decodeUnknown(User)(payload);
      const user = value as User;
    `;
    const unrelatedJsonNumber = `
      const raw = JSON.parse(input);
      const Age = Schema.NumberFromString;
    `;

    expect(
      runRule('effect-schema-use-decodeUnknown-for-external-data', undecodedResponse),
    ).toHaveLength(1);
    expect(runRule('effect-schema-no-cast-after-decode', unrelatedCast)).toHaveLength(0);
    expect(
      runRule('effect-schema-correct-number-type-for-parsed-json', unrelatedJsonNumber),
    ).toHaveLength(0);
  });

  it('detects nested unknown in exported boundary signatures', () => {
    expect(
      runRule(
        'effect-schema-no-unknown-crossing-boundary',
        'export interface Input { payload: Record<string, unknown>; }',
      ),
    ).toHaveLength(1);
    expect(
      runRule(
        'effect-schema-no-unknown-crossing-boundary',
        'export type Input = { values: Array<unknown> };',
      ),
    ).toHaveLength(1);
    expect(
      runRule(
        'effect-schema-no-unknown-crossing-boundary',
        'export function parse(): Effect.Effect<unknown> { return value; }',
      ),
    ).toHaveLength(1);
  });

  it('lets adapter-owned Effect-wrapped fetch diagnostics require timeout policy', () => {
    const ruleNames = reportedEffectRules(
      'const program = Effect.tryPromise({ try: () => fetch(url), catch: toError });',
      'src/adapters/http.ts',
    );

    expect(ruleNames).not.toContain('effect-no-direct-http-fs-outside-platform-services');
    expect(ruleNames).toContain('effect-require-timeout-on-external-effects');
  });
});
