import { describe, expect, it } from 'vitest';
import theThracianOxlint from '../../src/index.js';
import { runConfiguredRules, runRule } from './effect-rule-test-utils.js';

function configuredEffectRuleNames(source: string, filename = 'src/domain/user.ts'): string[] {
  return runConfiguredRules(theThracianOxlint({ effect: { strict: true } }), source, filename)
    .map((report) => report.ruleName)
    .filter((ruleName): ruleName is string => Boolean(ruleName))
    .sort();
}

describe('Effect cycle 22 regression coverage', () => {
  it('ignores strings inside template literal interpolations', () => {
    expect(
      runRule(
        'effect-no-run-outside-entrypoints',
        'const rendered = `${"Effect.runPromise(program)"}`;',
      ),
    ).toHaveLength(0);
    expect(
      runRule(
        'effect-no-process-env-in-effect-code',
        'import { Effect } from "effect"; const rendered = `${"process.env.API_TOKEN"}`;',
      ),
    ).toHaveLength(0);
    expect(
      runRule(
        'effect-no-run-outside-entrypoints',
        'const rendered = `${`Effect.runPromise(program)`}`;',
      ),
    ).toHaveLength(0);
  });

  it('ignores Effect and Schema trigger text inside ordinary strings', () => {
    expect(
      runRule(
        'effect-require-return-yield-star',
        'Effect.gen(function* () { const docs = "return Effect.succeed(1)"; return 1; });',
      ),
    ).toHaveLength(0);
    expect(
      runRule(
        'effect-schema-no-unsafe-sync-decode-in-effect-code',
        'Effect.gen(function* () { const docs = "Schema.decodeSync(User)(payload)"; return 1; });',
      ),
    ).toHaveLength(0);
    expect(
      runRule(
        'effect-schema-prefer-decodeUnknown-effect',
        'const docs = "Schema.decodeUnknownPromise(User)(payload)";',
      ),
    ).toHaveLength(0);
    expect(
      runRule(
        'effect-require-typed-error-in-trypromise',
        'const docs = "Effect.tryPromise(() => fetch())";',
      ),
    ).toHaveLength(0);
  });

  it('keeps runSync server-handler checks inside the handler expression', () => {
    const source = `
      const handler = () => ok;
      const unrelated = Effect.runSync(program);
    `;

    expect(runRule('effect-no-runSync-in-server-request-handlers', source)).toHaveLength(0);
    expect(
      runRule(
        'effect-no-runSync-in-server-request-handlers',
        'function handler() { return Effect.runSync(program); }',
      ),
    ).toHaveLength(1);
  });

  it('ignores test-rule trigger text inside documentation strings', () => {
    const source = `
      it("docs", () => {
        const docs = "Effect.runPromise(program) rejects toThrow";
      });
    `;

    const focused = 'const docs = "it.effect.only(name, fn)";';
    const skipped = 'const docs = "describe.effect.skip(name, fn)";';
    const sleep = 'const docs = "Effect.sleep(1000)";';
    const clock = 'const docs = "TestClock.adjust(1000)";';

    expect(runRule('effect-test-no-runpromise', source, 'src/user.test.ts')).toHaveLength(0);
    expect(
      runRule('effect-prefer-it-effect-for-unit-tests', source, 'src/user.test.ts'),
    ).toHaveLength(0);
    expect(runRule('effect-use-exit-for-failure-tests', source, 'src/user.test.ts')).toHaveLength(
      0,
    );
    expect(runRule('effect-no-focused-effect-tests', focused, 'src/user.test.ts')).toHaveLength(0);
    expect(runRule('effect-no-skipped-effect-tests', skipped, 'src/user.test.ts')).toHaveLength(0);
    expect(runRule('effect-no-real-sleep-in-tests', sleep, 'src/user.test.ts')).toHaveLength(0);
    expect(
      runRule('effect-testClock-requires-testContext', clock, 'src/user.test.ts'),
    ).toHaveLength(0);
  });

  it('accepts multi-line Schema decode flows at request and persistence boundaries', () => {
    const requestSource = `
      const route = HttpRouter.post("/users", Effect.gen(function* () {
        const body = yield* request.json;
        const input = yield* Schema.decodeUnknown(User)(body);
        return input;
      }));
    `;
    const persistenceSource = `
      const row = yield* db.select("users");
      const user = yield* Schema.decodeUnknown(User)(row);
    `;

    expect(runRule('effect-schema-require-http-server-request-schema', requestSource)).toHaveLength(
      0,
    );
    expect(runRule('effect-schema-require-persistence-schema', persistenceSource)).toHaveLength(0);
  });

  it('keeps broad default checks inside the local statement', () => {
    const forEachSource = `
      Effect.forEach(items, work);
      const options = { concurrency: "unbounded" };
    `;
    const flatMapSource = `
      Effect.flatMap(value, work);
      const options = { concurrency: "unbounded" };
    `;
    const parsedNumberSource = `
      JSON.parse(body);
      const User = Schema.Struct({ age: Schema.NumberFromString });
    `;
    const decodedElsewhereSource = `
      const data = response.json();
      const decoder = Schema.decodeUnknown(User);
    `;
    const castElsewhereSource = `
      const decode = Schema.decodeUnknown(User)(payload);
      const user = value as User;
    `;

    expect(runRule('effect-require-bounded-concurrency', forEachSource)).toHaveLength(0);
    expect(runRule('effect-require-bounded-flatMap-concurrency', flatMapSource)).toHaveLength(0);
    expect(
      runRule('effect-schema-correct-number-type-for-parsed-json', parsedNumberSource),
    ).toHaveLength(0);
    expect(
      runRule('effect-schema-use-decodeUnknown-for-external-data', decodedElsewhereSource),
    ).toHaveLength(1);
    expect(runRule('effect-schema-no-cast-after-decode', castElsewhereSource)).toHaveLength(0);
  });

  it('still rejects unsafe local unbounded concurrency and parsed JSON number schemas', () => {
    expect(
      runRule(
        'effect-require-bounded-concurrency',
        'Effect.forEach(items, work, { concurrency: "unbounded" });',
      ),
    ).toHaveLength(1);
    expect(
      runRule(
        'effect-require-bounded-flatMap-concurrency',
        'Effect.flatMap(value, work, { concurrency: "unbounded" });',
      ),
    ).toHaveLength(1);
    expect(
      runRule(
        'effect-schema-correct-number-type-for-parsed-json',
        'const user = Schema.decodeUnknownSync(Schema.NumberFromString)(JSON.parse(body));',
      ),
    ).toHaveLength(1);
    expect(
      runRule(
        'effect-schema-no-cast-after-decode',
        'const user = Schema.decodeUnknown(User)(payload) as User;',
      ),
    ).toHaveLength(1);
  });

  it('ignores resource and layer trigger text inside ordinary strings', () => {
    expect(
      runRule(
        'effect-require-scoped-for-acquireRelease',
        'const docs = "Effect.acquireRelease(openConnection, closeConnection)";',
      ),
    ).toHaveLength(0);
    expect(
      runRule('effect-require-scoped-for-resources', 'const docs = "Socket.open(url)";'),
    ).toHaveLength(0);
    expect(
      runRule(
        'effect-require-acquire-release',
        'const docs = "Effect.tryPromise(() => openConnection())";',
      ),
    ).toHaveLength(0);
    expect(
      runRule(
        'effect-require-scoped-for-resource-layers',
        'const docs = "Layer.effect(UserRepo, openConnection())";',
      ),
    ).toHaveLength(0);
    expect(
      runRule(
        'effect-require-centralized-provision',
        'const docs = "Effect.provide(program, Live)";',
      ),
    ).toHaveLength(0);
    expect(
      runRule(
        'effect-no-leaked-service-dependencies',
        'const docs = "Layer.effect(UserRepo, impl)";',
      ),
    ).toHaveLength(0);
  });

  it('detects more floating Effect expression statements', () => {
    expect(runRule('effect-no-floating-effect', 'enabled || Effect.succeed(1);')).toHaveLength(1);
    expect(
      runRule('effect-no-floating-effect', 'enabled ? Effect.succeed(1) : Effect.void;'),
    ).toHaveLength(1);
  });

  it('detects aliased Effect runtime calls from root imports', () => {
    const source = 'import { Effect as E } from "effect"; E.runPromise(program);';

    expect(runRule('effect-no-run-outside-entrypoints', source)).toHaveLength(1);
  });

  it('keeps Promise public API checks on signatures and includes exported class methods', () => {
    const functionBodyFetch = `
      export function load(): Effect.Effect<User> {
        const thunk = () => fetch(url);
        return program;
      }
    `;
    const classMethod = 'export class Repo { load(): Promise<User> { return promise; } }';

    expect(runRule('effect-no-promise-returning-public-api', functionBodyFetch)).toHaveLength(0);
    expect(runRule('effect-no-promise-returning-public-api', classMethod)).toHaveLength(1);
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

  it('keeps wrapped fetch owned by platform and external-effect policy rules', () => {
    expect(
      configuredEffectRuleNames(
        'const program = Effect.tryPromise({ try: () => fetch("/users"), catch: toError });',
      ),
    ).toStrictEqual([
      'effect-no-global-fetch',
      'effect-require-retry-policy-for-idempotent-external-effects',
      'effect-require-span-external',
      'effect-require-timeout-on-external-effects',
    ]);
  });
});
