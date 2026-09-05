import {
  type Context,
  type RuleSpec,
  type SourceRule,
  makeRules,
} from '../../src/rules/effect-rule-core';
import { describe, expect, it } from 'vitest';

interface ReportLocation {
  column: number | undefined;
  line: number | undefined;
}

const program = {
  body: [
    {
      expression: {
        callee: { name: 'succeed', type: 'Identifier' },
        type: 'CallExpression',
      },
      type: 'ExpressionStatement',
    },
    {
      expression: {
        callee: { name: 'succeed', type: 'Identifier' },
        type: 'CallExpression',
      },
      type: 'ExpressionStatement',
    },
  ],
  type: 'Program',
};

const ruleFrom = (spec: RuleSpec): SourceRule => {
  const rule = makeRules([spec])[spec.name];
  if (rule === undefined) {
    throw new Error(`Missing generated rule ${spec.name}`);
  }
  return rule;
};

describe('Effect rule core streaming regressions', (): void => {
  it('preserves shared pattern state when context.report re-enters Program', (): void => {
    const source = 'Effect.succeed(1); Effect.succeed(2);';
    const pattern = /Effect[.]succeed/;
    const reports: ReportLocation[] = [];
    let shouldReenter = true;
    const context: Context = {
      report(descriptor): void {
        reports.push({ column: descriptor.loc?.column, line: descriptor.loc?.line });
        if (shouldReenter) {
          shouldReenter = false;
          visitors?.Program(program);
        }
      },
      sourceCode: { text: source },
    };
    const rule = ruleFrom({
      countPatterns: [pattern],
      message: 're-entrant pattern',
      name: 're-entrant-pattern-state',
      patterns: [pattern],
      tokens: ['Effect.succeed'],
    });
    const visitors = rule.create(context);

    visitors.Program(program);

    const secondMatchColumn = source.indexOf(
      'Effect.succeed',
      source.indexOf('Effect.succeed') + 1,
    );
    expect(reports).toEqual([
      { column: 0, line: 1 },
      { column: 0, line: 1 },
      { column: secondMatchColumn, line: 1 },
      { column: secondMatchColumn, line: 1 },
    ]);
  });

  it.each([
    { label: 'U+2028', separator: '\u2028' },
    { label: 'U+2029', separator: '\u2029' },
  ])('advances line locations and ends // comments at $label', ({ separator }): void => {
    const source = `const ignored = 1; // ignored${separator}Effect.succeed(1);`;
    const reports: ReportLocation[] = [];
    const context: Context = {
      report(descriptor): void {
        reports.push({ column: descriptor.loc?.column, line: descriptor.loc?.line });
      },
      sourceCode: { text: source },
    };
    const rule = ruleFrom({
      message: 'line terminator projection',
      name: 'unicode-line-terminator-projection',
      patterns: [/Effect[.]succeed/],
      tokens: ['Effect.succeed'],
    });

    rule.create(context).Program({
      body: [{ type: 'VariableDeclaration' }, { type: 'ExpressionStatement' }],
      type: 'Program',
    });

    expect(reports).toEqual([{ column: 0, line: 2 }]);
  });
});
