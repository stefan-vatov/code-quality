import { describe, expect, it } from 'vitest';
import type { SourceRule } from '../../src/rules/effect-rule-core';
import { parseSync } from 'oxc-parser';
import plugin from '../../src/rules/plugin';

type SyntheticNode = {
  [key: string]: unknown;
  type: string;
};

type VisitorMap = ReturnType<SourceRule['create']>;

const NESTED_DEPTH = 2_048;

const ruleFor = (ruleName: string): SourceRule => {
  const rule: unknown = Reflect.get(plugin.rules, ruleName);
  if (!rule || typeof rule !== 'object') {
    throw new Error(`${ruleName} must be registered`);
  }
  return rule as SourceRule;
};

const visitorFor = (ruleName: string, source: string, reports: SyntheticNode[]): VisitorMap =>
  ruleFor(ruleName).create({
    filename: 'src/deep.ts',
    report({ node }): void {
      reports.push(node as SyntheticNode);
    },
    sourceCode: { text: source },
  });

const parseProgram = (source: string): SyntheticNode =>
  parseSync('deep.ts', source, { sourceType: 'module' }).program as unknown as SyntheticNode;

const cyclicChain = (count: number): SyntheticNode => {
  const first: SyntheticNode = { type: 'ExpressionStatement' };
  let current = first;
  for (let index = 1; index < count; index += 1) {
    const next: SyntheticNode = { type: 'ExpressionStatement' };
    current.next = next;
    current = next;
  }
  current.next = first;
  return first;
};

const identifier = (name: string): SyntheticNode => ({ name, type: 'Identifier' });

describe('remaining Effect AST stack safety', (): void => {
  it('does not recurse through a deep recursion-analysis body', (): void => {
    const source = 'const marker = "function =>";';
    const reports: SyntheticNode[] = [];
    const visitor = visitorFor('effect-require-suspend-for-recursion', source, reports);
    const program = parseProgram(source);
    const functionNode: SyntheticNode = {
      async: false,
      body: cyclicChain(NESTED_DEPTH),
      generator: false,
      id: identifier('recur'),
      params: [],
      type: 'FunctionDeclaration',
    };
    const visitFunction = visitor.FunctionDeclaration;
    if (!visitFunction) {
      throw new Error('effect-require-suspend-for-recursion must visit FunctionDeclaration');
    }
    visitor.Program(program);

    expect(() => visitFunction(functionNode)).not.toThrow();
  });
});
