import { describe, expect, it } from 'vitest';
import { runAllRules, runRule } from './effect-rule-test-utils.js';

function reportedEffectRules(source: string, filename = 'src/domain/user.ts'): string[] {
  return runAllRules(source, filename)
    .map((report) => report.ruleName)
    .filter((ruleName): ruleName is string => Boolean(ruleName?.startsWith('effect-')));
}

describe('Effect cycle 18 regression coverage', () => {
  it('ignores strict direct-access patterns inside strings, comments, and regex literals', () => {
    const source = `
      const docs = "console.log(process.env.API_TOKEN)";
      // Effect.runPromise(program); Date.now(); fetch("/users");
      const pattern = /Effect\\.Do|console\\.log|process\\.env|Date\\.now|fetch\\(/;
    `;

    expect(runRule('effect-no-direct-process-env-outside-config-layer', source)).toHaveLength(0);
    expect(runRule('effect-no-direct-clock-random-outside-adapters', source)).toHaveLength(0);
    expect(runRule('effect-no-direct-http-fs-outside-platform-services', source)).toHaveLength(0);
    expect(runRule('effect-no-run-outside-entrypoints', source)).toHaveLength(0);
    expect(runRule('effect-prefer-gen-over-do', source)).toHaveLength(0);
  });

  it('keeps balanced Effect call parsing stable across regex literals', () => {
    const source = `
      const program = Effect.gen(function* () {
        const pattern = /\\)/;
        yield Effect.succeed(1);
      });
    `;

    expect(runRule('effect-require-yield-star', source)).toHaveLength(1);
    expect(runRule('effect-require-yield-star', source)[0]?.loc).toBeDefined();
  });

  it('detects exported Promise and unknown boundaries through re-exports and type surfaces', () => {
    const reExport = `
      const load = () => Effect.runPromise(program);
      export { load };
    `;
    const promiseType = 'export type Loader = () => Promise<User>;';
    const unknownInterface = 'export interface Input { readonly value: unknown }';

    expect(runRule('effect-no-runpromise-in-exported-api', reExport)).toHaveLength(1);
    expect(runRule('effect-no-promise-returning-public-api', promiseType)).toHaveLength(1);
    expect(runRule('effect-schema-no-unknown-crossing-boundary', unknownInterface)).toHaveLength(1);
  });

  it('accepts timeout and retry on enclosing Effect wrappers around external calls', () => {
    const timed = `
      Effect.tryPromise({ try: () => fetch(url), catch: FetchError.fromUnknown }).pipe(
        Effect.timeout("1 second"),
      );
    `;
    const retried = `
      Effect.tryPromise({ try: () => fetch(url), catch: FetchError.fromUnknown }).pipe(
        Effect.retry(policy),
      );
    `;

    expect(runRule('effect-require-timeout-on-external-effects', timed)).toHaveLength(0);
    expect(
      runRule('effect-require-retry-policy-for-idempotent-external-effects', retried),
    ).toHaveLength(0);
  });

  it('keeps overlapping all-rule diagnostics canonical', () => {
    expect(reportedEffectRules('process.env.API_TOKEN;')).toStrictEqual([
      'effect-no-direct-process-env-outside-config-layer',
    ]);
    expect(reportedEffectRules('Context.GenericTag<UserRepo>();')).toStrictEqual([
      'effect-require-tag-identifier',
    ]);
  });
});
