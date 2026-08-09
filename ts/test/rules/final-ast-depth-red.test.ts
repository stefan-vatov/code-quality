import { describe, expect, it } from 'vitest';
import type { NativeSourceCode } from '../../src/rules/effect-native-references';
import { effectGlobalFetchAST } from '../../src/rules/effect-global-fetch-ast';

type SyntheticNode = {
  [key: string]: unknown;
  type: string;
};

const DEEP_DEPTHS = [2_048, 10_000];
const CYCLIC_NODE_COUNT = 10_000;
const GLOBAL_FETCH_SOURCE = 'import { Effect } from "effect"; Effect.promise(() => fetch())';

const makeNode = (type: string, properties: Record<string, unknown> = {}): SyntheticNode => ({
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
