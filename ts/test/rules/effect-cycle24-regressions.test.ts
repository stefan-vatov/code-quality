import { describe, expect, it } from 'vitest';
import theThracianOxlint from '../../src/index.js';
import { runConfiguredRules, runRule } from './effect-rule-test-utils.js';

function configuredEffectRuleNames(
  source: string,
  filename = 'src/domain/user.ts',
  strict: Parameters<typeof theThracianOxlint>[0]['effect'] = { strict: true },
): string[] {
  return runConfiguredRules(theThracianOxlint({ effect: strict }), source, filename)
    .map((report) => report.ruleName)
    .filter((ruleName): ruleName is string => Boolean(ruleName))
    .sort();
}

describe('Effect cycle 24 regression coverage', () => {
  it('applies configured strict test globs to always-on test rules', () => {
    const effect = { strict: { unitTests: ['tests/unit/**'] } };

    expect(
      configuredEffectRuleNames(
        'it("x", () => Effect.runPromise(program));',
        'tests/unit/user.ts',
        effect,
      ),
    ).toStrictEqual(['effect-test-no-runpromise']);
    expect(
      configuredEffectRuleNames(
        'it.effect.only("x", () => program);',
        'tests/unit/user.ts',
        effect,
      ),
    ).toStrictEqual(['effect-no-focused-effect-tests']);
    expect(
      configuredEffectRuleNames(
        'it.effect.skip("x", () => program);',
        'tests/unit/user.ts',
        effect,
      ),
    ).toStrictEqual(['effect-no-skipped-effect-tests']);
  });

  it('keeps default test runner and failure assertions under one canonical diagnostic', () => {
    const source = `
      it("fails", async () => {
        await expect(Effect.runPromise(program)).rejects.toThrow();
      });
    `;

    expect(configuredEffectRuleNames(source, 'src/user.test.ts', true)).toStrictEqual([
      'effect-test-no-runpromise',
    ]);
  });

  it('keeps strict test time diagnostics canonical when the default real-sleep rule owns the issue', () => {
    const source = 'it.effect("waits", () => Effect.sleep(Duration.seconds(1)));';

    expect(configuredEffectRuleNames(source, 'src/foo.test.ts')).toStrictEqual([
      'effect-no-real-sleep-in-tests',
    ]);
  });

  it('keeps exported runtime APIs under exported API ownership in strict mode', () => {
    expect(
      configuredEffectRuleNames('export const load = () => Effect.runPromise(program);'),
    ).toStrictEqual(['effect-no-runpromise-in-exported-api']);
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
      runRule(
        'effect-prefer-catchTag-over-catchAll',
        'const docs = "Effect.catchAll(() => Effect.succeed(1))";',
      ),
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

  it('detects runtime calls through submodule namespace and named imports', () => {
    expect(
      runRule(
        'effect-no-run-outside-entrypoints',
        'import * as E from "effect/Effect"; E.runPromise(program);',
      ),
    ).toHaveLength(1);
    expect(
      runRule(
        'effect-no-run-outside-entrypoints',
        'import { runPromise } from "effect/Effect"; runPromise(program);',
      ),
    ).toHaveLength(1);
  });

  it('detects aliased Effect.gen return anti-patterns', () => {
    const source =
      'import { Effect as E } from "effect"; E.gen(function* () { return E.succeed(1); });';

    expect(runRule('effect-require-return-yield-star', source)).toHaveLength(1);
  });

  it('checks re-exported public API types, interfaces, and classes', () => {
    expect(
      runRule(
        'effect-schema-no-unknown-crossing-boundary',
        'interface Input { payload: unknown } export { Input };',
      ),
    ).toHaveLength(1);
    expect(
      runRule(
        'effect-no-promise-returning-public-api',
        'type Loader = () => Promise<User>; export { Loader };',
      ),
    ).toHaveLength(1);
    expect(
      runRule(
        'effect-no-promise-returning-public-api',
        'type Loader = () => Promise<User>; export type { Loader };',
      ),
    ).toHaveLength(1);
    expect(
      runRule(
        'effect-schema-no-unknown-crossing-boundary',
        'interface Input { payload: unknown } export { type Input };',
      ),
    ).toHaveLength(1);
    expect(
      runRule(
        'effect-no-promise-returning-public-api',
        'class Repo { load(): Promise<User> { return promise; } } export { Repo };',
      ),
    ).toHaveLength(1);
    expect(
      runRule(
        'effect-no-promise-returning-public-api',
        'export { Loader }; type Loader = () => Promise<User>;',
      ),
    ).toHaveLength(1);
    expect(
      runRule(
        'effect-no-promise-returning-public-api',
        'export type { Loader }; type Loader = () => Promise<User>;',
      ),
    ).toHaveLength(1);
    expect(
      runRule(
        'effect-no-promise-returning-public-api',
        'export { load }; async function load(): Promise<User> { return promise; }',
      ),
    ).toHaveLength(1);
    expect(
      runRule(
        'effect-no-promise-returning-public-api',
        'type Loader = () => Promise<User>; export type { Loader } from "./api";',
      ),
    ).toHaveLength(0);
    expect(
      runRule(
        'effect-schema-no-unknown-crossing-boundary',
        'interface Input { payload: unknown } export { type Input } from "./api";',
      ),
    ).toHaveLength(0);
    expect(
      runRule(
        'effect-no-promise-returning-public-api',
        'export class Repo { static load(): Promise<User> { return promise; } }',
      ),
    ).toHaveLength(1);
    expect(
      runRule(
        'effect-no-promise-returning-public-api',
        'export class Repo { public static async load() { return user; } }',
      ),
    ).toHaveLength(1);
    expect(
      runRule(
        'effect-no-promise-returning-public-api',
        'export class Repo { private static load(): Promise<User> { return promise; } }',
      ),
    ).toHaveLength(0);
    expect(
      runRule(
        'effect-no-promise-returning-public-api',
        'export abstract class Repo { abstract load(): Promise<User>; }',
      ),
    ).toHaveLength(1);
    expect(
      runRule(
        'effect-no-promise-returning-public-api',
        'export class Repo extends Base { override load(): Promise<User> { return promise; } }',
      ),
    ).toHaveLength(1);
    expect(
      runRule(
        'effect-no-promise-returning-public-api',
        'export class Repo { load = async () => user; }',
      ),
    ).toHaveLength(1);
    expect(
      runRule(
        'effect-no-promise-returning-public-api',
        'export class Repo { load = (): Promise<User> => promise; }',
      ),
    ).toHaveLength(1);
    expect(
      runRule(
        'effect-no-promise-returning-public-api',
        'export class Repo { private load = async () => user; }',
      ),
    ).toHaveLength(0);
    expect(
      runRule(
        'effect-no-promise-returning-public-api',
        'export class Repo { get load(): Promise<User> { return promise; } }',
      ),
    ).toHaveLength(1);
    expect(
      runRule(
        'effect-no-promise-returning-public-api',
        'export class Repo { public accessor load: Promise<User>; }',
      ),
    ).toHaveLength(1);
    expect(
      runRule(
        'effect-no-promise-returning-public-api',
        'export class Repo { private get load(): Promise<User> { return promise; } }',
      ),
    ).toHaveLength(0);
  });

  it('does not let string text satisfy timeout and retry policy checks', () => {
    expect(
      runRule(
        'effect-require-timeout-on-external-effects',
        'const docs = "Effect.timeout("; const program = Effect.tryPromise({ try: () => fetch(url), catch: toError });',
        'src/adapters/http.ts',
      ),
    ).toHaveLength(1);
    expect(
      runRule(
        'effect-require-retry-policy-for-idempotent-external-effects',
        'const docs = "Effect.retry("; const program = Effect.tryPromise({ try: () => fetch(url), catch: toError }).pipe(Effect.timeout(1000));',
        'src/adapters/http.ts',
      ),
    ).toHaveLength(1);
  });

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
    expect(
      runRule(
        'effect-schema-no-cast-after-decode',
        'const decoded = Schema.decodeUnknown(User)(payload); const user = decoded as User;',
      ),
    ).toHaveLength(1);
  });
});
