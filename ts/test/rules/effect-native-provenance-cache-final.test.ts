import {
  type NativeReference,
  type NativeSourceCode,
  nativeSourceCodeFor,
} from '../../src/rules/effect-native-references';
import { describe, expect, it } from 'vitest';
import type { Context } from '../../src/rules/effect-rule-core';
import { importedEffectCallMatcher } from '../../src/rules/effect-imported-call-matcher';
import { runRule } from './effect-rule-test-utils';

const domainFile = 'src/domain/native-provenance.ts';

const collectingContext = (sourceCode: NativeSourceCode, reports: object[]): Context => ({
  report(descriptor): void {
    reports.push(descriptor);
  },
  sourceCode,
});

describe('source-backed Effect alias provenance', (): void => {
  it.each([
    [
      'parameter binding',
      `
        import { Effect as Fx } from "effect";
        const local = (Fx: LocalEffect) => Fx.fromPromise(() => task);
      `,
    ],
    [
      'block binding',
      `
        import { Effect as Fx } from "effect";
        {
          const Fx = LocalEffect;
          const local = Fx.fromPromise(() => task);
        }
      `,
    ],
    [
      'function-local binding',
      `
        import { Effect as Fx } from "effect";
        function local() {
          const Fx = LocalEffect;
          return Fx.fromPromise(() => task);
        }
      `,
    ],
  ])('rejects an imported alias spelling shadowed by a %s', (_label, source): void => {
    expect(runRule('effect-no-known-fake-api', source, domainFile)).toHaveLength(0);
  });

  it('still reports the genuine imported alias reference', (): void => {
    const source = `
      import { Effect as Fx } from "effect";
      const invalid = Fx.fromPromise(() => task);
    `;

    expect(runRule('effect-no-known-fake-api', source, domainFile)).toHaveLength(1);
  });
});

describe('globalThis.fetch provenance inside Effect async wrappers', (): void => {
  it.each(['promise', 'tryPromise'])(
    'reports globalThis.fetch inside Effect.%s',
    (wrapper): void => {
      const source = `
        import { Effect } from "effect";
        const request = Effect.${wrapper}(() => globalThis.fetch("/users"));
      `;

      expect(runRule('effect-no-global-fetch', source, domainFile)).toHaveLength(1);
    },
  );

  it.each([
    [
      'a callback parameter',
      `
        import { Effect } from "effect";
        const request = (globalThis: HTTPClient) =>
          Effect.tryPromise(() => globalThis.fetch("/users"));
      `,
    ],
    [
      'a function-local binding',
      `
        import { Effect } from "effect";
        function request() {
          const globalThis = client;
          return Effect.promise(() => globalThis.fetch("/users"));
        }
      `,
    ],
    [
      'an unrelated local receiver',
      `
        import { Effect } from "effect";
        const request = Effect.promise(() => client.fetch("/users"));
      `,
    ],
  ])('allows globalThis-like fetch resolved through %s', (_label, source): void => {
    expect(runRule('effect-no-global-fetch', source, domainFile)).toHaveLength(0);
  });
});

describe('native SourceCode capability boundaries', (): void => {
  it('rejects a scope manager without an array scopes collection', (): void => {
    const sourceCode = {
      isGlobalReference: (): boolean => false,
      scopeManager: {},
    };

    expect(nativeSourceCodeFor(collectingContext(sourceCode, []))).toBeUndefined();
  });
});

describe('native reference-index demand and sharing', (): void => {
  it('indexes one SourceCode reference collection once across native matchers', (): void => {
    const importLocal = { name: 'ok', type: 'Identifier' };
    const importedName = { name: 'succeed', type: 'Identifier' };
    const importedReference = { name: 'ok', type: 'Identifier' };
    const reference: NativeReference = {
      identifier: importedReference,
      resolved: { defs: [{ type: 'ImportBinding' }] },
    };
    let collectionReads = 0;
    let referenceReads = 0;
    const references = [reference];
    Object.defineProperty(references, '0', {
      get(): NativeReference {
        referenceReads += 1;
        return reference;
      },
    });
    const scope = Object.defineProperty({}, 'references', {
      get(): readonly NativeReference[] {
        collectionReads += 1;
        return references;
      },
    });
    const sourceCode = {
      isGlobalReference: (): boolean => false,
      scopeManager: { scopes: [scope] },
    };
    const context = collectingContext(sourceCode, []);
    const firstMatcher = importedEffectCallMatcher(context, 'Effect', ['succeed']);
    const secondMatcher = importedEffectCallMatcher(context, 'Effect', ['succeed']);
    const program = {
      body: [
        {
          importKind: 'value',
          source: { type: 'Literal', value: 'effect/Effect' },
          specifiers: [
            {
              importKind: 'value',
              imported: importedName,
              local: importLocal,
              type: 'ImportSpecifier',
            },
          ],
          type: 'ImportDeclaration',
        },
      ],
      type: 'Program',
    };

    firstMatcher.initialize(program);
    secondMatcher.initialize(program);

    expect(firstMatcher.matches(importedReference)).toBe(true);
    expect(secondMatcher.matches(importedReference)).toBe(true);
    expect(collectionReads).toBe(1);
    expect(referenceReads).toBe(1);
  });
});
