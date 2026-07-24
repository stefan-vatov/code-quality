import { describe, expect, it } from 'vitest';
import type { Context } from '../../src/rules/effect-rule-core';
import { effectSyncForPromiseAST } from '../../src/rules/effect-default-boundary-ast';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const performanceGateSource = (): string =>
  readFileSync(fileURLToPath(new URL('../../bench/performance-gate.ts', import.meta.url)), 'utf8');

describe('Effect native performance contracts', (): void => {
  it('does not perform fallback hoist traversal for native Promise candidates', (): void => {
    const effectIdentifier = { name: 'Effect', type: 'Identifier' };
    const promiseIdentifier = { name: 'Promise', type: 'Identifier' };
    const promiseCall = new Proxy(
      {
        arguments: [{ type: 'Literal', value: 1 }],
        callee: {
          computed: false,
          object: promiseIdentifier,
          property: { name: 'resolve', type: 'Identifier' },
          type: 'MemberExpression',
        },
        type: 'CallExpression',
      },
      {
        ownKeys(): never {
          throw new Error('native Promise analysis entered fallback hoist traversal');
        },
      },
    );
    const syncCall = {
      arguments: [
        {
          async: false,
          body: promiseCall,
          generator: false,
          params: [],
          type: 'ArrowFunctionExpression',
        },
      ],
      callee: {
        computed: false,
        object: effectIdentifier,
        property: { name: 'sync', type: 'Identifier' },
        type: 'MemberExpression',
      },
      type: 'CallExpression',
    };
    const reports: object[] = [];
    const sourceCode = {
      isGlobalReference(node: object): boolean {
        return node === promiseIdentifier;
      },
      scopeManager: {
        scopes: [
          {
            references: [
              {
                identifier: effectIdentifier,
                resolved: { defs: [{ type: 'ImportBinding' }] },
              },
            ],
          },
        ],
      },
      text: 'import { Effect } from "effect"; Effect.sync(() => Promise.resolve(1));',
      visitorKeys: {
        CallExpression: ['callee', 'arguments'],
        Identifier: [],
        Literal: [],
        MemberExpression: ['object', 'property'],
      },
    };
    const context: Context = {
      report(descriptor): void {
        reports.push(descriptor);
      },
      sourceCode,
    };
    const visitors = effectSyncForPromiseAST(context, sourceCode.text);

    visitors.Program?.({ body: [], type: 'Program' });

    expect((): void => visitors.CallExpression?.(syncCall)).not.toThrow();
    expect(reports).toHaveLength(1);
  });

  it('provides native scope and traversal services to rule benchmarks', (): void => {
    const source = performanceGateSource();

    expect(source).toContain('isGlobalReference');
    expect(source).toContain('scopeManager');
    expect(source).toContain('visitorKeys');
    expect(source).not.toContain('sourceCode: { text: fixture.source },');
  });

  it('provides native comment services to rule benchmarks', (): void => {
    expect(performanceGateSource()).toContain('getAllComments');
  });

  it('benchmarks Promise and flatMap-succeed candidate paths', (): void => {
    const source = performanceGateSource();

    expect(source).toContain('Effect.sync(() => Promise.resolve');
    expect(source).toMatch(/Effect\.flatMap[\s\S]{0,400}Effect\.succeed/);
  });
});
