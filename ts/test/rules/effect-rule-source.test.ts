import { describe, expect, it } from 'vitest';
import type { Context } from '../../src/rules/effect-rule-core';
import { getEffectRule, type Report } from './effect-rule-test-utils';

const programNode = { type: 'Program', range: [0, 0] };

function runRuleWithContext(ruleName: string, context: Omit<Context, 'report'>): Report[] {
  const reports: Report[] = [];
  const rule = getEffectRule(ruleName);
  expect(rule, `${ruleName} must be registered`).toBeDefined();
  const visitors = rule.create({
    report(report) {
      reports.push(report);
    },
    ...context,
  });

  visitors.Program?.(programNode);

  return reports;
}

describe('Effect rule source reading', () => {
  it('uses sourceCode for helper-backed Effect rules', () => {
    const reports = runRuleWithContext('effect-no-runfork-without-observer', {
      sourceCode: {
        text: 'Effect.runFork(program);',
      },
    });

    expect(reports).toHaveLength(1);
  });
});
