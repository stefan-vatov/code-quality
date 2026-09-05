import { describe, expect, it } from 'vitest';
import theThracianOxlint from '../../src/index';
import { runRule } from './effect-rule-test-utils';

describe('Effect review fix regressions', () => {
  it('recognizes aliased Effect imports for default and strict rules', () => {
    expect(
      runRule('effect-no-floating-effect', 'import { Effect as E } from "effect";\nE.succeed(1);'),
    ).toHaveLength(1);
  });

  it('recognizes current Effect.Service self and key declarations', () => {
    expect(
      runRule(
        'effect-require-service-self-match',
        'class UserRepo extends Effect.Service<OrderRepo>()("UserRepo", {}) {}',
      ),
    ).toHaveLength(1);
    expect(
      runRule(
        'effect-require-service-self-match',
        'class UserRepo extends Effect.Service<UserRepo>()("UserRepo", {}) {}',
      ),
    ).toHaveLength(0);
  });

  it('does not apply Effect policies as broad JavaScript bans', () => {
    expect(theThracianOxlint().rules).not.toHaveProperty(
      'thethracian/effect-no-expected-error-as-defect',
    );
  });
});
