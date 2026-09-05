import { describe, expect, it } from 'vitest';
import theThracianOxlint from '../../src/index';
import { effectStrictRuleNames } from '../../src/rules/effect-rule-names';
import { runRule } from './effect-rule-test-utils';

const registerDefaultResearchRules = (): void => {
  it('keeps selected strict rules error-only when explicitly enabled', () => {
    const defaultConfig = theThracianOxlint();
    const strictConfig = theThracianOxlint({
      effect: true,
    });

    for (const ruleName of effectStrictRuleNames) {
      expect(defaultConfig.rules).not.toHaveProperty(`thethracian/${ruleName}`);
      const setting = strictConfig.rules?.[`thethracian/${ruleName}`];
      expect(Array.isArray(setting) ? setting[0] : setting).toBe('error');
    }
  });

  it('reports retained Effect safety hazards without broad JavaScript bans', () => {
    expect(
      runRule(
        'effect-require-typed-error-in-trypromise',
        'const task = Effect.tryPromise({ try: () => fetch("/users") });',
      ),
    ).toHaveLength(1);
    expect(runRule('effect-no-unbounded-queue', 'const queue = Queue.unbounded();')).toHaveLength(
      1,
    );
    expect(
      runRule(
        'effect-no-silent-error-swallowing',
        'const ignored = Effect.ignore(Effect.succeed(undefined));',
      ),
    ).toHaveLength(1);
  });

  it('recognizes service self matching in the default compatibility rules', () => {
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
};

const registerStrictResearchRules = (): void => {};

describe('Effect safety and strict rule coverage', (): void => {
  registerDefaultResearchRules();
  registerStrictResearchRules();
});
