/* -------------------------------------------------------------------------- */
/*           Oxlint-native reference identity for Effect AST rules.           */
/* -------------------------------------------------------------------------- */

import type { Context } from './effect-rule-core';

/**
 * The subset of an Oxlint scope reference needed by custom Effect rules.
 *
 * @internal
 */
export interface NativeReference {
  identifier?: object;
  resolved?: {
    defs?: readonly { type?: string }[];
  } | null;
}

/**
 * The allocation-free SourceCode capabilities used by custom Effect rules.
 *
 * @internal
 */
export interface NativeSourceCode {
  isGlobalReference?: (node: object) => boolean;
  scopeManager?: {
    scopes?: readonly object[];
  };
  visitorKeys?: Readonly<Record<string, readonly string[]>>;
}

const unreadableProperty = Symbol('unreadableProperty');

const readProperty = (value: object, key: string): unknown => {
  try {
    return Reflect.get(value, key);
  } catch {
    return unreadableProperty;
  }
};

const isRecord = (value: unknown): value is object =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const isWeakKey = (value: unknown): value is object =>
  (value !== null && typeof value === 'object') || typeof value === 'function';

const isUnknownArray = (value: unknown): value is readonly unknown[] => Array.isArray(value);
const nativeReferenceIndexes = new WeakMap<NativeSourceCode, WeakMap<object, NativeReference>>();

const asArray = (value: unknown): readonly unknown[] | undefined => {
  if (isUnknownArray(value)) {
    return value;
  }
  return undefined;
};

const nativeScopeManagerFor = (sourceCode: object): object | undefined => {
  const scopeManager = readProperty(sourceCode, 'scopeManager');
  if (!isRecord(scopeManager)) {
    return undefined;
  }
  const scopes = readProperty(scopeManager, 'scopes');
  if (!isUnknownArray(scopes)) {
    return undefined;
  }
  return scopeManager;
};

/**
 * Narrow a lint context to an Oxlint-native SourceCode implementation.
 *
 * @param context - The current lint context.
 * @returns Native SourceCode when scope and global-reference APIs are available.
 * @throws Does not throw.
 * @internal
 */
export const nativeSourceCodeFor = (context: Context): NativeSourceCode | undefined => {
  const sourceCode = readProperty(context, 'sourceCode');
  if (!isRecord(sourceCode)) {
    return undefined;
  }
  const isGlobalReference = readProperty(sourceCode, 'isGlobalReference');
  if (typeof isGlobalReference !== 'function' || !nativeScopeManagerFor(sourceCode)) {
    return undefined;
  }
  return sourceCode as NativeSourceCode;
};

const addReference = (references: WeakMap<object, NativeReference>, value: unknown): void => {
  if (isRecord(value)) {
    const reference = value as NativeReference;
    const identifier = readProperty(reference, 'identifier');
    if (isWeakKey(identifier)) {
      references.set(identifier, reference);
    }
  }
};

const addReferences = (references: WeakMap<object, NativeReference>, values: unknown): void => {
  if (!isUnknownArray(values)) {
    return;
  }
  const valueCount = values.length;
  for (let valueIndex = 0; valueIndex < valueCount; valueIndex += 1) {
    addReference(references, values[valueIndex]);
  }
};

const scopesFor = (sourceCode: NativeSourceCode): readonly unknown[] | undefined => {
  const scopeManager = readProperty(sourceCode, 'scopeManager');
  if (!isRecord(scopeManager)) {
    return undefined;
  }
  const scopes = readProperty(scopeManager, 'scopes');
  return asArray(scopes);
};

const referenceValuesFor = (scope: unknown): unknown => {
  if (isRecord(scope)) {
    return readProperty(scope, 'references');
  }
  return undefined;
};

/**
 * Index Oxlint reference nodes by object identity for constant-time lookup.
 *
 * @param sourceCode - The native SourceCode instance.
 * @param references - The per-file reference index to populate.
 * @throws Does not throw.
 * @internal
 */
export const indexNativeReferences = (
  sourceCode: NativeSourceCode,
  references: WeakMap<object, NativeReference>,
): void => {
  const scopes = scopesFor(sourceCode);
  if (!scopes) {
    return;
  }
  const scopeCount = scopes.length;
  for (let scopeIndex = 0; scopeIndex < scopeCount; scopeIndex += 1) {
    addReferences(references, referenceValuesFor(scopes[scopeIndex]));
  }
};

/**
 * Return the shared reference-identity index for one native SourceCode object. The first caller pays
 * the scope walk. Every matcher created for the same file then reuses the exact WeakMap without
 * retaining either identifier nodes or SourceCode objects after the host releases them.
 *
 * @param sourceCode - The native SourceCode instance.
 * @returns The lazily created per-file reference index.
 * @throws Does not throw.
 * @internal
 */
export const nativeReferenceIndexFor = (
  sourceCode: NativeSourceCode,
): WeakMap<object, NativeReference> => {
  const cached = nativeReferenceIndexes.get(sourceCode);
  if (cached) {
    return cached;
  }
  const references = new WeakMap<object, NativeReference>();
  nativeReferenceIndexes.set(sourceCode, references);
  indexNativeReferences(sourceCode, references);
  return references;
};

const definitionsFor = (
  node: object | undefined,
  references: WeakMap<object, NativeReference> | undefined,
): readonly unknown[] | undefined => {
  if (!node || !references) {
    return undefined;
  }
  const reference = references.get(node);
  if (!isRecord(reference)) {
    return undefined;
  }
  const resolved = readProperty(reference, 'resolved');
  if (!isRecord(resolved)) {
    return undefined;
  }
  const definitions = readProperty(resolved, 'defs');
  return asArray(definitions);
};

const hasImportDefinition = (definitions: readonly unknown[]): boolean => {
  const definitionCount = definitions.length;
  for (let definitionIndex = 0; definitionIndex < definitionCount; definitionIndex += 1) {
    const definition: unknown = definitions[definitionIndex];
    if (isRecord(definition) && readProperty(definition, 'type') === 'ImportBinding') {
      return true;
    }
  }
  return false;
};

/**
 * Determine whether an identifier resolves to an imported value binding.
 *
 * @param node - The identifier reference node.
 * @param references - The per-file native reference index.
 * @returns `true` only for references resolved to an import definition.
 * @throws Does not throw.
 * @internal
 */
export const isImportReference = (
  node: object | undefined,
  references: WeakMap<object, NativeReference> | undefined,
): boolean => {
  const definitions = definitionsFor(node, references);
  if (definitions) {
    return hasImportDefinition(definitions);
  }
  return false;
};
