import { describe, expect, it } from 'vitest';
import { runRule } from './effect-rule-test-utils';

describe('Effect cycle 23 regression coverage', () => {
  it('ignores Effect workflow trigger text inside strings', () => {
    const returnDocs =
      'Effect.gen(function* () { const docs = "return Effect.succeed(1)"; return 1; });';
    const tryPromiseDocs = 'const docs = "Effect.tryPromise(async () => fetch(url))";';

    expect(runRule('effect-require-return-yield-star', returnDocs)).toHaveLength(0);
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
  });

  it('detects floating Effects in or and ternary expression statements', () => {
    expect(runRule('effect-no-floating-effect', 'enabled || Effect.succeed(1);')).toHaveLength(1);
    expect(
      runRule('effect-no-floating-effect', 'enabled ? Effect.succeed(1) : Effect.void;'),
    ).toHaveLength(1);
  });
});
