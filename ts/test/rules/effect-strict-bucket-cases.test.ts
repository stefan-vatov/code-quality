import { describe, expect, it } from 'vitest';
import theThracianOxlint from '../../src/index';
import { effectStrictRuleNames } from '../../src/rules/effect-rule-names';
import type { RuleCase } from './effect-rule-test-utils';
import { runConfiguredRules, runRule, sorted } from './effect-rule-test-utils';

const strictCases: RuleCase[] = [
  {
    name: 'effect-no-runSync-in-server-request-handlers',
    invalid: 'const handler = () => Effect.runSync(program);',
    valid: 'const handler = () => program;',
  },
];

describe('Effect strict rule behavior', () => {
  it('has one behavior case for every strict opt-in rule', () => {
    expect(sorted(strictCases.map((testCase) => testCase.name))).toStrictEqual(
      sorted(effectStrictRuleNames),
    );
  });

  it.each(strictCases)('detects and accepts strict rule $name', (testCase) => {
    expect(runRule(testCase.name, testCase.invalid, testCase.filename)).toHaveLength(1);
    expect(runRule(testCase.name, testCase.valid, testCase.filename)).toHaveLength(0);
  });

  it.each(strictCases)('keeps exported config behavior for strict rule $name', (testCase) => {
    const config = theThracianOxlint({
      effect: true,
    });
    const invalidRuleNames = runConfiguredRules(config, testCase.invalid, testCase.filename).map(
      (report) => report.ruleName,
    );
    const validRuleNames = runConfiguredRules(config, testCase.valid, testCase.filename).map(
      (report) => report.ruleName,
    );

    expect(invalidRuleNames).toContain(testCase.name);
    expect(validRuleNames).not.toContain(testCase.name);
  });
});
