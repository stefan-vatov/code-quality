import { describe, expect, it } from 'vitest';
import { runRule } from './effect-rule-test-utils';

const registerLocalStatementTests = (): void => {
  it('ignores Effect and Schema trigger text inside ordinary strings', () => {
    expect(
      runRule(
        'effect-require-return-yield-star',
        'Effect.gen(function* () { const docs = "return Effect.succeed(1)"; return 1; });',
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
    const focused = 'const docs = "it.effect.only(name, fn)";';
    const skipped = 'const docs = "describe.effect.skip(name, fn)";';

    expect(runRule('effect-no-focused-effect-tests', focused, 'src/user.test.ts')).toHaveLength(0);
    expect(runRule('effect-no-skipped-effect-tests', skipped, 'src/user.test.ts')).toHaveLength(0);
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

    expect(runRule('effect-require-bounded-concurrency', forEachSource)).toHaveLength(0);
    expect(runRule('effect-require-bounded-flatMap-concurrency', flatMapSource)).toHaveLength(0);
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
  });
};

const registerResourceAndBoundaryTests = (): void => {
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
  });

  it('detects more floating Effect expression statements', () => {
    expect(runRule('effect-no-floating-effect', 'enabled || Effect.succeed(1);')).toHaveLength(1);
    expect(
      runRule('effect-no-floating-effect', 'enabled ? Effect.succeed(1) : Effect.void;'),
    ).toHaveLength(1);
  });
};

describe('Effect cycle 22 regression coverage', (): void => {
  registerLocalStatementTests();
  registerResourceAndBoundaryTests();
});
