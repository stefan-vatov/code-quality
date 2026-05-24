import { stripComments, stripCommentsAndStrings } from './effect-source-helpers.js';
import { readCachedSource } from './source-cache.js';

type Context = {
  report: (descriptor: {
    loc?: { column: number; line: number };
    message: string;
    node: object;
  }) => void;
  filename?: string;
  options?: unknown[];
  sourceCode?: {
    getText?: () => string;
    text?: string;
  };
};

type SourceRule = {
  meta?: {
    schema?: unknown;
    type: 'problem';
  };
  create: (context: Context) => {
    [nodeType: string]: ((node: object) => void) | undefined;
    Program: (node: object) => void;
  };
  createOnce?: (context: Context) => {
    [nodeType: string]: ((node: object) => void) | undefined;
    before?: () => false | void;
    Program: (node: object) => void;
  };
};

type VisitorMap = Record<string, ((node: object) => void) | undefined>;

type RuleSpec = {
  ast?: (context: Context, source: string) => VisitorMap;
  name: string;
  message: string;
  countPatterns?: RegExp[];
  patterns?: RegExp[];
  tokenGroups?: readonly (readonly string[])[];
  tokens?: readonly string[];
  check?: (source: string, context: Context) => boolean | number | { index: number };
};

type MakeRulesOptions = {
  defaultTokens?: readonly string[];
  schema?: unknown;
};

const LINE_START_CACHE_MAX = 256;
const TOKEN_GATE_CACHE_MAX = 512;
const lineStartCache = new Map<string, readonly number[]>();
const globalPatternCache = new WeakMap<RegExp, RegExp>();
const tokenGateCache: WeakMap<readonly string[], Map<string, boolean>> = new WeakMap();
const sourceTokenPresenceCache = new Map<string, Map<string, boolean>>();

function readSource(context: Context): string {
  return readCachedSource(context);
}

function isCodeAt(strippedSource: string, index: number): boolean {
  return strippedSource[index]?.trim() !== '';
}

function hasPattern(source: string, patterns: readonly RegExp[]): boolean {
  let strippedSource: string | undefined = undefined;
  return patterns.some((pattern) => {
    for (const match of source.matchAll(toGlobalRegExp(pattern))) {
      strippedSource ??= stripCommentsAndStrings(source);
      if (isCodeAt(strippedSource, match.index)) {
        return true;
      }
    }
    return false;
  });
}

function toGlobalRegExp(pattern: RegExp): RegExp {
  const cachedPattern = globalPatternCache.get(pattern);
  if (cachedPattern !== undefined) {
    return cachedPattern;
  }

  const globalPattern = new RegExp(
    pattern.source,
    pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`,
  );
  globalPatternCache.set(pattern, globalPattern);
  return globalPattern;
}

function cachedLineStarts(source: string): readonly number[] | undefined {
  return lineStartCache.get(source);
}

function lineStartsFor(source: string): readonly number[] {
  const cachedStarts = cachedLineStarts(source);
  if (cachedStarts !== undefined) {
    return cachedStarts;
  }

  const starts = [0];
  for (let position = 0; position < source.length; position++) {
    if (source.charCodeAt(position) === 10) {
      starts.push(position + 1);
    }
  }

  if (lineStartCache.size >= LINE_START_CACHE_MAX) {
    const firstKey = lineStartCache.keys().next().value;
    if (firstKey !== undefined) {
      lineStartCache.delete(firstKey);
    }
  }
  lineStartCache.set(source, starts);
  return starts;
}

function locFromIndex(source: string, index: number): { column: number; line: number } {
  const starts = lineStartsFor(source);
  let low = 0;
  let high = starts.length - 1;

  while (low <= high) {
    const middle = (low + high) >> 1;
    const lineStart = starts[middle] ?? 0;
    if (lineStart <= index) {
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }

  const lineIndex = Math.max(0, high);
  const lineStart = starts[lineIndex] ?? 0;
  const line = lineIndex + 1;
  return { column: index - lineStart, line };
}

function firstPatternLoc(
  source: string,
  patterns: readonly RegExp[],
): { column: number; line: number } | undefined {
  let strippedSource: string | undefined = undefined;
  for (const pattern of patterns) {
    for (const match of source.matchAll(toGlobalRegExp(pattern))) {
      strippedSource ??= stripCommentsAndStrings(source);
      if (!isCodeAt(strippedSource, match.index)) {
        continue;
      }
      return locFromIndex(source, match.index);
    }
  }
  return undefined;
}

type ReportPatternMatchesInput = {
  context: Context;
  node: object;
  source: string;
  spec: RuleSpec;
};

function reportPatternMatches(input: ReportPatternMatchesInput): void {
  const { context, node, source, spec } = input;
  if (!spec.countPatterns) {
    context.report({
      loc: firstPatternLoc(source, spec.patterns ?? []),
      message: spec.message,
      node,
    });
    return;
  }

  let strippedSource: string | undefined = undefined;
  for (const pattern of spec.countPatterns) {
    for (const match of source.matchAll(toGlobalRegExp(pattern))) {
      strippedSource ??= stripCommentsAndStrings(source);
      if (!isCodeAt(strippedSource, match.index)) {
        continue;
      }
      context.report({
        loc: locFromIndex(source, match.index),
        message: spec.message,
        node,
      });
    }
  }
}

function checkResultIndex(result: boolean | number | { index: number }): number | undefined {
  if (typeof result === 'number') {
    return result;
  }
  if (typeof result === 'object') {
    return result.index;
  }

  return undefined;
}

function isCheckViolation(result: boolean | number | { index: number }): boolean {
  return typeof result === 'boolean' ? result : true;
}

function cachedSourceTokenPresence(source: string): Map<string, boolean> {
  let tokenPresence = sourceTokenPresenceCache.get(source);
  if (tokenPresence !== undefined) {
    return tokenPresence;
  }

  if (sourceTokenPresenceCache.size >= TOKEN_GATE_CACHE_MAX) {
    const firstKey = sourceTokenPresenceCache.keys().next().value;
    if (firstKey !== undefined) {
      sourceTokenPresenceCache.delete(firstKey);
    }
  }
  tokenPresence = new Map<string, boolean>();
  sourceTokenPresenceCache.set(source, tokenPresence);
  return tokenPresence;
}

function hasTokenInSourceCached(source: string, token: string): boolean {
  const tokenPresence = cachedSourceTokenPresence(source);
  const cachedValue = tokenPresence.get(token);
  if (cachedValue !== undefined) {
    return cachedValue;
  }

  const hasToken = source.includes(token);
  tokenPresence.set(token, hasToken);
  return hasToken;
}

function hasAnyToken(source: string, tokens: readonly string[]): boolean {
  return tokens.some((token) => hasTokenInSourceCached(source, token));
}

function cachedTokenGate(source: string, tokens: readonly string[]): boolean | undefined {
  return tokenGateCache.get(tokens)?.get(source);
}

function cacheTokenGate(source: string, tokens: readonly string[], hasToken: boolean): boolean {
  let sourceCache = tokenGateCache.get(tokens);
  if (!sourceCache) {
    sourceCache = new Map<string, boolean>();
    tokenGateCache.set(tokens, sourceCache);
  }

  if (sourceCache.size >= TOKEN_GATE_CACHE_MAX) {
    const firstKey = sourceCache.keys().next().value;
    if (firstKey !== undefined) {
      sourceCache.delete(firstKey);
    }
  }
  sourceCache.set(source, hasToken);
  return hasToken;
}

function hasAnyTokenCached(source: string, tokens: readonly string[]): boolean {
  const cachedValue = cachedTokenGate(source, tokens);
  if (cachedValue !== undefined) {
    return cachedValue;
  }

  return cacheTokenGate(source, tokens, hasAnyToken(source, tokens));
}

function hasEveryTokenGroup(source: string, tokenGroups: readonly (readonly string[])[]): boolean {
  return tokenGroups.every((group) => hasAnyTokenCached(source, group));
}

function shouldSkipSource(
  source: string,
  requiredTokens: readonly string[] | undefined,
  requiredTokenGroups: readonly (readonly string[])[] | undefined,
): boolean {
  return (
    source === '' ||
    Boolean(requiredTokens && !hasAnyTokenCached(source, requiredTokens)) ||
    Boolean(requiredTokenGroups && !hasEveryTokenGroup(source, requiredTokenGroups))
  );
}

type RunProgramRuleInput = {
  context: Context;
  node: object;
  source: string;
  spec: RuleSpec;
};

function runProgramRule(input: RunProgramRuleInput): void {
  const { context, node, source, spec } = input;
  const canonicalSource = canonicalizeEffectApiAliases(source);
  const checkResult = spec.check?.(canonicalSource, context);
  if (checkResult !== undefined) {
    if (!isCheckViolation(checkResult)) {
      return;
    }

    const index = checkResultIndex(checkResult);
    context.report({
      loc:
        index === undefined
          ? firstPatternLoc(canonicalSource, spec.patterns ?? [])
          : locFromIndex(canonicalSource, index),
      message: spec.message,
      node,
    });
    return;
  }

  if (hasPattern(canonicalSource, spec.patterns ?? [])) {
    reportPatternMatches({ context, node, source: canonicalSource, spec });
  }
}

function makeProgramOnlyRule(spec: RuleSpec, options: MakeRulesOptions): SourceRule {
  const requiredTokens = spec.tokens ?? options.defaultTokens;
  const requiredTokenGroups = spec.tokenGroups;
  const rule = makeAstCapableRule(spec, options);

  return {
    ...rule,
    createOnce(context: Context) {
      let source = '';
      let isSkipped = true;

      return {
        before() {
          source = readSource(context);
          isSkipped = shouldSkipSource(source, requiredTokens, requiredTokenGroups);
          return isSkipped ? false : undefined;
        },
        Program(node: object) {
          if (isSkipped) {
            return;
          }
          runProgramRule({ context, node, source, spec });
        },
      };
    },
  };
}

function makeAstCapableRule(spec: RuleSpec, options: MakeRulesOptions): SourceRule {
  const requiredTokens = spec.tokens ?? options.defaultTokens;
  const requiredTokenGroups = spec.tokenGroups;
  const rule: SourceRule = {
    meta: {
      schema: options.schema,
      type: 'problem',
    },
    create(context: Context) {
      const source = readSource(context);
      if (shouldSkipSource(source, requiredTokens, requiredTokenGroups)) {
        return {
          Program() {},
        };
      }

      const astVisitors = spec.ast?.(context, source) ?? {};
      return {
        ...astVisitors,
        Program(node: object) {
          if (spec.ast && Array.isArray((node as { body?: unknown }).body)) {
            return;
          }
          runProgramRule({ context, node, source, spec });
        },
      };
    },
  };

  return rule;
}

function makeProgramRule(spec: RuleSpec, options: MakeRulesOptions): SourceRule {
  return spec.ast ? makeAstCapableRule(spec, options) : makeProgramOnlyRule(spec, options);
}

function makeRules(
  specs: readonly RuleSpec[],
  options: MakeRulesOptions = {},
): Record<string, SourceRule> {
  return Object.fromEntries(specs.map((spec) => [spec.name, makeProgramRule(spec, options)]));
}

function hasEffectSignal(source: string): boolean {
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
      effectImportAliases(source).some((alias) =>
        new RegExp(`\\b${escapeRegExp(alias)}\\.`, 'u').test(codeOnly),
      ),
  );
}

const runtimeCallPattern =
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

function cachedAliases(cache: Map<string, string[]>, source: string): string[] | undefined {
  return cache.get(source);
}

function cacheAliases(cache: Map<string, string[]>, source: string, value: string[]): string[] {
  if (cache.size >= ALIAS_CACHE_MAX) {
    const firstKey = cache.keys().next().value;
    if (firstKey !== undefined) {
      cache.delete(firstKey);
    }
  }
  cache.set(source, value);
  return value;
}

function cachedBoolean(cache: Map<string, boolean>, source: string): boolean | undefined {
  return cache.get(source);
}

function cacheBoolean(cache: Map<string, boolean>, source: string, value: boolean): boolean {
  if (cache.size >= BOOLEAN_CACHE_MAX) {
    const firstKey = cache.keys().next().value;
    if (firstKey !== undefined) {
      cache.delete(firstKey);
    }
  }
  cache.set(source, value);
  return value;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function hasLocalEffectBinding(source: string): boolean {
  return /\b(?:const|let|var|function|class|namespace)\s+Effect\b/.test(
    stripCommentsAndStrings(source),
  );
}

function importSpecifierNames(
  specifier: string,
): { importedName: string; localName: string } | undefined {
  const trimmed = specifier.trim();
  if (trimmed.startsWith('type ')) {
    return undefined;
  }
  const parts = trimmed.split(/\s+as\s+/);
  const importedName = parts[0]?.trim();
  const localName = parts[1]?.trim() ?? importedName;
  return importedName && localName ? { importedName, localName } : undefined;
}

function hasAnyEffectImport(source: string): boolean {
  return /(?:^|\n)\s*import(?:\s+type)?(?:[\s\S]*?\s+from\s*)?['"](?:effect(?:\/[^'"]+)?|@effect\/[^'"]+)['"]/.test(
    stripComments(source),
  );
}

function hasEffectValueImport(source: string): boolean {
  const commentFreeSource = stripComments(source);
  for (const match of commentFreeSource.matchAll(
    /(?:^|\n)\s*import\s+(?!type\b)\s*{([^}]+)}\s*from\s*['"]effect['"]/g,
  )) {
    if (
      match[1]
        .split(',')
        .some((specifier) => importSpecifierNames(specifier)?.importedName === 'Effect')
    ) {
      return true;
    }
  }

  return (
    /(?:^|\n)\s*import\s+(?!type\b)\*\s+as\s+[A-Za-z_$][\w$]*\s+from\s*['"]effect(?:\/Effect)?['"]/.test(
      commentFreeSource,
    ) || effectFunctionAliases(source, 'Effect').length > 0
  );
}

function effectImportAliases(source: string): string[] {
  const cachedValue = cachedAliases(effectAliasCache, source);
  if (cachedValue) {
    return cachedValue;
  }

  const aliases = new Set<string>();
  const commentFreeSource = stripComments(source);

  for (const match of commentFreeSource.matchAll(
    /(?:^|\n)\s*import\s+(?!type\b)\s*{([^}]+)}\s*from\s*['"]effect['"]/g,
  )) {
    for (const specifier of match[1].split(',')) {
      const names = importSpecifierNames(specifier);
      if (!names) {
        continue;
      }
      if (names.importedName === 'Effect') {
        aliases.add('Effect');
        aliases.add(names.localName);
      }
    }
  }

  for (const match of commentFreeSource.matchAll(
    /(?:^|\n)\s*import\s+(?!type\b)\*\s+as\s+([A-Za-z_$][\w$]*)\s+from\s*['"]effect(?:\/Effect)?['"]/g,
  )) {
    aliases.add('Effect');
    aliases.add(match[1]);
  }

  if (aliases.size === 0 && !hasAnyEffectImport(source) && !hasLocalEffectBinding(source)) {
    aliases.add('Effect');
  }

  return cacheAliases(effectAliasCache, source, [...aliases]);
}

function effectApiAliases(source: string, apiName: string): string[] {
  const aliases = new Set<string>();
  const commentFreeSource = stripComments(source);

  for (const match of commentFreeSource.matchAll(
    /(?:^|\n)\s*import\s+(?!type\b)\s*{([^}]+)}\s*from\s*['"]effect['"]/g,
  )) {
    for (const specifier of match[1].split(',')) {
      const names = importSpecifierNames(specifier);
      if (names?.importedName === apiName) {
        aliases.add(names.localName);
      }
    }
  }

  for (const match of commentFreeSource.matchAll(
    new RegExp(
      `(?:^|\\n)\\s*import\\s+(?!type\\b)\\*\\s+as\\s+([A-Za-z_$][\\w$]*)\\s+from\\s*['"]effect/${escapeRegExp(apiName)}['"]`,
      'g',
    ),
  )) {
    aliases.add(match[1]);
  }

  if (aliases.size === 0 && !hasAnyEffectImport(source)) {
    aliases.add(apiName);
  }

  return [...aliases];
}

function effectFunctionAliases(
  source: string,
  moduleName: string,
  functionName?: string,
): string[] {
  const aliases = new Set<string>();
  const commentFreeSource = stripComments(source);

  for (const match of commentFreeSource.matchAll(
    new RegExp(
      `(?:^|\\n)\\s*import\\s+(?!type\\b)\\s*{([^}]+)}\\s*from\\s*['"]effect/${escapeRegExp(moduleName)}['"]`,
      'g',
    ),
  )) {
    for (const specifier of match[1].split(',')) {
      const names = importSpecifierNames(specifier);
      if (names && (!functionName || names.importedName === functionName)) {
        aliases.add(names.localName);
      }
    }
  }

  return [...aliases];
}

function canonicalImportAliases(source: string): Map<string, string> {
  const aliases = new Map<string, string>();
  const commentFreeSource = stripComments(source);
  const canonicalNames = new Set([
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
  ]);

  for (const match of commentFreeSource.matchAll(
    /(?:^|\n)\s*import\s+(?!type\b)\s*{([^}]+)}\s*from\s*['"]effect['"]/g,
  )) {
    for (const specifier of match[1].split(',')) {
      const names = importSpecifierNames(specifier);
      const importedName = names?.importedName;
      const localName = names?.localName;
      if (
        importedName &&
        localName &&
        canonicalNames.has(importedName) &&
        localName !== importedName
      ) {
        aliases.set(localName, importedName);
      }
    }
  }

  for (const match of commentFreeSource.matchAll(
    /(?:^|\n)\s*import\s+(?!type\b)\*\s+as\s+([A-Za-z_$][\w$]*)\s+from\s*['"]effect\/([A-Za-z]+)['"]/g,
  )) {
    const [, localName, moduleName] = match;
    if (canonicalNames.has(moduleName) && localName !== moduleName) {
      aliases.set(localName, moduleName);
    }
  }

  return aliases;
}

function canonicalizeEffectApiAliases(source: string): string {
  const cachedValue = canonicalSourceCache.get(source);
  if (cachedValue !== undefined) {
    return cachedValue;
  }

  let canonicalSource = source;
  for (const [localName, canonicalName] of canonicalImportAliases(source)) {
    canonicalSource = canonicalSource.replace(
      new RegExp(`\\b${escapeRegExp(localName)}\\.`, 'g'),
      `${canonicalName}.`,
    );
  }

  if (canonicalSourceCache.size >= ALIAS_CACHE_MAX) {
    const firstKey = canonicalSourceCache.keys().next().value;
    if (firstKey !== undefined) {
      canonicalSourceCache.delete(firstKey);
    }
  }
  canonicalSourceCache.set(source, canonicalSource);
  return canonicalSource;
}

function effectRuntimeFunctionAliases(source: string): string[] {
  const cachedValue = cachedAliases(runtimeFunctionAliasCache, source);
  if (cachedValue) {
    return cachedValue;
  }

  const aliases = new Set<string>();
  const runtimeNames = new Set([
    'runFork',
    'runPromise',
    'runPromiseExit',
    'runSync',
    'runSyncExit',
  ]);
  const commentFreeSource = stripComments(source);

  for (const match of commentFreeSource.matchAll(
    /(?:^|\n)\s*import\s*{([^}]+)}\s*from\s*['"]effect\/Effect['"]/g,
  )) {
    for (const specifier of match[1].split(',')) {
      const names = importSpecifierNames(specifier);
      const importedName = names?.importedName;
      const localName = names?.localName;
      if (importedName && localName && runtimeNames.has(importedName)) {
        aliases.add(localName);
      }
    }
  }

  return cacheAliases(runtimeFunctionAliasCache, source, [...aliases]);
}

function hasRuntimeCall(source: string): boolean {
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
    effectImportAliases(source).some((alias) =>
      new RegExp(
        `\\b${alias}\\.(?:runPromise|runPromiseExit|runSync|runSyncExit|runFork)\\s*\\(`,
      ).test(code),
    ) ||
      effectRuntimeFunctionAliases(source).some((alias) =>
        new RegExp(`\\b${alias}\\s*\\(`).test(code),
      ),
  );
}

function isBoundaryFile(filename: string | undefined): boolean {
  return Boolean(filename && boundaryFilePattern.test(filename));
}

function isTestFile(filename: string | undefined): boolean {
  return Boolean(filename && testFilePattern.test(filename));
}

export {
  hasEffectSignal,
  effectApiAliases,
  effectFunctionAliases,
  effectImportAliases,
  hasRuntimeCall,
  isBoundaryFile,
  isTestFile,
  makeRules,
  runtimeCallPattern,
};

export type { Context, RuleSpec, SourceRule };
