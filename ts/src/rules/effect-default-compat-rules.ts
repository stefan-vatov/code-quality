/* -------------------------------------------------------------------------- */
/*             Compatibility and runtime-tail Effect rule specs.              */
/* -------------------------------------------------------------------------- */
import { Array, HashSet, Match, Option, pipe } from 'effect';
import {
  effectCallPredicate,
  effectServiceSelfName,
  identifierName,
  nodeType,
  objectValue,
  reportAST,
  typeReferenceName,
} from './effect-default-ast';
import { effectImportAliases, hasEffectSignal } from './effect-rule-core';
import {
  findBalancedCallEnd,
  stripComments,
  stripCommentsAndStrings,
} from './effect-source-helpers';

interface RuleContext {
  filename?: string;
  options?: object[];
  report: (descriptor: {
    loc?: { column: number; line: number };
    message: string;
    node: object;
  }) => void;
}

interface RuleSpec {
  ast?: (
    context: RuleContext,
    source: string,
  ) => Record<string, ((node: object) => void) | undefined>;
  check?: (source: string, context: RuleContext) => boolean | number | { index: number };
  message: string;
  name: string;
  patterns?: readonly RegExp[];
  tokenGroups?: readonly (readonly string[])[];
  tokens?: readonly string[];
}

const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);

const globalTimerNames = HashSet.make('clearInterval', 'clearTimeout', 'setInterval', 'setTimeout');

const hasMixedEffectImportStyles = (source: string): boolean =>
  pipe(
    [
      /import\s*{[^}]*\bEffect\b[^}]*}\s*from\s*['"]effect['"]/.test(source),
      /import\s+\*\s+as\s+[A-Za-z_$][\w$]*\s+from\s*['"]effect(?:\/Effect)?['"]/.test(source),
    ],
    Array.every((hasStyle): boolean => hasStyle),
  );

const tryCatchIndexInEffectGenBody = (code: string, matchIndex: number): number | undefined => {
  const openParenIndex = code.indexOf('(', matchIndex);
  return Match.value(openParenIndex).pipe(
    Match.when(-1, (): undefined => undefined),
    Match.orElse((parenIndex): number | undefined => {
      const bodyStart = parenIndex + 1;
      const body = code.slice(bodyStart, findBalancedCallEnd(code, parenIndex));
      return pipe(
        Option.fromNullable(/\btry\s*{[\s\S]*?\bcatch\s*\(/.exec(body)?.index),
        Option.map((index): number => bodyStart + index),
        Option.getOrUndefined,
      );
    }),
  );
};

const hasTryCatchInEffectGen = (source: string): number | false => {
  const code = stripCommentsAndStrings(source);
  const aliases = pipe(effectImportAliases(source), Array.map(escapeRegExp), Array.join('|'));
  return Match.value(aliases).pipe(
    Match.when('', (): false => false),
    Match.orElse((value): number | false =>
      pipe(
        Array.fromIterable(code.matchAll(new RegExp(`\\b(?:${value})\\.gen\\s*\\(`, 'g'))),
        Array.findFirst(
          (match): boolean => tryCatchIndexInEffectGenBody(code, match.index) !== undefined,
        ),
        Option.flatMap((match) =>
          Option.fromNullable(tryCatchIndexInEffectGenBody(code, match.index)),
        ),
        Option.getOrElse((): false => false),
      ),
    ),
  );
};

const hasNativeErrorClassInEffectModule = (source: string): number | false =>
  Match.value(hasEffectSignal(source)).pipe(
    Match.when(false, (): false => false),
    Match.orElse((): number | false =>
      pipe(
        Option.fromNullable(
          /\bclass\s+[A-Z][\w$]*\s+extends\s+Error\b/.exec(stripCommentsAndStrings(source))?.index,
        ),
        Option.getOrElse((): false => false),
      ),
    ),
  );

const hasUnsafeEffectTypeAssertion = (source: string): number | false => {
  const code = stripCommentsAndStrings(source);
  return pipe(
    Option.fromNullable(/\bas\s+Effect\.Effect\s*<[^>]*>/.exec(code)?.index),
    Option.getOrElse((): false => false),
  );
};

const serviceMismatchIndex = (code: string, pattern: RegExp): number | undefined =>
  pipe(
    Array.fromIterable(code.matchAll(pattern)),
    Array.findFirst((match): boolean => match[1] !== match[2]),
    Option.flatMap((match) => Option.fromNullable(match.index)),
    Option.getOrUndefined,
  );

const hasServiceSelfMismatch = (source: string): number | false => {
  const code = stripComments(source);
  const contextTagPattern =
    /\bclass\s+([A-Z][\w$]*)\s+extends\s+Context\.Tag\s*<\s*([A-Z][\w$]*)\s*>/g;
  const contextTagIndex = serviceMismatchIndex(code, contextTagPattern);
  return pipe(
    Option.fromNullable(contextTagIndex),
    Option.match({
      onNone: (): number | false => {
        const servicePattern =
          /\bclass\s+([A-Z][\w$]*)\s+extends\s+Effect\.Service\s*<\s*([A-Z][\w$]*)\s*>/g;
        return pipe(
          Option.fromNullable(serviceMismatchIndex(code, servicePattern)),
          Option.getOrElse((): false => false),
        );
      },
      onSome: (index): number => index,
    }),
  );
};

const hasEffectFnIIFE = (source: string): number | false => {
  const code = stripCommentsAndStrings(source);
  return pipe(
    Option.fromNullable(
      /\bEffect\.fn(?:Untraced|UntracedEager)?\s*\([^)]*\)\s*\([^)]*\)/.exec(code)?.index,
    ),
    Option.getOrElse((): false => false),
  );
};

const reportWhen = (
  condition: boolean,
  context: RuleContext,
  message: string,
  node: object,
): void =>
  pipe(
    Match.value(condition),
    Match.when(true, (): void => {
      reportAST(context, message, node);
    }),
    Match.orElse((): void => undefined),
  );

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const effectDefaultCompatibilitySpecs = [
  {
    message:
      'Import Effect APIs from the main effect package; deprecated split packages are blocked.',
    name: 'effect-no-obsolete-imports',
    patterns: [/from\s+['"]@effect\/(?:io|data)['"]/],
    tokens: ['@effect/io', '@effect/data'],
  },
  {
    check: (source): boolean =>
      /\bEffect\.(?:fromPromise|tryCatch|bracket|fromEither)\s*\(/.test(
        stripCommentsAndStrings(source),
      ),
    message: 'This is not a known Effect API for the configured version.',
    name: 'effect-no-known-fake-api',
    tokens: ['fromPromise', 'tryCatch', 'bracket', 'fromEither'],
  },
  {
    message: 'Prefer Effect.gen over Effect.Do for agent-readable sequential workflows.',
    name: 'effect-prefer-gen-over-do',
    patterns: [/\bEffect\.Do\b/],
    tokens: ['Effect.Do'],
  },
  {
    message: 'Use direct yield* effect style instead of adapter-style Effect.gen helpers.',
    name: 'effect-prefer-direct-yield-star',
    patterns: [/Effect\.gen\s*\(\s*function\*\s*\(\s*\$\s*\)/],
    tokenGroups: [['gen'], ['$']],
  },
  {
    message:
      'Use Config.redacted for sensitive config values so secrets stay redacted in logs and errors.',
    name: 'effect-prefer-config-redacted',
    patterns: [/Config\.(?:secret|Secret)\s*\(/],
    tokens: ['secret', 'Secret'],
  },
  {
    message: 'Use Schema from effect/Schema instead of @effect/schema.',
    name: 'effect-no-deprecated-schema-package',
    patterns: [/from\s+['"]@effect\/schema['"]/],
    tokens: ['@effect/schema'],
  },
  {
    message: 'Use the current Context.Tag class/service pattern instead of deprecated tag helpers.',
    name: 'effect-no-deprecated-context-tag-function',
    patterns: [
      /\b(?:const|let|var)\s+[A-Z][\w$]*\s*=\s*Context\.Tag(?:<[^>]+>)?\s*\(\s*['"][^'"]+['"]\s*\)/,
      /(?:^|[;\n]\s*)Context\.Tag(?:<[^>]+>)?\s*\(\s*['"][^'"]+['"]\s*\)/,
    ],
    tokens: ['Context.Tag'],
  },
  {
    message: 'Use domain-specific tagged errors instead of the global Error type channel.',
    name: 'effect-no-global-error-channel',
    patterns: [/Effect\.Effect\s*<[^,>]+,\s*Error\s*[,>]/],
    tokenGroups: [['Effect.Effect'], ['Error']],
  },
  {
    message: 'Use Duration constructors or string durations instead of naked millisecond numbers.',
    name: 'effect-use-duration-constructors',
    patterns: [
      /Effect\.(?:sleep|timeout|delay)\s*\(\s*\d+\s*\)/,
      /Effect\.(?:timeout|delay)\s*\([^,]+,\s*\d+\s*\)/,
    ],
    tokens: ['sleep', 'timeout', 'delay'],
  },
  {
    check: hasMixedEffectImportStyles,
    message: 'Use one Effect import style per file.',
    name: 'effect-no-mixed-effect-import-styles',
    tokens: ['import'],
  },
  {
    message: 'Use Effect.isEffect for Effect type checks.',
    name: 'effect-prefer-effect-is',
    patterns: [/\b[A-Za-z_$][\w$]*\s+instanceof\s+Effect\b/, /\._op\s*===\s*['"]Effect['"]/],
    tokens: ['instanceof', '_op'],
  },
  {
    ast: (context, source): Record<string, (node: object) => void> => ({
      TryStatement(node): void {
        const { start } = node as { start?: number };
        pipe(
          Match.value(typeof start).pipe(
            Match.when('number', (): number | undefined => start),
            Match.orElse((): undefined => undefined),
          ),
          Option.fromNullable,
          Option.match({
            onNone: (): void => undefined,
            onSome: (nodeStart): void => {
              const index = hasTryCatchInEffectGen(source);
              reportWhen(
                typeof index === 'number' && index === nodeStart,
                context,
                'Use Effect error combinators instead of try/catch inside Effect.gen.',
                node,
              );
            },
          }),
        );
      },
    }),
    message: 'Use Effect error combinators instead of try/catch inside Effect.gen.',
    name: 'effect-no-try-catch-in-effect-gen',
    tokenGroups: [['gen'], ['try']],
  },
  {
    ast: (context, source): Record<string, (node: object) => void> => {
      const isEffectModule = hasEffectSignal(source);
      return {
        NewExpression(node): void {
          reportWhen(
            isEffectModule && identifierName(objectValue(node, 'callee')) === 'Promise',
            context,
            'Use Effect.async, Effect.promise, or Effect.tryPromise instead of new Promise.',
            node,
          );
        },
      };
    },
    message: 'Use Effect.async, Effect.promise, or Effect.tryPromise instead of new Promise.',
    name: 'effect-no-new-promise',
    tokenGroups: [['Promise'], ['Effect', 'effect']],
  },
  {
    ast: (context, source): Record<string, (node: object) => void> => {
      const isEffectModule = hasEffectSignal(source);
      return {
        CallExpression(node): void {
          const calleeName = identifierName(objectValue(node, 'callee'));
          reportWhen(
            isEffectModule && calleeName !== undefined && HashSet.has(globalTimerNames, calleeName),
            context,
            'Use Effect.sleep, Schedule, or Clock instead of global timers in Effect modules.',
            node,
          );
        },
      };
    },
    message: 'Use Effect.sleep, Schedule, or Clock instead of global timers in Effect modules.',
    name: 'effect-no-global-timers',
    tokens: ['setTimeout', 'setInterval', 'clearTimeout', 'clearInterval'],
  },
  {
    ast: (context, source): Record<string, (node: object) => void> => {
      const isEffectModule = hasEffectSignal(source);
      return {
        ClassDeclaration(node): void {
          reportWhen(
            isEffectModule && identifierName(objectValue(node, 'superClass')) === 'Error',
            context,
            'Use tagged/data/schema errors instead of classes extending native Error.',
            node,
          );
        },
      };
    },
    check: hasNativeErrorClassInEffectModule,
    message: 'Use tagged/data/schema errors instead of classes extending native Error.',
    name: 'effect-no-native-error-classes',
    tokens: ['Error'],
  },
  {
    ast: (context): Record<string, (node: object) => void> => ({
      TSAsExpression(node): void {
        reportWhen(
          typeReferenceName(objectValue(node, 'typeAnnotation')) === 'Effect.Effect',
          context,
          'Do not assert Effect error or requirement channels with type casts.',
          node,
        );
      },
    }),
    check: hasUnsafeEffectTypeAssertion,
    message: 'Do not assert Effect error or requirement channels with type casts.',
    name: 'effect-no-unsafe-effect-type-assertion',
    tokenGroups: [[' as '], ['Effect.Effect']],
  },
  {
    ast: (context, source): Record<string, (node: object) => void> => ({
      ClassDeclaration(node): void {
        const className = identifierName(objectValue(node, 'id'));
        const selfName = effectServiceSelfName(objectValue(node, 'superClass'), source);
        reportWhen(
          className !== undefined && selfName !== undefined && className !== selfName,
          context,
          'Effect service/tag self type must match the declaring class name.',
          node,
        );
      },
    }),
    check: hasServiceSelfMismatch,
    message: 'Effect service/tag self type must match the declaring class name.',
    name: 'effect-require-service-self-match',
    tokenGroups: [['class'], ['extends'], ['Context', 'Service', 'Tag']],
  },
  {
    ast: (context, source): Record<string, (node: object) => void> => {
      const isEffectFn = effectCallPredicate(source, ['fn', 'fnUntraced', 'fnUntracedEager']);
      return {
        CallExpression(node): void {
          const outerCallee = objectValue(node, 'callee');
          const middleCallee = objectValue(outerCallee, 'callee');
          const innerCallee = objectValue(middleCallee, 'callee');
          reportWhen(
            nodeType(outerCallee) === 'CallExpression' &&
              nodeType(middleCallee) === 'CallExpression' &&
              isEffectFn(innerCallee),
            context,
            'Do not call Effect.fn as an IIFE; use Effect.gen for local one-shot workflows.',
            node,
          );
        },
      };
    },
    check: hasEffectFnIIFE,
    message: 'Do not call Effect.fn as an IIFE; use Effect.gen for local one-shot workflows.',
    name: 'effect-no-effect-fn-iife',
    tokenGroups: [['fn'], ['Effect', 'effect']],
  },
] satisfies readonly RuleSpec[];
