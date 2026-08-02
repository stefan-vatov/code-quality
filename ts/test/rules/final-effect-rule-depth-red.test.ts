import { describe, expect, it } from 'vitest';
import type { SourceRule } from '../../src/rules/effect-rule-core';
import { parseSync } from 'oxc-parser';
import plugin from '../../src/rules/plugin';

type SyntheticNode = {
  [key: string]: unknown;
  type: string;
};

type EffectRuleCase = {
  calleeProperty: string;
  name: string;
  ruleName: string;
  source: string;
};

const DEPTH = 10_000;

const effectRuleCases: readonly EffectRuleCase[] = [
  {
    calleeProperty: 'flatMap',
    name: 'andThen',
    ruleName: 'effect-prefer-andThen-over-flatMap-discarded-value',
    source: 'import { Effect } from "effect"; Effect.flatMap(first, () => second);',
  },
  {
    calleeProperty: 'catchAll',
    name: 'catchIf',
    ruleName: 'effect-prefer-catchIf-over-conditional-catch',
    source:
      'import { Effect } from "effect"; Effect.catchAll(program, error => isRecoverable(error) ? recover(error) : Effect.fail(error));',
  },
  {
    calleeProperty: 'flatMap',
    name: 'filterOrFail',
    ruleName: 'effect-prefer-filterOrFail-over-flatMap-guard',
    source:
      'import { Effect } from "effect"; Effect.flatMap(source, value => value.ready === true ? Effect.succeed(value) : Effect.fail(new Rejected()));',
  },
  {
    calleeProperty: 'flatMap',
    name: 'tap',
    ruleName: 'effect-prefer-tap-over-flatMap-as',
    source:
      'import { Effect } from "effect"; Effect.flatMap(program, value => Effect.as(audit(value), value));',
  },
];

const isNode = (value: unknown): value is SyntheticNode =>
  value !== null && typeof value === 'object' && typeof Reflect.get(value, 'type') === 'string';

const childNode = (node: SyntheticNode | undefined, key: string): SyntheticNode | undefined => {
  const value = node ? Reflect.get(node, key) : undefined;
  if (isNode(value)) {
    return value;
  }
  return undefined;
};

const ruleFor = (ruleName: string): SourceRule => {
  const rule: unknown = Reflect.get(plugin.rules, ruleName);
  if (!rule || typeof rule !== 'object') {
    throw new Error(`${ruleName} must be registered`);
  }
  return rule as SourceRule;
};

const parseProgram = (source: string): SyntheticNode =>
  parseSync('effect-rule-depth.ts', source, { sourceType: 'module' })
    .program as unknown as SyntheticNode;

const callFor = (program: SyntheticNode, calleeProperty: string): SyntheticNode => {
  const pending: unknown[] = [program];
  const visited = new WeakSet<object>();
  while (pending.length > 0) {
    const value = pending.pop();
    if (!isNode(value) || visited.has(value)) {
      continue;
    }
    visited.add(value);
    const callee = childNode(value, 'callee');
    if (
      value.type === 'CallExpression' &&
      Reflect.get(childNode(callee, 'property'), 'name') === calleeProperty
    ) {
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
  throw new Error(`Missing ${calleeProperty} call`);
};

const identifier = (name: string): SyntheticNode => ({ name, type: 'Identifier' });

const cyclicMemberChain = (count: number): SyntheticNode => {
  const first: SyntheticNode = {
    computed: false,
    object: identifier('base'),
    optional: false,
    property: identifier('member'),
    type: 'MemberExpression',
  };
  let current = first;
  for (let index = 1; index < count; index += 1) {
    const next: SyntheticNode = {
      computed: false,
      object: identifier('base'),
      optional: false,
      property: identifier('member'),
      type: 'MemberExpression',
    };
    current.object = next;
    current = next;
  }
  current.object = first;
  return first;
};

const runCall = (
  testCase: EffectRuleCase,
  mutate: (call: SyntheticNode) => void = (): void => {},
): number => {
  const reports: SyntheticNode[] = [];
  const source = testCase.source;
  const visitors = ruleFor(testCase.ruleName).create({
    filename: 'effect-rule-depth.ts',
    report({ node }): void {
      reports.push(node as SyntheticNode);
    },
    sourceCode: { text: source },
  });
  const program = parseProgram(source);
  visitors.Program(program);
  const call = callFor(program, testCase.calleeProperty);
  mutate(call);
  visitors.CallExpression?.(call);
  return reports.length;
};

const runCyclicCallee = (testCase: EffectRuleCase): number =>
  runCall(testCase, (call): void => {
    const callee = childNode(call, 'callee');
    if (!callee) {
      throw new Error('Missing target callee');
    }
    callee.object = cyclicMemberChain(DEPTH);
  });

const nestedFailureSource = `import { Effect } from "effect"; Effect.flatMap(source, value => value.ready === true ? Effect.succeed(value) : Effect.fail(base${'.member'.repeat(DEPTH)}));`;

const runNestedFailureExpression = (): number => {
  const testCase = effectRuleCases[2];
  if (!testCase) {
    throw new Error('Missing filterOrFail test case');
  }
  const reports: SyntheticNode[] = [];
  const visitors = ruleFor(testCase.ruleName).create({
    filename: 'effect-rule-depth.ts',
    report({ node }): void {
      reports.push(node as SyntheticNode);
    },
    sourceCode: { text: nestedFailureSource },
  });
  const program = parseProgram(nestedFailureSource);
  visitors.Program(program);
  const call = callFor(program, testCase.calleeProperty);
  visitors.CallExpression?.(call);
  return reports.length;
};

describe('final Effect rule depth audit', (): void => {
  it.each(effectRuleCases)('keeps the shallow semantic path live for $name', (testCase): void => {
    expect(runCall(testCase)).toBe(1);
  });

  it.each(effectRuleCases)('terminates a 10,000-node cyclic callee for $name', (testCase): void => {
    expect(() => runCyclicCallee(testCase)).not.toThrow();
  });

  it('terminates a parser-accepted 10,000-node filter failure expression', (): void => {
    expect(() => runNestedFailureExpression()).not.toThrow();
  });
});
