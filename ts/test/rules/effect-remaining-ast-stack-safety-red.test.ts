import { describe, expect, it } from 'vitest';
import type { SourceRule } from '../../src/rules/effect-rule-core';
import { parseSync } from 'oxc-parser';
import { getEffectRule } from './effect-rule-test-utils';
import type { ASTNode } from '../../src/rules/effect-ast';

type ChainNode = { type: 'ExpressionStatement'; next?: ChainNode };
type FunctionNode = {
  async: boolean;
  body: ChainNode;
  generator: boolean;
  id: { name: string; type: 'Identifier' };
  params: ASTNode[];
  type: 'FunctionDeclaration';
};

type VisitorMap = ReturnType<SourceRule['create']>;

const NESTED_DEPTH = 2_048;

const visitorFor = (ruleName: string, source: string, reports: ASTNode[]): VisitorMap =>
  getEffectRule(ruleName).create({
    filename: 'src/deep.ts',
    report({ node }): void {
      reports.push(node);
    },
    sourceCode: { text: source },
  });

const effectProgram = (program: ReturnType<typeof parseSync>['program'] | ASTNode): ASTNode => {
  // SAFETY: the parser returns a Program with recursive AST fields; the bridge adds dictionary access only.
  return program as ASTNode;
};

const parseProgram = (source: string): ASTNode =>
  effectProgram(parseSync('deep.ts', source, { sourceType: 'module' }).program);

const cyclicChain = (count: number): ChainNode => {
  const first: ChainNode = { type: 'ExpressionStatement' };
  let current = first;
  for (let index = 1; index < count; index += 1) {
    const next: ChainNode = { type: 'ExpressionStatement' };
    current.next = next;
    current = next;
  }
  current.next = first;
  return first;
};

const identifier = (name: string): FunctionNode['id'] => ({ name, type: 'Identifier' });

describe('remaining Effect AST stack safety', (): void => {
  it('does not recurse through a deep recursion-analysis body', (): void => {
    const source = 'const marker = "function =>";';
    const reports: ASTNode[] = [];
    const visitor = visitorFor('effect-require-suspend-for-recursion', source, reports);
    const program = parseProgram(source);
    const functionNode: FunctionNode = {
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
