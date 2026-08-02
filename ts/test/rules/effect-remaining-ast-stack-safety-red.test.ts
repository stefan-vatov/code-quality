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
const CYCLIC_NODE_COUNT = 10_000;

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

const nestedExpression = (expression: string, depth = NESTED_DEPTH): string =>
  `${'['.repeat(depth)}${expression}${']'.repeat(depth)}`;

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

const cyclicMemberCall = (propertyName: string, count = CYCLIC_NODE_COUNT): SyntheticNode => {
  const first: SyntheticNode = {
    computed: false,
    object: identifier('base'),
    property: identifier(propertyName),
    type: 'MemberExpression',
  };
  let current = first;
  for (let index = 1; index < count; index += 1) {
    const next: SyntheticNode = {
      computed: false,
      object: identifier('base'),
      property: identifier('member'),
      type: 'MemberExpression',
    };
    current.object = next;
    current = next;
  }
  current.object = first;
  return { arguments: [], callee: first, type: 'CallExpression' };
};

const nestedCases = [
  {
    name: 'effect-prefer-asSome',
    source: (expression: string): string =>
      `import { Effect, Option } from "effect"; const nested = ${expression};`,
    expression: 'Effect.map(program, Option.some)',
    visitorKey: 'CallExpression',
  },
  {
    name: 'effect-prefer-succeed-for-stable-values',
    source: (expression: string): string =>
      `import { Effect } from "effect"; const nested = ${expression};`,
    expression: 'Effect.sync(() => "stable")',
    visitorKey: 'CallExpression',
  },
  {
    name: 'effect-prefer-option-nullish-getters',
    source: (expression: string): string =>
      `import { Option } from "effect"; const candidate = Option.some(1); const nested = ${expression};`,
    expression: 'Option.isSome(candidate) ? candidate.value : undefined',
    visitorKey: 'ConditionalExpression',
  },
  {
    name: 'effect-prefer-collection-discard-over-asVoid',
    source: (expression: string): string =>
      `import { Effect } from "effect"; const nested = ${expression};`,
    expression: 'Effect.all([first]).pipe(Effect.asVoid)',
    visitorKey: 'CallExpression',
  },
  {
    name: 'effect-no-sync-for-promise',
    source: (expression: string): string => `const nested = ${expression}; Effect.runSync(nested);`,
    expression: 'Effect.sync(() => Promise.resolve(1))',
    visitorKey: 'CallExpression',
  },
] as const;

describe('remaining Effect AST stack safety', (): void => {
  it.each(nestedCases)(
    'does not recurse through a real Oxc tree at depth 2,048 for $name',
    (testCase): void => {
      const source = testCase.source(nestedExpression(testCase.expression));
      const reports: SyntheticNode[] = [];
      const visitor = visitorFor(testCase.name, source, reports);
      expect(visitor).toHaveProperty(testCase.visitorKey);

      expect(() => visitor.Program(parseProgram(source))).not.toThrow();
    },
  );

  it.each(nestedCases)('terminates a 10,000-node synthetic cycle for $name', (testCase): void => {
    const source = testCase.source(testCase.expression);
    const reports: SyntheticNode[] = [];
    const visitor = visitorFor(testCase.name, source, reports);
    const program = parseProgram(source);
    program.syntheticCycle = cyclicChain(CYCLIC_NODE_COUNT);
    expect(visitor).toHaveProperty(testCase.visitorKey);

    expect(() => visitor.Program(program)).not.toThrow();
  });

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

  const memberCycleCases = [
    {
      name: 'effect-prefer-as-over-map-constant',
      propertyName: 'run',
      source: 'import { Effect } from "effect"; const marker = "map =>";',
    },
    {
      name: 'effect-prefer-mapBoth',
      propertyName: 'pipe',
      source: 'import { Effect } from "effect"; const marker = "mapError map";',
    },
    {
      name: 'effect-prefer-layer-sync',
      propertyName: 'run',
      source: 'import { Effect, Layer } from "effect"; const marker = "effect Layer sync";',
    },
    {
      name: 'effect-prefer-option-getOrElse',
      propertyName: 'run',
      source: 'import { Option } from "effect"; const marker = "effect match onNone onSome";',
    },
    {
      name: 'effect-prefer-option-orElseSome',
      propertyName: 'run',
      source: 'import { Option } from "effect"; const marker = "effect orElse some";',
    },
    {
      name: 'effect-prefer-ref-getAndUpdate',
      propertyName: 'run',
      source: 'import { Ref } from "effect"; const marker = "effect Ref modify => [";',
    },
    {
      name: 'effect-prefer-succeedNone',
      propertyName: 'run',
      source: 'import { Effect, Option } from "effect"; const marker = "succeed none";',
    },
    {
      name: 'effect-prefer-succeedSome',
      propertyName: 'run',
      source: 'import { Effect, Option } from "effect"; const marker = "succeed some";',
    },
  ] as const;

  it.each(memberCycleCases)(
    'terminates a 10,000-node cyclic member fallback for $name',
    (testCase): void => {
      const reports: SyntheticNode[] = [];
      const visitor = visitorFor(testCase.name, testCase.source, reports);
      const program = parseProgram(testCase.source);
      const visitCall = visitor.CallExpression;
      if (!visitCall) {
        throw new Error(`${testCase.name} must visit CallExpression`);
      }
      visitor.Program(program);

      expect(() => visitCall(cyclicMemberCall(testCase.propertyName))).not.toThrow();
    },
  );
});
