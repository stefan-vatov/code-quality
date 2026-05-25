/* -------------------------------------------------------------------------- */
/*  Effect import, alias, and runtime-call helpers for source-backed rules.   */
/* -------------------------------------------------------------------------- */
import { Array, HashSet, Option, pipe } from 'effect';
import { stripComments, stripCommentsAndStrings } from './effect-source-helpers';

/**
 * Internal helper exported for package-local composition.
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
const canonicalSourceCache = new Map<string, string>();
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

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
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

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
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

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
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

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const canonicalizeEffectAPIAliases = (source: string): string =>
  pipe(
    Option.fromNullable(canonicalSourceCache.get(source)),
    Option.getOrElse((): string => {
      const canonicalSource = pipe(
        Array.fromIterable(canonicalImportAliases(source)),
        Array.reduce(source, (currentSource, [localName, canonicalName]): string =>
          currentSource.replace(
            new RegExp(`\\b${escapeRegExp(localName)}\\.`, 'g'),
            `${canonicalName}.`,
          ),
        ),
      );

      evictCanonicalSourceCache();
      canonicalSourceCache.set(source, canonicalSource);
      return canonicalSource;
    }),
  );

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

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const hasRuntimeCall = (source: string): boolean => {
  const cachedValue = cachedBoolean(runtimeCallCache, source);
  if (cachedValue !== undefined) {
    return cachedValue;
  }

  const code = stripCommentsAndStrings(source);
  if (runtimeCallPattern.test(code)) {
    return cacheBoolean(runtimeCallCache, source, true);
  }

  return cacheBoolean(
    runtimeCallCache,
    source,
    effectImportAliases(source).some((alias): boolean =>
      new RegExp(
        `\\b${alias}\\.(?:runPromise|runPromiseExit|runSync|runSyncExit|runFork)\\s*\\(`,
      ).test(code),
    ) ||
      effectRuntimeFunctionAliases(source).some((alias): boolean =>
        new RegExp(`\\b${alias}\\s*\\(`).test(code),
      ),
  );
};

/**
 * Internal helper exported for package-local composition.
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
        new RegExp(`\\b${escapeRegExp(alias)}\\.`, 'u').test(codeOnly),
      ),
  );
};

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const isBoundaryFile = (filename: string | undefined): boolean =>
  Boolean(filename && boundaryFilePattern.test(filename));

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const isTestFile = (filename: string | undefined): boolean =>
  Boolean(filename && testFilePattern.test(filename));
