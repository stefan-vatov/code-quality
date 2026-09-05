/* -------------------------------------------------------------------------- */
/*      Core runtime for source-backed and AST-backed Effect lint rules.      */
/* -------------------------------------------------------------------------- */
import { Array, Option, Predicate, String, pipe } from 'effect';
import {
  LINE_START_CACHE_MAX_WEIGHT,
  SOURCE_TOKEN_PRESENCE_CACHE_MAX_WEIGHT,
  lineStartCacheWeight,
  sourceTokenPresenceCacheWeight,
} from './effect-source-cache-weights';
import { createWeightedCache, readCachedSource } from './source-cache';
import type { CanonicalizedEffectSource } from './effect-alias-canonicalization';
import type { SourceWeightedCache } from './effect-source-cache-weights';
import { canonicalIndexToOriginal } from './effect-alias-canonicalization';
import { canonicalizeEffectAPIAliasesWithMap } from './effect-rule-aliases';
import { effectDiagnosticMessage } from './diagnostic-guidance';
import { stripCommentsAndStrings } from './effect-source-helpers';
import { isASTArray } from './effect-ast';
import type { ASTNode, ASTValue } from './effect-ast';
import type { NativeSourceCode } from './effect-native-types';

/**
 * Describes the Oxlint context exposed to composed Effect rules.
 *
 * @internal
 */
export interface Context {
  report: (descriptor: {
    loc?: { column: number; line: number };
    message: string;
    node: ASTNode;
  }) => void;
  filename?: string;
  options?: ASTValue[];
  sourceCode?: NativeSourceCode;
}

/**
 * Describes a source-backed Effect rule and its visitor factories.
 *
 * @internal
 */
export interface SourceRule {
  meta?: {
    docs?: {
      description: string;
    };
    schema?: object;
    type: 'problem';
  };
  create: (context: Context) => {
    [nodeType: string]: ((node: ASTNode) => void) | undefined;
    Program: (node: ASTNode) => void;
  };
  createOnce?: (context: Context) => {
    [nodeType: string]: ((node: ASTNode) => void) | undefined;
    before?: () => false | void;
    Program: (node: ASTNode) => void;
  };
}

export type VisitorMap = Record<string, ((node: ASTNode) => void) | undefined>;

/**
 * Describes one generated Effect lint rule.
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

const LINE_START_CACHE_MAX_ENTRIES = 256;
const SOURCE_TOKEN_PRESENCE_CACHE_MAX_ENTRIES = 512;
const SOURCE_TOKEN_PRESENCE_MAX_TOKENS = 64;
const lineTerminatorPattern = /\r\n|[\r\n\u2028\u2029]/g;
const lineStartCache: SourceWeightedCache<readonly number[]> = createWeightedCache({
  maxEntries: LINE_START_CACHE_MAX_ENTRIES,
  maxWeight: LINE_START_CACHE_MAX_WEIGHT,
});
const globalPatternCache = new WeakMap<RegExp, RegExp>();
const sourceTokenPresenceCache: SourceWeightedCache<Map<string, boolean>> = createWeightedCache({
  maxEntries: SOURCE_TOKEN_PRESENCE_CACHE_MAX_ENTRIES,
  maxWeight: SOURCE_TOKEN_PRESENCE_CACHE_MAX_WEIGHT,
});

const isCodeAt = (strippedSource: string, index: number): boolean =>
  index < strippedSource.length && strippedSource[index]?.trim() !== '';

const advanceStringIndex = (source: string, index: number, isUnicodeMode: boolean): number => {
  const codePoint = source.codePointAt(index);
  if (isUnicodeMode && codePoint !== undefined && codePoint !== source.charCodeAt(index)) {
    return index + 2;
  }
  return index + 1;
};

const nextPatternIndex = (
  source: string,
  index: number,
  match: RegExpExecArray,
  isUnicodeMode: boolean,
): number => {
  if (match[0] !== '') {
    return index;
  }
  return advanceStringIndex(source, index, isUnicodeMode);
};

const scanPatternMatches = (
  source: string,
  globalPattern: RegExp,
  isUnicodeMode: boolean,
  visit: (match: RegExpExecArray) => boolean,
): void => {
  const scanner = globalPattern;
  let match = scanner.exec(source);
  while (match !== null) {
    const nextIndex = scanner.lastIndex;
    const shouldStop = visit(match);
    scanner.lastIndex = nextIndex;
    if (shouldStop) {
      return;
    }
    scanner.lastIndex = nextPatternIndex(source, nextIndex, match, isUnicodeMode);
    match = scanner.exec(source);
  }
};

const scanPattern = (
  source: string,
  pattern: RegExp,
  visit: (match: RegExpExecArray) => boolean,
): void => {
  const globalPattern = toGlobalRegExp(pattern);
  const isUnicodeMode = globalPattern.flags.includes('u') || globalPattern.flags.includes('v');
  globalPattern.lastIndex = 0;
  try {
    scanPatternMatches(source, globalPattern, isUnicodeMode, visit);
  } finally {
    globalPattern.lastIndex = 0;
  }
};

const firstCodeMatchIndex = (
  source: string,
  pattern: RegExp,
  strippedSource?: string,
): PatternMatchResult => {
  let projectedSource = strippedSource;
  let matchIndex: number | undefined = undefined;
  scanPattern(source, pattern, (match): boolean => {
    projectedSource ??= stripCommentsAndStrings(source);
    if (!isCodeAt(projectedSource, match.index)) {
      return false;
    }
    matchIndex = match.index;
    return true;
  });
  return { index: matchIndex, strippedSource: projectedSource };
};

const hasPattern = (source: string, patterns: readonly RegExp[]): boolean => {
  let strippedSource: string | undefined = undefined;
  for (const pattern of patterns) {
    const { index, strippedSource: nextStrippedSource } = firstCodeMatchIndex(
      source,
      pattern,
      strippedSource,
    );
    strippedSource = nextStrippedSource;
    if (index !== undefined) {
      return true;
    }
  }
  return false;
};

const toGlobalRegExp = (pattern: RegExp): RegExp =>
  pipe(
    Option.fromNullable(globalPatternCache.get(pattern)),
    Option.getOrElse((): RegExp => {
      const flags = pipe(
        pattern.flags,
        Option.liftPredicate((value): boolean => pipe(value, String.includes('g'))),
        Option.getOrElse((): string => `${pattern.flags}g`),
      );
      const globalPattern = new RegExp(pattern.source, flags);
      globalPatternCache.set(pattern, globalPattern);
      return globalPattern;
    }),
  );

const lineStartsFrom = (source: string): number[] => {
  const starts: number[] = [0];
  scanPattern(source, lineTerminatorPattern, (match): boolean => {
    starts.push(match.index + match[0].length);
    return false;
  });
  return starts;
};

const lineStartsFor = (source: string): readonly number[] => {
  const cachedStarts = lineStartCache.get(source);
  if (cachedStarts !== undefined) {
    return cachedStarts;
  }

  const starts = lineStartsFrom(source);
  lineStartCache.set(source, starts, lineStartCacheWeight(source.length, starts.length));
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

const locFromIndex = (source: string, index: number): SourceLocation => {
  const starts = lineStartsFor(source);
  const lineIndex = lineIndexFor(starts, index);
  const lineStart = starts[lineIndex] ?? 0;
  return { column: index - lineStart, line: lineIndex + 1 };
};

interface SourceView {
  canonicalized: CanonicalizedEffectSource;
  original: string;
}

const locFromCanonicalIndex = (view: SourceView, index: number): { column: number; line: number } =>
  locFromIndex(view.original, canonicalIndexToOriginal(view.canonicalized, index));

const firstPatternLOC = (
  view: SourceView,
  patterns: readonly RegExp[],
): { column: number; line: number } | undefined => {
  const { source } = view.canonicalized;
  let strippedSource: string | undefined = undefined;
  for (const pattern of patterns) {
    const { index, strippedSource: nextStrippedSource } = firstCodeMatchIndex(
      source,
      pattern,
      strippedSource,
    );
    strippedSource = nextStrippedSource;
    if (index !== undefined) {
      return locFromCanonicalIndex(view, index);
    }
  }
  return undefined;
};

interface ReportPatternMatchesInput {
  canonicalized: CanonicalizedEffectSource;
  context: Context;
  node: ASTNode;
  source: string;
  spec: RuleSpec;
}

const reportPatternMatches = (input: ReportPatternMatchesInput): void => {
  const { canonicalized, context, node, source, spec } = input;
  const view = { canonicalized, original: source };
  const message = effectDiagnosticMessage(spec.name, spec.message);
  if (!spec.countPatterns) {
    context.report({
      loc: firstPatternLOC(view, spec.patterns ?? []),
      message,
      node,
    });
    return;
  }

  reportCountedPatternMatches(input, message);
};

const reportCountedPatternMatches = (input: ReportPatternMatchesInput, message: string): void => {
  const { canonicalized, context, node, source, spec } = input;
  const canonicalSource = canonicalized.source;
  const view = { canonicalized, original: source };
  let strippedSource: string | undefined = undefined;
  for (const pattern of spec.countPatterns ?? []) {
    scanPattern(canonicalSource, pattern, (match): boolean => {
      strippedSource ??= stripCommentsAndStrings(canonicalSource);
      if (isCodeAt(strippedSource, match.index)) {
        context.report({
          loc: locFromCanonicalIndex(view, match.index),
          message,
          node,
        });
      }
      return false;
    });
  }
};

interface PatternMatchResult {
  readonly index?: number;
  readonly strippedSource?: string;
}

interface SourceLocation {
  readonly column: number;
  readonly line: number;
}

interface IndexedCheckResult {
  readonly index: number;
}

type CheckResultValue = boolean | number | IndexedCheckResult;

const checkResultIndex = (result: CheckResultValue): number | undefined => {
  if (Predicate.isNumber(result)) {
    return result;
  }
  if (Predicate.isObject(result)) {
    return result.index;
  }
  return undefined;
};

const cachedSourceTokenPresence = (source: string): Map<string, boolean> => {
  const cached = sourceTokenPresenceCache.get(source);
  if (cached !== undefined) {
    return cached;
  }
  const tokenPresence = new Map<string, boolean>();
  sourceTokenPresenceCache.set(
    source,
    tokenPresence,
    sourceTokenPresenceCacheWeight(source.length, tokenPresence.keys()),
  );
  return tokenPresence;
};

const hasTokenInSourceCached = (source: string, token: string): boolean => {
  const tokenPresence = cachedSourceTokenPresence(source);
  const cachedValue = tokenPresence.get(token);
  if (cachedValue !== undefined) {
    return cachedValue;
  }

  const hasToken = pipe(source, String.includes(token));
  if (tokenPresence.size < SOURCE_TOKEN_PRESENCE_MAX_TOKENS) {
    tokenPresence.set(token, hasToken);
    sourceTokenPresenceCache.set(
      source,
      tokenPresence,
      sourceTokenPresenceCacheWeight(source.length, tokenPresence.keys()),
    );
  }
  return hasToken;
};

const hasAnyToken = (source: string, tokens: readonly string[]): boolean =>
  pipe(
    tokens,
    Array.some((token): boolean => hasTokenInSourceCached(source, token)),
  );

const hasAnyTokenCached = hasAnyToken;

const hasEveryTokenGroup = (source: string, tokenGroups: readonly (readonly string[])[]): boolean =>
  pipe(
    tokenGroups,
    Array.every((group): boolean => hasAnyTokenCached(source, group)),
  );

const shouldSkipSource = (
  source: string,
  requiredTokens: readonly string[] | undefined,
  requiredTokenGroups: readonly (readonly string[])[] | undefined,
): boolean =>
  source === '' ||
  Boolean(requiredTokens && !hasAnyTokenCached(source, requiredTokens)) ||
  Boolean(requiredTokenGroups && !hasEveryTokenGroup(source, requiredTokenGroups));

const checkResultLOC = (
  canonicalized: CanonicalizedEffectSource,
  source: string,
  spec: RuleSpec,
  checkResult: CheckResult,
): { column: number; line: number } | undefined => {
  const view = { canonicalized, original: source };
  const index = checkResultIndex(checkResult);
  if (index !== undefined) {
    return locFromCanonicalIndex(view, index);
  }
  return firstPatternLOC(view, spec.patterns ?? []);
};

const reportCheckResult = (input: ReportPatternMatchesInput, checkResult: CheckResult): void => {
  const { canonicalized, context, node, source, spec } = input;
  context.report({
    loc: checkResultLOC(canonicalized, source, spec, checkResult),
    message: effectDiagnosticMessage(spec.name, spec.message),
    node,
  });
};

const guidedContext = (context: Context, spec: RuleSpec): Context => ({
  get filename(): string | undefined {
    return context.filename;
  },
  get options(): ASTValue[] | undefined {
    return context.options;
  },
  report(descriptor): void {
    context.report({
      ...descriptor,
      message: effectDiagnosticMessage(spec.name, descriptor.message),
    });
  },
  get sourceCode(): Context['sourceCode'] {
    return context.sourceCode;
  },
});

const runProgramRule = (
  input: Pick<ReportPatternMatchesInput, 'context' | 'node' | 'source' | 'spec'>,
): void => {
  const { context, node, source, spec } = input;
  const canonicalized = canonicalizeEffectAPIAliasesWithMap(source);
  const canonicalSource = canonicalized.source;
  const checkResult = spec.check?.(canonicalSource, context);
  if (checkResult !== undefined) {
    if (checkResult !== false) {
      reportCheckResult({ canonicalized, context, node, source, spec }, checkResult);
    }
    return;
  }

  if (hasPattern(canonicalSource, spec.patterns ?? [])) {
    reportPatternMatches({ canonicalized, context, node, source, spec });
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
        Program(node: ASTNode): void {
          if (isSkipped) {
            return;
          }
          runProgramRule({ context, node, source, spec });
        },
        before() {
          source = readCachedSource(context);
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
      const source = readCachedSource(context);
      if (shouldSkipSource(source, requiredTokens, requiredTokenGroups)) {
        return {
          Program(): void {},
        };
      }

      const astContext = guidedContext(context, spec);
      const astVisitors = spec.ast?.(astContext, source) ?? {};
      const astProgram = astVisitors.Program;
      return {
        ...astVisitors,
        Program(node: ASTNode): void {
          astProgram?.(node);
          if (spec.ast && isASTArray(node.body)) {
            return;
          }
          runProgramRule({ context, node, source, spec });
        },
      };
    },
    meta: {
      docs: {
        description: effectDiagnosticMessage(spec.name, spec.message),
      },
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
 * Builds named Effect rules from declarative rule specifications.
 *
 * @internal
 */
export const makeRules = (
  specs: readonly RuleSpec[],
  options: MakeRulesOptions = {},
): Record<string, SourceRule> =>
  Object.fromEntries(
    pipe(
      specs,
      Array.map((spec): readonly [string, SourceRule] => [
        spec.name,
        makeProgramRule(spec, options),
      ]),
    ),
  );

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
