import { describe, expect, it } from 'vitest';
import plugin from '../../src/rules/plugin';
import { effectDefaultRuleNames, effectStrictRuleNames } from '../../src/rules/effect-rule-names';
import { runRule } from './effect-rule-test-utils';

type RuleName = keyof typeof plugin.rules;

type Report = {
  message: string;
  node: object;
};

const programNode = { range: [0, 0], type: 'Program' };

function firstMessageFor(ruleName: RuleName, source: string): string {
  const reports: Report[] = [];
  const visitors = plugin.rules[ruleName].create({
    filename: 'src/domain/user.ts',
    report(report: Report) {
      reports.push(report);
    },
  });

  visitors.Program?.(programNode);
  if (ruleName === 'no-dynamic-js-extension-imports') {
    visitors.ImportExpression?.({
      source: { value: './feature.js' },
      type: 'ImportExpression',
    });
  }
  if (source.length > 0) {
    visitors.VariableDeclarator?.({
      id: { name: 'ready' },
      init: { type: 'Literal', value: true },
      type: 'VariableDeclarator',
    });
  }
  return reports[0]?.message ?? '';
}

function messageFromVisitor(ruleName: RuleName, visitorName: string, node: object): string {
  const reports: Report[] = [];
  const visitors = plugin.rules[ruleName].create({
    report(report: Report) {
      reports.push(report);
    },
  });

  visitors[visitorName]?.(node);
  return reports[0]?.message ?? '';
}

const expectLLMFriendly = (message: string): void => {
  expect(message).toContain('Fix:');
  expect(message).toContain('Example:');
  expect(message).not.toContain('TODO');
};

describe('LLM-friendly custom rule diagnostics', () => {
  it('gives agents concrete fix and example text for hand-written custom rules', () => {
    expectLLMFriendly(firstMessageFor('no-dynamic-js-extension-imports', ''));
    expectLLMFriendly(firstMessageFor('boolean-prefix', 'const ready = true;'));
    expectLLMFriendly(
      messageFromVisitor('camel-case-identifiers', 'FunctionDeclaration', {
        id: { name: 'Bad_Name' },
      }),
    );
    expectLLMFriendly(
      messageFromVisitor('pascal-case-types', 'ClassDeclaration', {
        id: { name: 'bad_name' },
      }),
    );
    expectLLMFriendly(
      messageFromVisitor('private-underscore', 'MethodDefinition', {
        accessibility: 'private',
        key: { name: 'helper' },
      }),
    );
    expectLLMFriendly(
      messageFromVisitor('acronym-case', 'VariableDeclarator', {
        id: { name: 'apiUrl' },
      }),
    );
  });

  it.each(effectDefaultRuleNames)('%s includes concrete fix guidance', (ruleName) => {
    const [report] = runRule(ruleName, 'Effect.fail("boom");');

    if (!report) {
      return;
    }

    expectLLMFriendly(report.message);
  });

  it('enriches AST-backed Effect reports too', () => {
    const [report] = runRule('effect-no-string-errors', 'Effect.fail("boom");');

    expect(report).toBeDefined();
    expectLLMFriendly(report?.message ?? '');
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
