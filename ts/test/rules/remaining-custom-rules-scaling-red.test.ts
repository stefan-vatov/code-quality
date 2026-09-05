import { describe, expect, it } from 'vitest';
import type { SourceRule } from '../../src/rules/effect-rule-core';
import type { ASTNode, ASTValue } from '../../src/rules/effect-ast';
import { childNode, isASTArray, isASTObject } from '../../src/rules/effect-ast';
import { parseSync } from 'oxc-parser';
import plugin from '../../src/rules/plugin';

type RuleBridgeInput = (typeof plugin.rules)[string] | SourceRule;
type ProgramBridgeInput = ReturnType<typeof parseSync>['program'] | ASTNode;

const programNode = (program: ProgramBridgeInput): ASTNode => {
  return program as ASTNode;
};

const sourceRule = (rule: RuleBridgeInput): SourceRule => {
  return rule as SourceRule;
};

const callNamed = (program: ASTNode, name: string): ASTNode | undefined => {
  const pending: ASTValue[] = [program];
  while (pending.length > 0) {
    const value = pending.pop();
    if (!isASTObject(value)) {
      continue;
    }
    if (value.type === 'CallExpression') {
      const node = value as ASTNode;
      const callee = childNode(node, 'callee');
      if (callee && childNode(callee, 'property')?.name === name) {
        return node;
      }
    }
    for (const child of Object.values(value)) {
      if (isASTArray(child)) {
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
  const program = programNode(parseSync('nested.ts', source, { sourceType: 'module' }).program);
  const rule = sourceRule(plugin.rules[ruleName]);
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
