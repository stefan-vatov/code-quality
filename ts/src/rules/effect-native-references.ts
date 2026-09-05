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

export const isImportReference = (
  node: import('./effect-ast').ASTNode | undefined,
  references: WeakMap<object, NativeReference> | undefined,
): boolean => {
  const definitions = definitionsFor(node, references);
  return hasImportDefinition(definitions);
};
