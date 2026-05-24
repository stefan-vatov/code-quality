/**
 * Core runtime for source-backed and AST-backed Effect lint rules.
 *
 * @internal
 */
import { canonicalizeEffectAPIAliases } from './effect-rule-aliases';
import { readCachedSource } from './source-cache';
import { stripCommentsAndStrings } from './effect-source-helpers';

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export interface Context {
  report: (descriptor: {
    loc?: { column: number; line: number };
    message: string;
    node: object;
  }) => void;
  filename?: string;
  options?: object[];
  sourceCode?: {
    getText?: () => string;
    text?: string;
  };
}

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export interface SourceRule {
  meta?: {
    schema?: object;
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
}

type VisitorMap = Record<string, ((node: object) => void) | undefined>;

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export interface RuleSpec {
  ast?: (context: Context, source: string) => VisitorMap;
  name: string;
  message: string;
  countPatterns?: readonly RegExp[];
  patterns?: readonly RegExp[];
  tokenGroups?: readonly (readonly string[])[];
  tokens?: readonly string[];
  check?: (source: string, context: Context) => boolean | number | { index: number };
}

type CheckResult = NonNullable<ReturnType<NonNullable<RuleSpec['check']>>>;

interface MakeRulesOptions {
  defaultTokens?: readonly string[];
  schema?: object;
}

const LINE_START_CACHE_MAX = 256;
const TOKEN_GATE_CACHE_MAX = 512;
const CHAR_CODE_NEWLINE = 10;
const lineStartCache = new Map<string, readonly number[]>();
const globalPatternCache = new WeakMap<RegExp, RegExp>();
const tokenGateCache = new WeakMap<readonly string[], Map<string, boolean>>();
const sourceTokenPresenceCache = new Map<string, Map<string, boolean>>();

const readSource = (context: Context): string => readCachedSource(context);

const isCodeAt = (strippedSource: string, index: number): boolean =>
  strippedSource[index]?.trim() !== '';

const hasPattern = (source: string, patterns: readonly RegExp[]): boolean => {
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
};

const toGlobalRegExp = (pattern: RegExp): RegExp => {
  const cachedPattern = globalPatternCache.get(pattern);
  if (cachedPattern !== undefined) {
    return cachedPattern;
  }

  let { flags } = pattern;
  if (!flags.includes('g')) {
    flags = `${flags}g`;
  }
  const globalPattern = new RegExp(pattern.source, flags);
  globalPatternCache.set(pattern, globalPattern);
  return globalPattern;
};

const cachedLineStarts = (source: string): readonly number[] | undefined =>
  lineStartCache.get(source);

const evictFirstLineStart = (): void => {
  if (lineStartCache.size < LINE_START_CACHE_MAX) {
    return;
  }
  const firstKey = lineStartCache.keys().next().value;
  if (firstKey !== undefined) {
    lineStartCache.delete(firstKey);
  }
};

const computeLineStarts = (source: string): number[] => {
  const starts = [0];
  for (let position = 0; position < source.length; position++) {
    if (source.charCodeAt(position) === CHAR_CODE_NEWLINE) {
      starts.push(position + 1);
    }
  }
  return starts;
};

const lineStartsFor = (source: string): readonly number[] => {
  const cachedStarts = cachedLineStarts(source);
  if (cachedStarts !== undefined) {
    return cachedStarts;
  }

  const starts = computeLineStarts(source);
  evictFirstLineStart();
  lineStartCache.set(source, starts);
  return starts;
};

const lineIndexFor = (starts: readonly number[], index: number): number => {
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
  return Math.max(0, high);
};

const locFromIndex = (source: string, index: number): { column: number; line: number } => {
  const starts = lineStartsFor(source);
  const lineIndex = lineIndexFor(starts, index);
  const lineStart = starts[lineIndex] ?? 0;
  const line = lineIndex + 1;
  return { column: index - lineStart, line };
};

const firstPatternLOC = (
  source: string,
  patterns: readonly RegExp[],
): { column: number; line: number } | undefined => {
  let strippedSource: string | undefined = undefined;
  for (const pattern of patterns) {
    for (const match of source.matchAll(toGlobalRegExp(pattern))) {
      strippedSource ??= stripCommentsAndStrings(source);
      if (isCodeAt(strippedSource, match.index)) {
        return locFromIndex(source, match.index);
      }
    }
  }
  return undefined;
};

interface ReportPatternMatchesInput {
  context: Context;
  node: object;
  source: string;
  spec: RuleSpec;
}

const reportPatternMatches = (input: ReportPatternMatchesInput): void => {
  const { context, node, source, spec } = input;
  if (!spec.countPatterns) {
    context.report({
      loc: firstPatternLOC(source, spec.patterns ?? []),
      message: spec.message,
      node,
    });
    return;
  }

  let strippedSource: string | undefined = undefined;
  for (const pattern of spec.countPatterns) {
    for (const match of source.matchAll(toGlobalRegExp(pattern))) {
      strippedSource ??= stripCommentsAndStrings(source);
      if (isCodeAt(strippedSource, match.index)) {
        context.report({
          loc: locFromIndex(source, match.index),
          message: spec.message,
          node,
        });
      }
    }
  }
};

const checkResultIndex = (result: boolean | number | { index: number }): number | undefined => {
  if (typeof result === 'number') {
    return result;
  }
  if (typeof result === 'object') {
    return result.index;
  }

  return undefined;
};

const isCheckViolation = (result: boolean | number | { index: number }): boolean => {
  if (typeof result === 'boolean') {
    return result;
  }
  return true;
};

const cachedSourceTokenPresence = (source: string): Map<string, boolean> => {
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
};

const hasTokenInSourceCached = (source: string, token: string): boolean => {
  const tokenPresence = cachedSourceTokenPresence(source);
  const cachedValue = tokenPresence.get(token);
  if (cachedValue !== undefined) {
    return cachedValue;
  }

  const hasToken = source.includes(token);
  tokenPresence.set(token, hasToken);
  return hasToken;
};

const hasAnyToken = (source: string, tokens: readonly string[]): boolean =>
  tokens.some((token): boolean => hasTokenInSourceCached(source, token));

const cachedTokenGate = (source: string, tokens: readonly string[]): boolean | undefined =>
  tokenGateCache.get(tokens)?.get(source);

const cacheTokenGate = (source: string, tokens: readonly string[], hasToken: boolean): boolean => {
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
};

const hasAnyTokenCached = (source: string, tokens: readonly string[]): boolean => {
  const cachedValue = cachedTokenGate(source, tokens);
  if (cachedValue !== undefined) {
    return cachedValue;
  }

  return cacheTokenGate(source, tokens, hasAnyToken(source, tokens));
};

const hasEveryTokenGroup = (source: string, tokenGroups: readonly (readonly string[])[]): boolean =>
  tokenGroups.every((group): boolean => hasAnyTokenCached(source, group));

const shouldSkipSource = (
  source: string,
  requiredTokens: readonly string[] | undefined,
  requiredTokenGroups: readonly (readonly string[])[] | undefined,
): boolean =>
  source === '' ||
  Boolean(requiredTokens && !hasAnyTokenCached(source, requiredTokens)) ||
  Boolean(requiredTokenGroups && !hasEveryTokenGroup(source, requiredTokenGroups));

const checkResultLOC = (
  source: string,
  spec: RuleSpec,
  checkResult: CheckResult,
): { column: number; line: number } | undefined => {
  const index = checkResultIndex(checkResult);
  if (index !== undefined) {
    return locFromIndex(source, index);
  }
  return firstPatternLOC(source, spec.patterns ?? []);
};

const reportCheckResult = (
  context: Context,
  node: object,
  source: string,
  spec: RuleSpec,
  checkResult: CheckResult,
): void => {
  context.report({
    loc: checkResultLOC(source, spec, checkResult),
    message: spec.message,
    node,
  });
};

interface RunProgramRuleInput {
  context: Context;
  node: object;
  source: string;
  spec: RuleSpec;
}

const runProgramRule = (input: RunProgramRuleInput): void => {
  const { context, node, source, spec } = input;
  const canonicalSource = canonicalizeEffectAPIAliases(source);
  const checkResult = spec.check?.(canonicalSource, context);
  if (checkResult !== undefined) {
    if (!isCheckViolation(checkResult)) {
      return;
    }

    reportCheckResult(context, node, canonicalSource, spec, checkResult);
    return;
  }

  if (hasPattern(canonicalSource, spec.patterns ?? [])) {
    reportPatternMatches({ context, node, source: canonicalSource, spec });
  }
};

const makeProgramOnlyRule = (spec: RuleSpec, options: MakeRulesOptions): SourceRule => {
  const requiredTokens = spec.tokens ?? options.defaultTokens;
  const requiredTokenGroups = spec.tokenGroups;
  const rule = makeASTCapableRule(spec, options);

  return {
    ...rule,
    createOnce(context: Context) {
      let source = '';
      let isSkipped = true;

      return {
        Program(node: object): void {
          if (isSkipped) {
            return;
          }
          runProgramRule({ context, node, source, spec });
        },
        before() {
          source = readSource(context);
          isSkipped = shouldSkipSource(source, requiredTokens, requiredTokenGroups);
          if (isSkipped) {
            return false;
          }
          return undefined;
        },
      };
    },
  };
};

const makeASTCapableRule = (spec: RuleSpec, options: MakeRulesOptions): SourceRule => {
  const requiredTokens = spec.tokens ?? options.defaultTokens;
  const requiredTokenGroups = spec.tokenGroups;
  const rule: SourceRule = {
    create(context: Context) {
      const source = readSource(context);
      if (shouldSkipSource(source, requiredTokens, requiredTokenGroups)) {
        return {
          Program(): void {},
        };
      }

      const astVisitors = spec.ast?.(context, source) ?? {};
      return {
        ...astVisitors,
        Program(node: object): void {
          if (spec.ast && Array.isArray((node as { body?: unknown }).body)) {
            return;
          }
          runProgramRule({ context, node, source, spec });
        },
      };
    },
    meta: {
      schema: options.schema,
      type: 'problem',
    },
  };

  return rule;
};

const makeProgramRule = (spec: RuleSpec, options: MakeRulesOptions): SourceRule => {
  if (spec.ast) {
    return makeASTCapableRule(spec, options);
  }
  return makeProgramOnlyRule(spec, options);
};

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const makeRules = (
  specs: readonly RuleSpec[],
  options: MakeRulesOptions = {},
): Record<string, SourceRule> =>
  Object.fromEntries(specs.map((spec) => [spec.name, makeProgramRule(spec, options)]));

export {
  effectAPIAliases,
  effectFunctionAliases,
  effectImportAliases,
  hasEffectSignal,
  hasRuntimeCall,
  isBoundaryFile,
  isTestFile,
  runtimeCallPattern,
} from './effect-rule-aliases';
