/* -------------------------------------------------------------------------- */
/*      Core runtime for source-backed and AST-backed Effect lint rules.      */
/* -------------------------------------------------------------------------- */
import { Array, Option, String, pipe } from 'effect';
import { canonicalizeEffectAPIAliases } from './effect-rule-aliases';
import { effectDiagnosticMessage } from './diagnostic-guidance';
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
const lineStartCache = new Map<string, readonly number[]>();
const globalPatternCache = new WeakMap<RegExp, RegExp>();
const tokenGateCache = new WeakMap<readonly string[], Map<string, boolean>>();
const sourceTokenPresenceCache = new Map<string, Map<string, boolean>>();

const readSource = (context: Context): string => readCachedSource(context);

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

const cachedLineStarts = (source: string): readonly number[] | undefined =>
  lineStartCache.get(source);

const evictFirstLineStart = (): void => {
  if (lineStartCache.size < LINE_START_CACHE_MAX) {
    return;
  }
  pipe(
    Option.fromNullable(lineStartCache.keys().next().value),
    Option.map((firstKey): boolean => lineStartCache.delete(firstKey)),
  );
};

const computeLineStarts = (source: string): number[] =>
  pipe(
    matchesIn(source, /\n/g),
    Array.map((match): number => match.index + 1),
    Array.prepend(0),
  );

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
            locFromIndex(source, match.index),
          ),
        ),
    ),
    Array.head,
    Option.getOrUndefined,
  );
};

interface ReportPatternMatchesInput {
  context: Context;
  node: object;
  source: string;
  spec: RuleSpec;
}

const reportPatternMatches = (input: ReportPatternMatchesInput): void => {
  const { context, node, source, spec } = input;
  const message = effectDiagnosticMessage(spec.name, spec.message);
  if (!spec.countPatterns) {
    context.report({
      loc: firstPatternLOC(source, spec.patterns ?? []),
      message,
      node,
    });
    return;
  }

  reportCountedPatternMatches(input, message);
};

const reportCountedPatternMatches = (input: ReportPatternMatchesInput, message: string): void => {
  const { context, node, source, spec } = input;
  let strippedSource: string | undefined = undefined;
  pipe(
    spec.countPatterns ?? [],
    Array.flatMap((pattern): readonly RegExpExecArray[] =>
      matchesIn(source, toGlobalRegExp(pattern)),
    ),
    Array.forEach((match): void => {
      strippedSource ??= stripCommentsAndStrings(source);
      if (isCodeAt(strippedSource, match.index)) {
        context.report({
          loc: locFromIndex(source, match.index),
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

const isCheckViolation = (result: boolean | number | { index: number }): boolean => {
  if (typeof result === 'boolean') {
    return result;
  }
  return true;
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

const cachedTokenGate = (source: string, tokens: readonly string[]): boolean | undefined =>
  tokenGateCache.get(tokens)?.get(source);

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
  const cachedValue = cachedTokenGate(source, tokens);
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

      const astContext = guidedContext(context, spec);
      const astVisitors = spec.ast?.(astContext, source) ?? {};
      return {
        ...astVisitors,
        Program(node: object): void {
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
 * Internal helper exported for package-local composition.
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
