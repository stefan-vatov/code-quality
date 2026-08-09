import { describe, expect, it } from 'vitest';
import type { SourceRule } from '../../src/rules/effect-rule-core';
import { parseSync } from 'oxc-parser';
import plugin from '../../src/rules/plugin';

const callNamed = (program: object, name: string): object | undefined => {
  const pending: unknown[] = [program];
  while (pending.length > 0) {
    const value = pending.pop();
    if (value === null || typeof value !== 'object') {
      continue;
    }
    const node = value as {
      callee?: { property?: { name?: string }; type?: string };
      type?: string;
    };
    if (node.type === 'CallExpression' && node.callee?.property?.name === name) {
      return value;
    }
    for (const child of Object.values(value)) {
      if (Array.isArray(child)) {
        pending.push(...child);
      } else {
        pending.push(child);
      }
    }
  }
  return undefined;
};

const runNestedASTRule = (
  ruleName: string,
  wrapperName: string,
  yieldedExpression: string,
): number => {
  const depth = 2_048;
  const nestedValue = `${'['.repeat(depth)}0${']'.repeat(depth)}`;
  const source =
    wrapperName === 'gen'
      ? `import { Effect } from 'effect'; Effect.gen(function* () { const value = ${nestedValue}; yield* ${yieldedExpression}; });`
      : `import { Effect } from 'effect'; Effect.promise(() => ${'['.repeat(depth)}${yieldedExpression}${']'.repeat(depth)});`;
  const program = parseSync('nested.ts', source, { sourceType: 'module' }).program as object;
  const rule: SourceRule = Reflect.get(plugin.rules, ruleName) as SourceRule;
  const reports: object[] = [];
  const visitors = rule.create({
    report({ node }): void {
      reports.push(node);
    },
    sourceCode: { text: source },
  });
  visitors.Program(program);
  const call = callNamed(program, wrapperName);
  if (call !== undefined) {
    visitors.CallExpression?.(call);
  }
  return reports.length;
};

describe('remaining Effect rule scaling regressions', (): void => {
  it.each([['effect-no-global-fetch', 'promise', 'fetch()']])(
    'walks deeply nested ASTs for %s without recursion overflow',
    (ruleName, wrapperName, expression): void => {
      expect(runNestedASTRule(ruleName, wrapperName, expression)).toBe(1);
    },
  );
});
