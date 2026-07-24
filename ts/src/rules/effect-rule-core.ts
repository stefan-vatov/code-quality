/* -------------------------------------------------------------------------- */
/*      Core runtime for source-backed and AST-backed Effect lint rules.      */
/* -------------------------------------------------------------------------- */
import { Array, Option, String, pipe } from 'effect';
import type { CanonicalizedEffectSource } from './effect-alias-canonicalization';
import { canonicalIndexToOriginal } from './effect-alias-canonicalization';
import { canonicalizeEffectAPIAliasesWithMap } from './effect-rule-aliases';
import { effectDiagnosticMessage } from './diagnostic-guidance';
import { readCachedSource } from './source-cache';
import { stripCommentsAndStrings } from './effect-source-helpers';

/**
 * Describes the Oxlint context exposed to composed Effect rules.
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

const LINE_START_CACHE_MAX = 256;
const TOKEN_GATE_CACHE_MAX = 512;
const lineStartCache = new Map<string, readonly number[]>();
const globalPatternCache = new WeakMap<RegExp, RegExp>();
const tokenGateCache = new WeakMap<readonly string[], Map<string, boolean>>();
const sourceTokenPresenceCache = new Map<string, Map<string, boolean>>();

const matchesIn = (source: string, pattern: RegExp): readonly RegExpExecArray[] =>
  pipe(source.matchAll(pattern), Array.fromIterable);

const isCodeAt = (strippedSource: string, index: number): boolean =>
  strippedSource[index]?.trim() !== '';

const hasPattern = (source: string, patterns: readonly RegExp[]): boolean => {
  let strippedSource: string | undefined = undefined;
  return pipe(
    patterns,
    Array.some((pattern): boolean =>
      pipe(
        matchesIn(source, toGlobalRegExp(pattern)),
        Array.some((match): boolean => {
          strippedSource ??= stripCommentsAndStrings(source);
          return isCodeAt(strippedSource, match.index);
        }),
      ),
    ),
  );
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

const lineStartsFor = (source: string): readonly number[] => {
  const cachedStarts = lineStartCache.get(source);
  if (cachedStarts !== undefined) {
    return cachedStarts;
  }

  const starts = pipe(
    matchesIn(source, /\n/g),
    Array.map((match): number => match.index + 1),
    Array.prepend(0),
  );
  if (lineStartCache.size >= LINE_START_CACHE_MAX) {
    const firstKey = lineStartCache.keys().next().value;
    if (firstKey !== undefined) {
      lineStartCache.delete(firstKey);
    }
  }
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
  return pipe(
    patterns,
    Array.filterMap(
      (pattern): Option.Option<{ column: number; line: number }> =>
        pipe(
          matchesIn(source, toGlobalRegExp(pattern)),
          Array.findFirst((match): boolean => {
            strippedSource ??= stripCommentsAndStrings(source);
            return isCodeAt(strippedSource, match.index);
          }),
          Option.map((match): { column: number; line: number } =>
            locFromCanonicalIndex(view, match.index),
          ),
        ),
    ),
    Array.head,
    Option.getOrUndefined,
  );
};

interface ReportPatternMatchesInput {
  canonicalized: CanonicalizedEffectSource;
  context: Context;
  node: object;
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
  pipe(
    spec.countPatterns ?? [],
    Array.flatMap((pattern): readonly RegExpExecArray[] =>
      matchesIn(canonicalSource, toGlobalRegExp(pattern)),
    ),
    Array.forEach((match): void => {
      strippedSource ??= stripCommentsAndStrings(canonicalSource);
      if (isCodeAt(strippedSource, match.index)) {
        context.report({
          loc: locFromCanonicalIndex(view, match.index),
          message,
          node,
        });
      }
    }),
  );
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

const cachedSourceTokenPresence = (source: string): Map<string, boolean> =>
  pipe(
    Option.fromNullable(sourceTokenPresenceCache.get(source)),
    Option.getOrElse((): Map<string, boolean> => {
      if (sourceTokenPresenceCache.size >= TOKEN_GATE_CACHE_MAX) {
        pipe(
          Option.fromNullable(sourceTokenPresenceCache.keys().next().value),
          Option.map((firstKey): boolean => sourceTokenPresenceCache.delete(firstKey)),
        );
      }
      const tokenPresence = new Map<string, boolean>();
      sourceTokenPresenceCache.set(source, tokenPresence);
      return tokenPresence;
    }),
  );

const hasTokenInSourceCached = (source: string, token: string): boolean => {
  const tokenPresence = cachedSourceTokenPresence(source);
  const cachedValue = tokenPresence.get(token);
  if (cachedValue !== undefined) {
    return cachedValue;
  }

  const hasToken = pipe(source, String.includes(token));
  tokenPresence.set(token, hasToken);
  return hasToken;
};

const hasAnyToken = (source: string, tokens: readonly string[]): boolean =>
  pipe(
    tokens,
    Array.some((token): boolean => hasTokenInSourceCached(source, token)),
  );

const cacheTokenGate = (source: string, tokens: readonly string[], hasToken: boolean): boolean => {
  const sourceCache = pipe(
    Option.fromNullable(tokenGateCache.get(tokens)),
    Option.getOrElse((): Map<string, boolean> => {
      const newSourceCache = new Map<string, boolean>();
      tokenGateCache.set(tokens, newSourceCache);
      return newSourceCache;
    }),
  );

  if (sourceCache.size >= TOKEN_GATE_CACHE_MAX) {
    pipe(
      Option.fromNullable(sourceCache.keys().next().value),
      Option.map((firstKey): boolean => sourceCache.delete(firstKey)),
    );
  }
  sourceCache.set(source, hasToken);
  return hasToken;
};

const hasAnyTokenCached = (source: string, tokens: readonly string[]): boolean => {
  const cachedValue = tokenGateCache.get(tokens)?.get(source);
  if (cachedValue !== undefined) {
    return cachedValue;
  }

  return cacheTokenGate(source, tokens, hasAnyToken(source, tokens));
};

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
  get options(): object[] | undefined {
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

interface RunProgramRuleInput {
  context: Context;
  node: object;
  source: string;
  spec: RuleSpec;
}

const runProgramRule = (input: RunProgramRuleInput): void => {
  const { context, node, source, spec } = input;
  const canonicalized = canonicalizeEffectAPIAliasesWithMap(source);
  const canonicalSource = canonicalized.source;
  const checkResult = spec.check?.(canonicalSource, context);
  if (checkResult !== undefined) {
    if (typeof checkResult !== 'boolean' || checkResult) {
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
        Program(node: object): void {
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
        Program(node: object): void {
          astProgram?.(node);
          if (spec.ast && globalThis.Array.isArray((node as { body?: unknown }).body)) {
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
