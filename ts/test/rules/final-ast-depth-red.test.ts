import { describe, expect, it } from 'vitest';
import type { NativeSourceCode } from '../../src/rules/effect-native-references';
import type { SourceRule } from '../../src/rules/effect-rule-core';
import { effectGlobalFetchAST } from '../../src/rules/effect-global-fetch-ast';
import preferAllDiscardRule from '../../src/rules/effect-prefer-all-discard';
import preferForEachDiscardRule from '../../src/rules/effect-prefer-foreach-discard';

type SyntheticNode = {
  [key: string]: unknown;
  type: string;
};

type NodeProperties = Record<string, unknown>;
type DiscardAPIName = 'all' | 'forEach';

interface DiscardRuleCase {
  apiName: DiscardAPIName;
  name: string;
  rule: SourceRule;
}

interface DeepDiscardRuleCase extends DiscardRuleCase {
  depth: number;
}

const DEEP_DEPTHS = [2_048, 10_000];
const CYCLIC_NODE_COUNT = 10_000;
const DISCARD_SOURCE = 'import effect gen yield all forEach';
const GLOBAL_FETCH_SOURCE = 'import { Effect } from "effect"; Effect.promise(() => fetch())';

const discardRuleCases: readonly DiscardRuleCase[] = [
  { apiName: 'all', name: 'effect-prefer-all-discard', rule: preferAllDiscardRule },
  { apiName: 'forEach', name: 'effect-prefer-forEach-discard', rule: preferForEachDiscardRule },
];

const deepDiscardRuleCases: readonly DeepDiscardRuleCase[] = discardRuleCases.flatMap(
  (testCase): DeepDiscardRuleCase[] =>
    DEEP_DEPTHS.map((depth): DeepDiscardRuleCase => ({ ...testCase, depth })),
);

const makeNode = (type: string, properties: NodeProperties = {}): SyntheticNode => ({
  type,
  ...properties,
});

const identifier = (name: string): SyntheticNode => makeNode('Identifier', { name });

const literal = (value: string): SyntheticNode => makeNode('Literal', { value });

const member = (object: SyntheticNode, propertyName: string): SyntheticNode =>
  makeNode('MemberExpression', {
    computed: false,
    object,
    property: identifier(propertyName),
  });

const discardCall = (apiName: DiscardAPIName): SyntheticNode => {
  const argumentsList =
    apiName === 'all'
      ? [makeNode('ArrayExpression', { elements: [identifier('value')] })]
      : [makeNode('ArrayExpression', { elements: [identifier('items')] }), identifier('work')];
  return makeNode('CallExpression', {
    arguments: argumentsList,
    callee: member(identifier('Effect'), apiName),
  });
};

const ignoredDiscardExpression = (apiName: DiscardAPIName): SyntheticNode =>
  makeNode('YieldExpression', {
    argument: discardCall(apiName),
    delegate: true,
  });

const shallowDiscardBody = (apiName: DiscardAPIName): SyntheticNode =>
  makeNode('BlockStatement', {
    body: [
      makeNode('ExpressionStatement', {
        expression: ignoredDiscardExpression(apiName),
      }),
    ],
  });

const deepDiscardBody = (apiName: DiscardAPIName, depth: number): SyntheticNode => {
  let value = ignoredDiscardExpression(apiName);
  for (let index = 0; index < depth; index += 1) {
    value = makeNode('ExpressionStatement', { expression: value });
  }
  return makeNode('BlockStatement', { body: [value] });
};

const cyclicDiscardBody = (): SyntheticNode => {
  const first = makeNode('ExpressionStatement');
  let current = first;
  for (let index = 1; index < CYCLIC_NODE_COUNT; index += 1) {
    const next = makeNode('ExpressionStatement');
    current.expression = next;
    current = next;
  }
  current.expression = first;
  return makeNode('BlockStatement', { body: [first] });
};

const generatorCall = (apiName: DiscardAPIName, body: SyntheticNode): SyntheticNode =>
  makeNode('CallExpression', {
    arguments: [
      makeNode('FunctionExpression', {
        async: false,
        body,
        generator: true,
        id: null,
        params: [],
        returnType: null,
      }),
    ],
    callee: member(identifier('Effect'), 'gen'),
  });

const discardProgram = (call: SyntheticNode): SyntheticNode =>
  makeNode('Program', {
    body: [
      makeNode('ImportDeclaration', {
        importKind: 'value',
        source: literal('effect'),
        specifiers: [
          makeNode('ImportSpecifier', {
            imported: identifier('Effect'),
            importKind: 'value',
            local: identifier('Effect'),
          }),
        ],
      }),
      makeNode('ExpressionStatement', { expression: call }),
    ],
  });

const reportsFromDiscardRule = (testCase: DiscardRuleCase, body: SyntheticNode): number => {
  const reports: object[] = [];
  const call = generatorCall(testCase.apiName, body);
  const visitors = testCase.rule.create({
    report({ node }): void {
      reports.push(node);
    },
    sourceCode: { text: DISCARD_SOURCE },
  });
  visitors.Program(discardProgram(call));
  const callVisitor = visitors.CallExpression;
  if (!callVisitor) {
    throw new Error(`${testCase.name} must visit CallExpression`);
  }
  callVisitor(call);
  return reports.length;
};

const cyclicArrayChain = (): SyntheticNode => {
  const first = makeNode('ArrayExpression', { elements: [] });
  let current = first;
  for (let index = 1; index < CYCLIC_NODE_COUNT; index += 1) {
    const next = makeNode('ArrayExpression', { elements: [] });
    current.elements = [next];
    current = next;
  }
  current.elements = [first];
  return first;
};

const reportsFromNativeGlobalFetch = (depth: number, cyclic: boolean): number => {
  const effectReference = identifier('Effect');
  const fetchReference = identifier('fetch');
  const sourceCode: NativeSourceCode & { text: string } = {
    isGlobalReference: (node): boolean => node === fetchReference,
    scopeManager: {
      scopes: [
        {
          references: [
            {
              identifier: effectReference,
              resolved: { defs: [{ type: 'ImportBinding' }] },
            },
          ],
        },
      ],
    },
    text: GLOBAL_FETCH_SOURCE,
  };
  const fetchCall = makeNode('CallExpression', {
    arguments: [],
    callee: fetchReference,
  });
  let argument: SyntheticNode = fetchCall;
  if (cyclic) {
    argument = cyclicArrayChain();
  } else {
    for (let index = 0; index < depth; index += 1) {
      argument = makeNode('ArrayExpression', { elements: [argument] });
    }
  }
  const wrapper = makeNode('CallExpression', {
    arguments: [argument],
    callee: member(effectReference, 'promise'),
  });
  const program = makeNode('Program', {
    body: [
      makeNode('ImportDeclaration', {
        importKind: 'value',
        source: literal('effect'),
        specifiers: [
          makeNode('ImportSpecifier', {
            imported: identifier('Effect'),
            importKind: 'value',
            local: effectReference,
          }),
        ],
      }),
    ],
  });
  const reports: object[] = [];
  const visitors = effectGlobalFetchAST(
    {
      report({ node }): void {
        reports.push(node);
      },
      sourceCode,
    },
    GLOBAL_FETCH_SOURCE,
  );
  visitors.Program(program);
  visitors.CallExpression(wrapper);
  return reports.length;
};

describe('final AST depth audit', (): void => {
  it.each(discardRuleCases)('preserves the shallow report for $name', (testCase): void => {
    expect(reportsFromDiscardRule(testCase, shallowDiscardBody(testCase.apiName))).toBe(1);
  });

  it.each(deepDiscardRuleCases)(
    'walks $name at synthetic depth $depth without a RangeError',
    (testCase): void => {
      expect(() =>
        reportsFromDiscardRule(testCase, deepDiscardBody(testCase.apiName, testCase.depth)),
      ).not.toThrow();
    },
  );

  it.each(discardRuleCases)('terminates a 10,000-node cycle for $name', (testCase): void => {
    expect(() => reportsFromDiscardRule(testCase, cyclicDiscardBody())).not.toThrow();
  });

  it('preserves the shallow native global-fetch report', (): void => {
    expect(reportsFromNativeGlobalFetch(0, false)).toBe(1);
  });

  it.each(DEEP_DEPTHS)('walks native global-fetch depth %d without a RangeError', (depth): void => {
    expect(() => reportsFromNativeGlobalFetch(depth, false)).not.toThrow();
  });

  it('terminates a 10,000-node native global-fetch cycle', (): void => {
    expect(() => reportsFromNativeGlobalFetch(0, true)).not.toThrow();
  });
});
