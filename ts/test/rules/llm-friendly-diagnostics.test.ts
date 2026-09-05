import { describe, expect, it } from 'vitest';
import { effectDefaultRuleNames, effectStrictRuleNames } from '../../src/rules/effect-rule-names';
import plugin from '../../src/rules/plugin';
import { runRule } from './effect-rule-test-utils';

const expectLLMFriendly = (message: string): void => {
  expect(message).toContain('Fix:');
  expect(message).toContain('Example:');
  expect(message).not.toContain('TODO');
};

describe('LLM-friendly custom rule diagnostics', () => {
  it.each(effectDefaultRuleNames)('%s includes concrete fix guidance', (ruleName) => {
    const [report] = runRule(ruleName, 'Effect.fail("boom");');

    if (!report) {
      return;
    }

    expectLLMFriendly(report.message);
  });

  it.each([...effectDefaultRuleNames, ...effectStrictRuleNames])(
    '%s has registered LLM repair guidance',
    (ruleName) => {
      const rule = plugin.rules[ruleName];

      expect(rule).toBeDefined();
      expect(rule.meta?.docs?.description).toContain('Fix:');
      expect(rule.meta?.docs?.description).toContain('Example:');
    },
  );
});
