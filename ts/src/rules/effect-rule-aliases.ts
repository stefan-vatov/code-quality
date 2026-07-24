/* -------------------------------------------------------------------------- */
/*  Effect import, alias, and runtime-call helpers for source-backed rules.   */
/* -------------------------------------------------------------------------- */
import { Array, HashSet, Option, pipe } from 'effect';
import { stripComments, stripCommentsAndStrings } from './effect-source-helpers';
import type { CanonicalizedEffectSource } from './effect-alias-canonicalization';
import { buildCanonicalizedEffectSource } from './effect-alias-canonicalization';

/**
 * Matches supported Effect runtime execution calls.
 *
 * @internal
 */
export const runtimeCallPattern =
  /\b(?:Effect\.(?:runPromise|runPromiseExit|runSync|runSyncExit|runFork)|[A-Za-z_$][\w$]*Runtime\.runMain)\s*\(/;
const boundaryFilePattern = /(?:^|\/)src\/(?:main|server|cli)\.ts$|\.entry\.ts$/;
const testFilePattern = /\.(?:test|spec)\.tsx?$/;
const ALIAS_CACHE_MAX = 256;
const BOOLEAN_CACHE_MAX = 512;
const effectAliasCache = new Map<string, string[]>();
const runtimeFunctionAliasCache = new Map<string, string[]>();
const canonicalSourceCache = new Map<string, CanonicalizedEffectSource>();
const effectSignalCache = new Map<string, boolean>();
const runtimeCallCache = new Map<string, boolean>();

const cachedAliases = (cache: Map<string, string[]>, source: string): string[] | undefined =>
  pipe(Option.fromNullable(cache.get(source)), Option.getOrUndefined);

const cacheAliases = (cache: Map<string, string[]>, source: string, value: string[]): string[] => {
  if (cache.size >= ALIAS_CACHE_MAX) {
    pipe(
      Option.fromNullable(cache.keys().next().value),
      Option.map((firstKey): boolean => cache.delete(firstKey)),
    );
  }
  cache.set(source, value);
  return value;
};

const cachedBoolean = (cache: Map<string, boolean>, source: string): boolean | undefined =>
  pipe(Option.fromNullable(cache.get(source)), Option.getOrUndefined);

const cacheBoolean = (cache: Map<string, boolean>, source: string, value: boolean): boolean => {
  if (cache.size >= BOOLEAN_CACHE_MAX) {
    pipe(
      Option.fromNullable(cache.keys().next().value),
      Option.map((firstKey): boolean => cache.delete(firstKey)),
    );
  }
  cache.set(source, value);
  return value;
};

const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);

const exactIdentifierPattern = (identifier: string, suffix: string, flags = ''): RegExp =>
  new RegExp(`(?:^|[^\\w$])${escapeRegExp(identifier)}${suffix}`, flags);

const hasLocalEffectBinding = (source: string): boolean =>
  /\b(?:const|let|var|function|class|namespace)\s+Effect\b/.test(stripCommentsAndStrings(source));

const importSpecifierNames = (
  specifier: string,
): { importedName: string; localName: string } | undefined => {
  const trimmed = specifier.trim();
  return pipe(
    Option.some(trimmed),
    Option.filter((value): boolean => !value.startsWith('type ')),
    Option.flatMap((value) => {
      const parts = value.split(/\s+as\s+/);
      const importedName = parts[0]?.trim();
      const localName = parts[1]?.trim() ?? importedName;
      if (importedName && localName) {
        return Option.some({ importedName, localName });
      }
      return Option.none<{ importedName: string; localName: string }>();
    }),
    Option.getOrUndefined,
  );
};

const namedEffectImportLists = (source: string, modulePath = 'effect'): string[] => {
  const escapedModule = escapeRegExp(modulePath);
  return [
    ...source.matchAll(
      new RegExp(
        `(?:^|\\n)\\s*import\\s+(?!type\\b)\\s*{([^}]+)}\\s*from\\s*['"]${escapedModule}['"]`,
        'g',
      ),
    ),
  ].map((match): string =>
    pipe(
      Option.fromNullable(match[1]),
      Option.getOrElse((): string => ''),
    ),
  );
};

const addMatchingNamedImports = (
  aliases: Set<string>,
  importList: string,
  predicate: (names: { importedName: string; localName: string }) => boolean,
): void => {
  pipe(
    importList.split(','),
    Array.filterMap((specifier) => Option.fromNullable(importSpecifierNames(specifier))),
    Array.filter(predicate),
    Array.map((names): Set<string> => aliases.add(names.localName)),
  );
};

const effectNamespaceImportPattern = (APIName: string): RegExp =>
  new RegExp(
    `(?:^|\\n)\\s*import\\s+(?!type\\b)\\*\\s+as\\s+([A-Za-z_$][\\w$]*)\\s+from\\s*['"]effect/${escapeRegExp(APIName)}['"]`,
    'g',
  );

const addRootEffectAliases = (aliases: Set<string>, source: string): void => {
  pipe(
    namedEffectImportLists(source),
    Array.map((importList): Set<string> => {
      addMatchingNamedImports(
        aliases,
        importList,
        (names): boolean => names.importedName === 'Effect',
      );
      if (aliases.size > 0) {
        return aliases.add('Effect');
      }
      return aliases;
    }),
  );
};

const addNamespaceEffectAliases = (aliases: Set<string>, source: string): void => {
  pipe(
    Array.fromIterable(
      source.matchAll(
        /(?:^|\n)\s*import\s+(?!type\b)\*\s+as\s+([A-Za-z_$][\w$]*)\s+from\s*['"]effect(?:\/Effect)?['"]/g,
      ),
    ),
    Array.map((match): Set<string> => {
      aliases.add('Effect');
      return aliases.add(match[1]);
    }),
  );
};

const hasAnyEffectImport = (source: string): boolean =>
  /(?:^|\n)\s*import(?:\s+type)?(?:[\s\S]*?\s+from\s*)?['"](?:effect(?:\/[^'"]+)?|@effect\/[^'"]+)['"]/.test(
    stripComments(source),
  );

const hasEffectValueImport = (source: string): boolean => {
  const commentFreeSource = stripComments(source);
  const hasNamedEffectImport = pipe(
    Array.fromIterable(
      commentFreeSource.matchAll(
        /(?:^|\n)\s*import\s+(?!type\b)\s*{([^}]+)}\s*from\s*['"]effect['"]/g,
      ),
    ),
    Array.some((match): boolean =>
      pipe(
        (match[1] ?? '').split(','),
        Array.some(
          (specifier): boolean => importSpecifierNames(specifier)?.importedName === 'Effect',
        ),
      ),
    ),
  );

  return (
    hasNamedEffectImport ||
    /(?:^|\n)\s*import\s+(?!type\b)\*\s+as\s+[A-Za-z_$][\w$]*\s+from\s*['"]effect(?:\/Effect)?['"]/.test(
      commentFreeSource,
    ) ||
    effectFunctionAliases(source, 'Effect').length > 0
  );
};

/** Finds local identifiers bound to the Effect namespace. @internal */
export const effectImportAliases = (source: string): string[] => {
  const cachedValue = cachedAliases(effectAliasCache, source);
  if (cachedValue) {
    return cachedValue;
  }

  const aliases = new Set<string>();
  const commentFreeSource = stripComments(source);

  addRootEffectAliases(aliases, commentFreeSource);
  addNamespaceEffectAliases(aliases, commentFreeSource);

  if (aliases.size === 0 && !hasAnyEffectImport(source) && !hasLocalEffectBinding(source)) {
    aliases.add('Effect');
  }

  return cacheAliases(effectAliasCache, source, [...aliases]);
};

/** Finds local identifiers bound to a named Effect API module. @internal */
export const effectAPIAliases = (source: string, APIName: string): string[] => {
  const aliases = new Set<string>();
  const commentFreeSource = stripComments(source);

  pipe(
    namedEffectImportLists(commentFreeSource),
    Array.map((importList): void =>
      addMatchingNamedImports(
        aliases,
        importList,
        (names): boolean => names.importedName === APIName,
      ),
    ),
  );

  pipe(
    Array.fromIterable(commentFreeSource.matchAll(effectNamespaceImportPattern(APIName))),
    Array.map((match): Set<string> => aliases.add(match[1])),
  );

  if (aliases.size === 0 && !hasAnyEffectImport(source)) {
    aliases.add(APIName);
  }

  return [...aliases];
};

/** Finds local names for functions imported from an Effect API module. @internal */
export const effectFunctionAliases = (
  source: string,
  moduleName: string,
  functionName?: string,
): string[] => {
  const aliases = new Set<string>();
  const commentFreeSource = stripComments(source);

  pipe(
    namedEffectImportLists(commentFreeSource, `effect/${moduleName}`),
    Array.map((importList): void =>
      addMatchingNamedImports(
        aliases,
        importList,
        (names): boolean => !functionName || names.importedName === functionName,
      ),
    ),
  );

  return [...aliases];
};

const canonicalNames = HashSet.make(
  'Config',
  'Context',
  'Effect',
  'Fiber',
  'Layer',
  'Queue',
  'Schedule',
  'Schema',
  'Scope',
  'Stream',
  'TestClock',
);

const addCanonicalNamedImportAliases = (aliases: Map<string, string>, importList: string): void => {
  pipe(
    importList.split(','),
    Array.filterMap((specifier) => Option.fromNullable(importSpecifierNames(specifier))),
    Array.filter(
      (names): boolean =>
        HashSet.has(canonicalNames, names.importedName) && names.localName !== names.importedName,
    ),
    Array.map((names): Map<string, string> => aliases.set(names.localName, names.importedName)),
  );
};

const addCanonicalNamespaceAliases = (aliases: Map<string, string>, source: string): void => {
  pipe(
    Array.fromIterable(
      source.matchAll(
        /(?:^|\n)\s*import\s+(?!type\b)\*\s+as\s+([A-Za-z_$][\w$]*)\s+from\s*['"]effect\/([A-Za-z]+)['"]/g,
      ),
    ),
    Array.map((match): { localName: string; moduleName: string } => ({
      localName: match[1],
      moduleName: match[2],
    })),
    Array.filter(
      ({ localName, moduleName }): boolean =>
        HashSet.has(canonicalNames, moduleName) && localName !== moduleName,
    ),
    Array.map(
      ({ localName, moduleName }): Map<string, string> => aliases.set(localName, moduleName),
    ),
  );
};

const canonicalImportAliases = (source: string): Map<string, string> => {
  const aliases = new Map<string, string>();
  const commentFreeSource = stripComments(source);

  pipe(
    namedEffectImportLists(commentFreeSource),
    Array.map((importList): void => addCanonicalNamedImportAliases(aliases, importList)),
  );
  addCanonicalNamespaceAliases(aliases, commentFreeSource);

  return aliases;
};

const evictCanonicalSourceCache = (): void => {
  if (canonicalSourceCache.size < ALIAS_CACHE_MAX) {
    return;
  }
  pipe(
    Option.fromNullable(canonicalSourceCache.keys().next().value),
    Option.map((firstKey): boolean => canonicalSourceCache.delete(firstKey)),
  );
};

const buildCanonicalSource = (source: string): CanonicalizedEffectSource => {
  const aliases = canonicalImportAliases(source);
  if (aliases.size === 0) {
    return { indexMap: [], source };
  }

  const alternatives = pipe(
    Array.fromIterable(aliases.keys()),
    Array.map(escapeRegExp),
    Array.join('|'),
  );
  const pattern = new RegExp(`(^|[^\\w$])(${alternatives})(?=\\.)`, 'g');
  return buildCanonicalizedEffectSource(source, aliases, pattern);
};

/**
 * Canonicalizes Effect API aliases while retaining original positions.
 *
 * @internal
 */
export const canonicalizeEffectAPIAliasesWithMap = (source: string): CanonicalizedEffectSource =>
  pipe(
    Option.fromNullable(canonicalSourceCache.get(source)),
    Option.getOrElse((): CanonicalizedEffectSource => {
      const canonicalSource = buildCanonicalSource(source);
      evictCanonicalSourceCache();
      canonicalSourceCache.set(source, canonicalSource);
      return canonicalSource;
    }),
  );

/**
 * Canonicalizes local Effect API aliases to their imported names.
 *
 * @internal
 */
export const canonicalizeEffectAPIAliases = (source: string): string =>
  canonicalizeEffectAPIAliasesWithMap(source).source;

const runtimeNames = HashSet.make(
  'runFork',
  'runPromise',
  'runPromiseExit',
  'runSync',
  'runSyncExit',
);

const effectRuntimeFunctionAliases = (source: string): string[] => {
  const cachedValue = cachedAliases(runtimeFunctionAliasCache, source);
  if (cachedValue) {
    return cachedValue;
  }

  const aliases = new Set<string>();
  const commentFreeSource = stripComments(source);

  pipe(
    namedEffectImportLists(commentFreeSource, 'effect/Effect'),
    Array.map((importList): void =>
      addMatchingNamedImports(aliases, importList, (names) =>
        HashSet.has(runtimeNames, names.importedName),
      ),
    ),
  );

  return cacheAliases(runtimeFunctionAliasCache, source, [...aliases]);
};

const hasCanonicalRuntimeCall = (
  code: string,
  aliases: readonly string[],
  aliasSource: string,
): boolean =>
  (!hasLocalEffectBinding(aliasSource) &&
    aliases.includes('Effect') &&
    runtimeCallPattern.test(code)) ||
  /(?:^|[^\w$])[A-Za-z_$][\w$]*Runtime\.runMain\s*\(/.test(code);

const hasContextualRuntimeCall = (
  code: string,
  aliases: readonly string[],
  aliasSource: string,
): boolean =>
  aliases.some((alias): boolean =>
    exactIdentifierPattern(
      alias,
      String.raw`\.(?:runPromise|runPromiseExit|runSync|runSyncExit|runFork)\s*\(`,
    ).test(code),
  ) ||
  effectRuntimeFunctionAliases(aliasSource).some((alias): boolean =>
    exactIdentifierPattern(alias, String.raw`\s*\(`).test(code),
  );

const cachedRuntimeResult = (source: string, aliasSource: string, hasRuntime: boolean): boolean => {
  if (aliasSource !== source) {
    return hasRuntime;
  }
  return cacheBoolean(runtimeCallCache, source, hasRuntime);
};

/**
 * Determines whether source contains a supported Effect runtime call.
 *
 * @internal
 */
export const hasRuntimeCall = (source: string, aliasSource: string = source): boolean => {
  const cachedValue = cachedBoolean(runtimeCallCache, source);
  if (aliasSource === source && cachedValue !== undefined) {
    return cachedValue;
  }

  const code = stripCommentsAndStrings(source);
  const aliases = effectImportAliases(aliasSource);
  if (hasCanonicalRuntimeCall(code, aliases, aliasSource)) {
    return cachedRuntimeResult(source, aliasSource, true);
  }

  const hasContextualRuntime = hasContextualRuntimeCall(code, aliases, aliasSource);
  return cachedRuntimeResult(source, aliasSource, hasContextualRuntime);
};

/**
 * Determines whether source contains an Effect value-level signal.
 *
 * @internal
 */
export const hasEffectSignal = (source: string): boolean => {
  const cachedValue = cachedBoolean(effectSignalCache, source);
  if (cachedValue !== undefined) {
    return cachedValue;
  }

  if (!source.includes('Effect') && !source.includes('effect')) {
    return cacheBoolean(effectSignalCache, source, false);
  }

  const codeOnly = stripCommentsAndStrings(source);
  return cacheBoolean(
    effectSignalCache,
    source,
    hasEffectValueImport(source) ||
      effectImportAliases(source).some((alias): boolean =>
        exactIdentifierPattern(alias, String.raw`\.`).test(codeOnly),
      ),
  );
};

/**
 * Determines whether a file is an Effect execution boundary.
 *
 * @internal
 */
export const isBoundaryFile = (filename: string | undefined): boolean =>
  Boolean(filename && boundaryFilePattern.test(filename));

/**
 * Determines whether a file path names a test module.
 *
 * @internal
 */
export const isTestFile = (filename: string | undefined): boolean =>
  Boolean(filename && testFilePattern.test(filename));
