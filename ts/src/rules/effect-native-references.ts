/* -------------------------------------------------------------------------- */
/*           Oxlint-native reference identity for Effect AST rules.           */
/* -------------------------------------------------------------------------- */

import type { Context } from './effect-rule-core';
import { Predicate } from 'effect';
import type {
  NativeDefinition,
  NativeReference,
  NativeScope,
  NativeSourceCode,
} from './effect-native-types';

export type {
  NativeDefinition,
  NativeImportNode,
  NativeReference,
  NativeResolvedReference,
  NativeScope,
  NativeScopeManager,
  NativeSourceCode,
} from './effect-native-types';

const nativeReferenceIndexes = new WeakMap<NativeSourceCode, WeakMap<object, NativeReference>>();

const nativeScopeManagerFor = (sourceCode: NativeSourceCode): NativeSourceCode['scopeManager'] => {
  try {
    const scopeManager = sourceCode.scopeManager;
    return Predicate.isRecord(scopeManager) && Array.isArray(scopeManager.scopes)
      ? scopeManager
      : undefined;
  } catch {
    return undefined;
  }
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
  const sourceCode = context.sourceCode;
  if (!Predicate.isRecord(sourceCode)) {
    return undefined;
  }
  try {
    if (!Predicate.isFunction(sourceCode.isGlobalReference)) {
      return undefined;
    }
    return nativeScopeManagerFor(sourceCode) === undefined ? undefined : sourceCode;
  } catch {
    return undefined;
  }
};

const addReference = (
  references: WeakMap<object, NativeReference>,
  reference: NativeReference | undefined,
): void => {
  const identifier = reference?.identifier;
  if (Predicate.isRecord(identifier) && reference !== undefined) {
    references.set(identifier, reference);
  }
};

const isNativeReference = (value: unknown): value is NativeReference => Predicate.isRecord(value);

const addReferences = (
  references: WeakMap<object, NativeReference>,
  values: readonly NativeReference[] | undefined,
): void => {
  if (!Array.isArray(values)) {
    return;
  }
  for (const value of values) {
    if (isNativeReference(value)) {
      addReference(references, value);
    }
  }
};

const scopesFor = (sourceCode: NativeSourceCode): readonly NativeScope[] | undefined =>
  nativeScopeManagerFor(sourceCode)?.scopes;

const referenceValuesFor = (
  scope: NativeScope | undefined,
): readonly NativeReference[] | undefined => scope?.references;

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
  for (const scope of scopes) {
    addReferences(references, referenceValuesFor(scope));
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
  node: import('./effect-ast').ASTNode | undefined,
  references: WeakMap<object, NativeReference> | undefined,
): readonly NativeDefinition[] | undefined => {
  if (node === undefined || references === undefined) {
    return undefined;
  }
  return references.get(node)?.resolved?.defs;
};

const hasImportDefinition = (definitions: readonly NativeDefinition[] | undefined): boolean => {
  if (!Array.isArray(definitions)) {
    return false;
  }
  return definitions.some(
    (definition) => Predicate.isRecord(definition) && definition.type === 'ImportBinding',
  );
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
  node: import('./effect-ast').ASTNode | undefined,
  references: WeakMap<object, NativeReference> | undefined,
): boolean => {
  const definitions = definitionsFor(node, references);
  return hasImportDefinition(definitions);
};
