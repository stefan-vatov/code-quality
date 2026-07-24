import type { NativeReference, NativeSourceCode } from '../../src/rules/effect-native-references';
import { describe, expect, it } from 'vitest';
import {
  indexNativeReferences,
  isImportReference,
  nativeSourceCodeFor,
} from '../../src/rules/effect-native-references';
import type { Context } from '../../src/rules/effect-rule-core';

const asContext = (sourceCode: unknown): Context =>
  ({ report: (): void => undefined, sourceCode }) as unknown as Context;

const asNativeSourceCode = (value: unknown): NativeSourceCode => value as NativeSourceCode;

const importReference = (identifier: object): NativeReference => ({
  identifier,
  resolved: { defs: [{ type: 'ImportBinding' }] },
});

class CountingReferenceMap extends WeakMap<object, NativeReference> {
  writes = 0;

  override set(key: object, value: NativeReference): this {
    this.writes += 1;
    return super.set(key, value);
  }
}

describe('nativeSourceCodeFor', (): void => {
  it('returns the exact native SourceCode object when required APIs exist', (): void => {
    const sourceCode = {
      isGlobalReference: (): boolean => true,
      scopeManager: { scopes: [] },
      visitorKeys: { Program: ['body'] },
    };

    expect(nativeSourceCodeFor(asContext(sourceCode))).toBe(sourceCode);
  });

  it('rejects a scope manager whose scopes collection is omitted', (): void => {
    const sourceCode = {
      isGlobalReference: (): boolean => false,
      scopeManager: {},
    };

    expect(nativeSourceCodeFor(asContext(sourceCode))).toBeUndefined();
  });

  it.each([
    ['missing SourceCode', undefined],
    ['null SourceCode', null],
    ['primitive SourceCode', 'source'],
    ['missing global-reference function', { scopeManager: {} }],
    ['non-callable global-reference member', { isGlobalReference: true, scopeManager: {} }],
    ['missing scope manager', { isGlobalReference: (): boolean => true }],
    ['null scope manager', { isGlobalReference: (): boolean => true, scopeManager: null }],
    ['array scope manager', { isGlobalReference: (): boolean => true, scopeManager: [] }],
    [
      'non-array scopes collection',
      { isGlobalReference: (): boolean => true, scopeManager: { scopes: 'invalid' } },
    ],
  ])('rejects %s', (_label, sourceCode): void => {
    expect(nativeSourceCodeFor(asContext(sourceCode))).toBeUndefined();
  });

  it('does not throw when a malformed SourceCode accessor throws', (): void => {
    const sourceCode = Object.defineProperty({}, 'isGlobalReference', {
      get(): never {
        throw new TypeError('malformed SourceCode');
      },
    });

    expect(() => nativeSourceCodeFor(asContext(sourceCode))).not.toThrow();
    expect(nativeSourceCodeFor(asContext(sourceCode))).toBeUndefined();
  });
});

describe('indexNativeReferences', (): void => {
  it('indexes references from every scope by identifier identity', (): void => {
    const firstIdentifier = {};
    const secondIdentifier = {};
    const firstReference = importReference(firstIdentifier);
    const secondReference: NativeReference = {
      identifier: secondIdentifier,
      resolved: { defs: [{ type: 'Variable' }] },
    };
    const references = new WeakMap<object, NativeReference>();

    indexNativeReferences(
      {
        scopeManager: {
          scopes: [{ references: [firstReference] }, { references: [secondReference] }],
        },
      },
      references,
    );

    expect(references.get(firstIdentifier)).toBe(firstReference);
    expect(references.get(secondIdentifier)).toBe(secondReference);
  });

  it('indexes each scope references collection once without traversing duplicate through entries', (): void => {
    const identifier = {};
    const reference = importReference(identifier);
    let throughReads = 0;
    const scope = Object.defineProperty({ references: [reference] }, 'through', {
      get(): readonly NativeReference[] {
        throughReads += 1;
        return [reference];
      },
    });
    const references = new CountingReferenceMap();

    indexNativeReferences({ scopeManager: { scopes: [scope] } }, references);

    expect(references.get(identifier)).toBe(reference);
    expect(references.writes).toBe(1);
    expect(throughReads).toBe(0);
  });

  it('does not treat a through-only unresolved entry as an indexed import reference', (): void => {
    const identifier = {};
    const references = new WeakMap<object, NativeReference>();

    indexNativeReferences(
      { scopeManager: { scopes: [{ references: [], through: [importReference(identifier)] }] } },
      references,
    );

    expect(references.has(identifier)).toBe(false);
    expect(isImportReference(identifier, references)).toBe(false);
  });

  it('ignores absent and non-array reference collections', (): void => {
    const references = new CountingReferenceMap();

    indexNativeReferences(
      asNativeSourceCode({
        scopeManager: {
          scopes: [{}, { references: null }, { references: {} }, { references: 'invalid' }],
        },
      }),
      references,
    );

    expect(references.writes).toBe(0);
  });

  it('ignores primitive and null entries in a references collection', (): void => {
    const identifier = {};
    const reference = importReference(identifier);
    const references = new CountingReferenceMap();

    indexNativeReferences(
      asNativeSourceCode({
        scopeManager: {
          scopes: [{ references: [null, 1, 'reference', reference] }],
        },
      }),
      references,
    );

    expect(references.get(identifier)).toBe(reference);
    expect(references.writes).toBe(1);
  });

  it('ignores malformed scope entries without throwing', (): void => {
    const references = new WeakMap<object, NativeReference>();
    const sourceCode = asNativeSourceCode({
      scopeManager: { scopes: [null, undefined, 1, 'scope'] },
    });

    expect(() => indexNativeReferences(sourceCode, references)).not.toThrow();
  });

  it('is a no-op when the scope manager or scopes collection is absent', (): void => {
    const references = new CountingReferenceMap();

    indexNativeReferences({}, references);
    indexNativeReferences({ scopeManager: {} }, references);

    expect(references.writes).toBe(0);
  });
});

describe('isImportReference', (): void => {
  it('recognizes an ImportBinding definition', (): void => {
    const identifier = {};
    const references = new WeakMap<object, NativeReference>([
      [identifier, importReference(identifier)],
    ]);

    expect(isImportReference(identifier, references)).toBe(true);
  });

  it('recognizes an import among multiple definition kinds', (): void => {
    const identifier = {};
    const references = new WeakMap<object, NativeReference>([
      [
        identifier,
        {
          identifier,
          resolved: {
            defs: [{ type: 'Variable' }, { type: 'ImportBinding' }, { type: 'FunctionName' }],
          },
        },
      ],
    ]);

    expect(isImportReference(identifier, references)).toBe(true);
  });

  it.each([
    ['undefined node', undefined, new WeakMap<object, NativeReference>()],
    ['undefined index', {}, undefined],
    ['absent reference', {}, new WeakMap<object, NativeReference>()],
  ])('rejects an %s', (_label, node, references): void => {
    expect(isImportReference(node, references)).toBe(false);
  });

  it.each([
    ['unresolved reference', { resolved: null }],
    ['missing resolved binding', {}],
    ['missing definitions', { resolved: {} }],
    ['empty definitions', { resolved: { defs: [] } }],
    ['non-import definition', { resolved: { defs: [{ type: 'Variable' }] } }],
    ['lookalike definition', { resolved: { defs: [{ type: 'Import' }] } }],
  ])('rejects a %s', (_label, reference): void => {
    const identifier = {};
    const references = new WeakMap<object, NativeReference>([
      [identifier, reference as NativeReference],
    ]);

    expect(isImportReference(identifier, references)).toBe(false);
  });

  it('uses identifier object identity instead of structural equality', (): void => {
    const indexedIdentifier = { name: 'Effect' };
    const lookalikeIdentifier = { name: 'Effect' };
    const references = new WeakMap<object, NativeReference>([
      [indexedIdentifier, importReference(indexedIdentifier)],
    ]);

    expect(isImportReference(indexedIdentifier, references)).toBe(true);
    expect(isImportReference(lookalikeIdentifier, references)).toBe(false);
  });

  it('ignores malformed definitions and still recognizes a later import definition', (): void => {
    const identifier = {};
    const reference = {
      identifier,
      resolved: {
        defs: [null, 'definition', {}, { type: 'ImportBinding' }],
      },
    } as unknown as NativeReference;
    const references = new WeakMap<object, NativeReference>([[identifier, reference]]);

    expect((): boolean => isImportReference(identifier, references)).not.toThrow();
    expect(isImportReference(identifier, references)).toBe(true);
  });

  it('rejects a malformed non-array definitions collection without throwing', (): void => {
    const identifier = {};
    const reference = {
      identifier,
      resolved: { defs: { type: 'ImportBinding' } },
    } as unknown as NativeReference;
    const references = new WeakMap<object, NativeReference>([[identifier, reference]]);

    expect((): boolean => isImportReference(identifier, references)).not.toThrow();
    expect(isImportReference(identifier, references)).toBe(false);
  });
});
