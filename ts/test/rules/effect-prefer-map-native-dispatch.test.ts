import { describe, expect, it } from 'vitest';
import preferMapOverFlatMapSucceedRule from '../../src/rules/effect-prefer-map-over-flatmap-succeed';

type SyntheticNode = {
  [key: string]: unknown;
  type: string;
};

interface NativeReference {
  identifier: object;
  resolved: {
    defs: readonly { type: string }[];
  };
}

const identifier = (name: string): SyntheticNode => ({ name, type: 'Identifier' });

const effectFunctionImport = (): SyntheticNode => ({
  source: { type: 'Literal', value: 'effect/Effect' },
  specifiers: [
    {
      imported: identifier('flatMap'),
      local: identifier('chain'),
      type: 'ImportSpecifier',
    },
    {
      imported: identifier('succeed'),
      local: identifier('done'),
      type: 'ImportSpecifier',
    },
  ],
  type: 'ImportDeclaration',
});

const preferMapCandidate = (
  flatMapReference: SyntheticNode,
  succeedReference: SyntheticNode,
): SyntheticNode => ({
  arguments: [
    identifier('program'),
    {
      async: false,
      body: {
        arguments: [identifier('value')],
        callee: succeedReference,
        type: 'CallExpression',
      },
      generator: false,
      params: [identifier('value')],
      type: 'ArrowFunctionExpression',
    },
  ],
  callee: flatMapReference,
  type: 'CallExpression',
});

const nativeReference = (node: object, definitionType: string): NativeReference => ({
  identifier: node,
  resolved: { defs: [{ type: definitionType }] },
});

const nativeContext = (
  source: string,
  references: readonly NativeReference[],
  report: (descriptor: object) => void,
) => ({
  report,
  sourceCode: {
    isGlobalReference(): boolean {
      return false;
    },
    scopeManager: {
      scopes: [{ references }],
    },
    text: source,
    visitorKeys: {
      ArrowFunctionExpression: ['body'],
      CallExpression: ['callee', 'arguments'],
      Program: ['body'],
    },
  },
});

describe('effect-prefer-map-over-flatMap-succeed native dispatch', (): void => {
  it('initializes imports at Program and checks candidates through CallExpression dispatch', (): void => {
    const flatMapReference = identifier('chain');
    const succeedReference = identifier('done');
    const candidate = preferMapCandidate(flatMapReference, succeedReference);
    const reports: object[] = [];
    const visitors = preferMapOverFlatMapSucceedRule.create(
      nativeContext(
        'import { flatMap as chain, succeed as done } from "effect/Effect"; chain(program, value => done(value));',
        [
          nativeReference(flatMapReference, 'ImportBinding'),
          nativeReference(succeedReference, 'ImportBinding'),
        ],
        (descriptor): void => {
          reports.push(descriptor);
        },
      ),
    );

    expect(visitors.Program).toBeTypeOf('function');
    expect(visitors.CallExpression).toBeTypeOf('function');

    visitors.Program({ body: [effectFunctionImport()], type: 'Program' });
    visitors.CallExpression?.(candidate);

    expect(reports).toHaveLength(1);
  });

  it('distinguishes imported aliases from same-spelled shadow bindings by reference identity', (): void => {
    const importedFlatMap = identifier('chain');
    const importedSucceed = identifier('done');
    const shadowedFlatMap = identifier('chain');
    const shadowedSucceed = identifier('done');
    const references = [
      nativeReference(importedFlatMap, 'ImportBinding'),
      nativeReference(importedSucceed, 'ImportBinding'),
      nativeReference(shadowedFlatMap, 'Variable'),
      nativeReference(shadowedSucceed, 'Variable'),
    ];
    const reports: object[] = [];
    const visitors = preferMapOverFlatMapSucceedRule.create(
      nativeContext(
        'import { flatMap as chain, succeed as done } from "effect/Effect"; chain(program, value => done(value));',
        references,
        (descriptor): void => {
          reports.push(descriptor);
        },
      ),
    );

    visitors.Program({ body: [effectFunctionImport()], type: 'Program' });
    visitors.CallExpression?.(preferMapCandidate(importedFlatMap, importedSucceed));
    visitors.CallExpression?.(preferMapCandidate(shadowedFlatMap, shadowedSucceed));

    expect(reports).toHaveLength(1);
  });

  it('source-gates native candidate-free files without manually traversing Program subtrees', (): void => {
    const visitors = preferMapOverFlatMapSucceedRule.create(
      nativeContext(
        'import { flatMap as chain, succeed as done } from "effect/Effect"; const value = 1;',
        [],
        (): void => {
          throw new Error('candidate-free source must not report');
        },
      ),
    );
    const program = {
      body: [effectFunctionImport()],
      get unrelated(): never {
        throw new Error('native Program initialization must not traverse unrelated subtrees');
      },
      type: 'Program',
    };

    expect(visitors.CallExpression).toBeUndefined();
    expect(() => visitors.Program(program)).not.toThrow();
  });
});
