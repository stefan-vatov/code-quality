/* -------------------------------------------------------------------------- */
/*            Effect.runSync import identity for source fallback.             */
/* -------------------------------------------------------------------------- */
import type { RunSyncBindings } from './effect-strict-server-handler-types';
import { stripComments } from './effect-source-comments';

const EFFECT_API_NAME = 'Effect';
const RUN_SYNC_NAME = 'runSync';
const MODULE_NAME_CAPTURE_INDEX = 4;
const STATIC_IMPORT_PATTERN = /\bimport\b(?!\s*\()(?:[\s\S]*?)\bfrom\s*(["'])([^"']+)\1/g;
const SIDE_EFFECT_IMPORT_PATTERN = /\bimport\s*(["'])([^"']+)\1/g;
const NAMESPACE_IMPORT_PATTERN =
  /\bimport\s+(type\s+)?\*\s+as\s+([A-Za-z_$][\w$]*)\s+from\s*(["'])([^"']+)\3/g;
const NAMED_IMPORT_PATTERN = /\bimport\s+(type\s+)?\{([^{}]*)\}\s+from\s*(["'])([^"']+)\3/g;
const NAMED_SPECIFIER_PATTERN =
  /(?:^|,)\s*(?:type\s+)?([A-Za-z_$][\w$]*)\s*(?:as\s+([A-Za-z_$][\w$]*))?/g;

interface MutableRunSyncBindings {
  direct: Set<string>;
  hasEffectImport: boolean;
  namespace: Set<string>;
  root: Set<string>;
}

const isEffectModule = (moduleName: string): boolean =>
  moduleName === 'effect' || moduleName.startsWith('effect/') || moduleName.startsWith('@effect/');

const isCodeAt = (code: string, index: number): boolean =>
  index >= 0 && index < code.length && code[index]?.trim() !== '';

const createBindings = (): MutableRunSyncBindings => ({
  direct: new Set(),
  hasEffectImport: false,
  namespace: new Set(),
  root: new Set(),
});

const noteEffectImport = (bindings: MutableRunSyncBindings): void => {
  const mutableBindings = bindings;
  mutableBindings.hasEffectImport = true;
};

const noteEffectModule = (
  bindings: MutableRunSyncBindings,
  code: string,
  index: number,
  moduleName: string | undefined,
): void => {
  if (isCodeAt(code, index) && moduleName && isEffectModule(moduleName)) {
    noteEffectImport(bindings);
  }
};

const collectImportPattern = (
  bindings: MutableRunSyncBindings,
  code: string,
  source: string,
  pattern: RegExp,
): void => {
  const importPattern = pattern;
  importPattern.lastIndex = 0;
  let match = importPattern.exec(source);
  while (match !== null) {
    noteEffectModule(bindings, code, match.index, match.at(2));
    match = importPattern.exec(source);
  }
};

const collectStaticImportPresence = (
  bindings: MutableRunSyncBindings,
  code: string,
  commentFreeSource: string,
): void => {
  collectImportPattern(bindings, code, commentFreeSource, STATIC_IMPORT_PATTERN);
  collectImportPattern(bindings, code, commentFreeSource, SIDE_EFFECT_IMPORT_PATTERN);
};

const addNamespaceBinding = (
  bindings: MutableRunSyncBindings,
  localName: string,
  moduleName: string,
): void => {
  if (moduleName === 'effect') {
    bindings.namespace.add(localName);
    bindings.root.add(localName);
  } else if (moduleName === 'effect/Effect') {
    bindings.namespace.add(localName);
  }
};

const addNamedBinding = (
  bindings: MutableRunSyncBindings,
  importedName: string,
  localName: string,
  moduleName: string,
): void => {
  if (moduleName === 'effect' && importedName === EFFECT_API_NAME) {
    bindings.root.add(localName);
  } else if (moduleName === 'effect/Effect' && importedName === RUN_SYNC_NAME) {
    bindings.direct.add(localName);
  }
};

const collectNamespaceImports = (
  bindings: MutableRunSyncBindings,
  code: string,
  commentFreeSource: string,
): void => {
  NAMESPACE_IMPORT_PATTERN.lastIndex = 0;
  let match = NAMESPACE_IMPORT_PATTERN.exec(commentFreeSource);
  while (match !== null) {
    const importKind = match.at(1);
    const localName = match.at(2);
    const moduleName = match.at(MODULE_NAME_CAPTURE_INDEX);
    if (
      !importKind &&
      localName &&
      moduleName &&
      isCodeAt(code, match.index) &&
      isEffectModule(moduleName)
    ) {
      addNamespaceBinding(bindings, localName, moduleName);
    }
    match = NAMESPACE_IMPORT_PATTERN.exec(commentFreeSource);
  }
};

const collectNamedSpecifiers = (
  bindings: MutableRunSyncBindings,
  specifiers: string,
  moduleName: string,
): void => {
  NAMED_SPECIFIER_PATTERN.lastIndex = 0;
  let match = NAMED_SPECIFIER_PATTERN.exec(specifiers);
  while (match !== null) {
    const importedName = match.at(1);
    const localName = match.at(2);
    if (importedName) {
      addNamedBinding(bindings, importedName, localName ?? importedName, moduleName);
    }
    match = NAMED_SPECIFIER_PATTERN.exec(specifiers);
  }
};

const collectNamedImports = (
  bindings: MutableRunSyncBindings,
  code: string,
  commentFreeSource: string,
): void => {
  NAMED_IMPORT_PATTERN.lastIndex = 0;
  let match = NAMED_IMPORT_PATTERN.exec(commentFreeSource);
  while (match !== null) {
    const importKind = match.at(1);
    const specifiers = match.at(2);
    const moduleName = match.at(MODULE_NAME_CAPTURE_INDEX);
    if (
      !importKind &&
      specifiers &&
      moduleName &&
      isCodeAt(code, match.index) &&
      isEffectModule(moduleName)
    ) {
      collectNamedSpecifiers(bindings, specifiers, moduleName);
    }
    match = NAMED_IMPORT_PATTERN.exec(commentFreeSource);
  }
};

/**
 * Collects source-level import identities for Effect.runSync.
 *
 * @param source - Complete source text.
 * @returns Effect import bindings recognized by the native matcher.
 * @throws Does not throw.
 * @internal
 */
export const collectRunSyncBindings = (source: string): RunSyncBindings => {
  const code = stripComments(source);
  const bindings = createBindings();
  collectStaticImportPresence(bindings, code, source);
  collectNamespaceImports(bindings, code, source);
  collectNamedImports(bindings, code, source);
  if (!bindings.hasEffectImport) {
    bindings.root.add(EFFECT_API_NAME);
  }
  return bindings;
};
