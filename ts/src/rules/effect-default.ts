/**
 * Always-on custom Effect lint rule definitions.
 *
 * @internal
 */
import {
  arrayValue,
  effectCallPredicate,
  identifierName,
  isStringLikeLiteral,
  memberParts,
  nodeType,
  objectValue,
  propertyKeyName,
  reportAST,
} from './effect-default-ast';
import {
  exportedCallableDeclarationSegments,
  exportedDeclarationSegments,
  stripCommentsAndStrings,
} from './effect-source-helpers';
import {
  hasAsyncAwaitInEffect,
  hasBroadCatchAllWithoutRethrow,
  hasEffectInArrayForEach,
  hasEffectInPromiseCallback,
  hasErrorMappingWithoutCause,
  hasFloatingEffect,
  hasMultipleCatchTagsInOnePipe,
  hasNestedFlatMap,
  hasRecursiveEffectWithoutSuspend,
  hasReturnEffectInGen,
  hasRunForkWithoutObserver,
  hasRuntimeInEffect,
  hasSyncForPromise,
  hasSyncForThrowingOPS,
  hasThrowInEffect,
  hasTryPromiseWithoutTypedCatch,
  hasUnloggedIgnore,
  hasUnobservedFork,
  hasUnsafeLazyEvaluation,
  hasYieldWithoutStarInGen,
} from './effect-default-helpers';
import { hasEffectSignal, makeRules } from './effect-rule-core';
import { effectDefaultCompatibilitySpecs } from './effect-default-compat-rules';
import { effectDefaultEnvironmentSpecs } from './effect-default-env-rules';
import { strictPathOptionsSchema } from './effect-path-options';

type RuleSpec = Parameters<typeof makeRules>[0][number];
type ASTValue = boolean | null | number | object | string | undefined;
const effectDefaultRuleTokens = [
  'Effect',
  'Schema',
  'Config',
  'Context',
  'Queue',
  'Stream',
  'TestClock',
  'from "effect"',
  "from 'effect'",
  '@effect/',
  '"effect/',
  "'effect/",
  'it.effect',
  'describe.effect',
  'JSON.parse',
  'response.json',
] as const;

const hasStringErrorFailure = (source: string): number | false => {
  const match = /\bEffect\.fail\s*\(\s*["'`]/.exec(stripCommentsAndStrings(source));
  return match?.index ?? false;
};

const hasUntaggedErrorFailure = (source: string): number | false => {
  const code = stripCommentsAndStrings(source);
  const nativeErrorMatch = /\bEffect\.fail\s*\(\s*new\s+Error\s*\(/.exec(code);
  if (nativeErrorMatch) {
    return nativeErrorMatch.index;
  }

  const objectErrorMatch = /\bEffect\.fail\s*\(\s*{(?![^}]*\b_tag\s*:)/.exec(code);
  return objectErrorMatch?.index ?? false;
};

const isUntaggedErrorFailureArgument = (firstArg: ASTValue): boolean => {
  if (
    nodeType(firstArg) === 'NewExpression' &&
    identifierName(objectValue(firstArg, 'callee')) === 'Error'
  ) {
    return true;
  }
  return (
    nodeType(firstArg) === 'ObjectExpression' &&
    !arrayValue(objectValue(firstArg, 'properties')).some(
      (property): boolean => propertyKeyName(objectValue(property, 'key')) === '_tag',
    )
  );
};

const effectDefaultSpecs = [
  {
    check: hasFloatingEffect,
    message: 'Return, yield, assign, or compose Effect values; bare Effect calls never execute.',
    name: 'effect-no-floating-effect',
  },
  {
    check: hasYieldWithoutStarInGen,
    message: 'Use yield* inside Effect.gen so generator composition unwraps the Effect value.',
    name: 'effect-require-yield-star',
    tokenGroups: [['gen'], ['yield']],
  },
  {
    check: hasReturnEffectInGen,
    message: 'Do not return an Effect from Effect.gen; return a value or return yield* the Effect.',
    name: 'effect-require-return-yield-star',
    tokenGroups: [['gen'], ['return']],
  },
  {
    check: hasNestedFlatMap,
    message: 'Replace nested Effect.flatMap callbacks with Effect.gen for readable sequencing.',
    name: 'effect-prefer-gen-for-nested-flatmap',
    tokens: ['flatMap'],
  },
  {
    check: (source): boolean =>
      exportedCallableDeclarationSegments(source).some((segment): boolean =>
        /(?:^|\breturn\s+)Effect\.gen\s*\(/.test(segment.trim()),
      ),
    message: 'Use Effect.fn for exported effectful functions instead of returning Effect.gen.',
    name: 'effect-no-function-returning-gen',
    tokens: ['gen'],
  },
  {
    check: (source): boolean =>
      exportedCallableDeclarationSegments(source).some((segment): boolean =>
        /(?:^|\breturn\s+)Effect\.(?!fn\b|gen\b|isEffect\b|serviceFunction\b|runPromise\b)/.test(
          segment.trim(),
        ),
      ),
    message: 'Exported effectful functions should use Effect.fn for tracing and stable contracts.',
    name: 'effect-prefer-effect-fn-for-exported-effects',
    tokens: ['export'],
  },
  {
    message: 'Do not wrap a single Effect in Effect.gen when direct composition is clearer.',
    name: 'effect-no-unnecessary-gen',
    patterns: [/Effect\.gen\s*\(\s*function\*\s*\([^)]*\)\s*{\s*return\s+yield\*\s+Effect\./],
    tokenGroups: [['gen'], ['yield']],
  },
  {
    check: hasEffectInArrayForEach,
    message: 'Use Effect.forEach instead of Array.forEach with Effect-returning callbacks.',
    name: 'effect-no-effect-in-array-foreach',
    tokens: ['forEach'],
  },
  {
    check: hasEffectInPromiseCallback,
    message:
      'Do not create Effect values inside Promise callbacks; compose at the Effect boundary.',
    name: 'effect-no-effect-in-promise-callback',
    tokens: ['.then', '.catch'],
  },
  {
    check: hasUnobservedFork,
    message: 'Forked fibers must be joined, interrupted, scoped, supervised, or returned.',
    name: 'effect-no-floating-fiber',
    tokens: ['fork'],
  },
  {
    check: hasRecursiveEffectWithoutSuspend,
    message: 'Recursive Effect construction must be wrapped in Effect.suspend.',
    name: 'effect-require-suspend-for-recursion',
    tokens: ['function', '=>'],
  },
  {
    check: hasUnsafeLazyEvaluation,
    message: 'Use Effect.suspend when Effect construction must defer eager JavaScript work.',
    name: 'effect-require-suspend-for-lazy-evaluation',
    tokens: ['Date.now', 'Math.random', 'new Date', 'JSON.parse'],
  },
  {
    check: hasAsyncAwaitInEffect,
    message:
      'Use Effect.tryPromise or Effect.promise boundaries instead of async/await in Effect code.',
    name: 'effect-no-async-await-in-effect',
    tokens: ['async', 'await'],
  },
  {
    ast: (context, source): Record<string, (node: object) => void> => {
      const isEffectModule = hasEffectSignal(source);
      return {
        CallExpression(node): void {
          if (!isEffectModule) {
            return;
          }
          const { propertyName } = memberParts(objectValue(node, 'callee'));
          if (propertyName === 'then' || propertyName === 'catch') {
            reportAST(
              context,
              'Use Effect combinators instead of Promise then/catch chains in Effect modules.',
              node,
            );
          }
        },
      };
    },
    message: 'Use Effect combinators instead of Promise then/catch chains in Effect modules.',
    name: 'effect-no-promise-then-in-effect',
    tokens: ['.then', '.catch'],
  },
  {
    check: hasThrowInEffect,
    message: 'Use typed Effect failures instead of throw inside Effect workflows.',
    name: 'effect-no-throw',
    tokens: ['throw'],
  },
  {
    ast: (context, source): Record<string, (node: object) => void> => {
      const isEffectFail = effectCallPredicate(source, ['fail']);
      return {
        CallExpression(node): void {
          const callArguments = arrayValue(objectValue(node, 'arguments'));
          if (isEffectFail(objectValue(node, 'callee')) && isStringLikeLiteral(callArguments[0])) {
            reportAST(context, 'Use structured tagged errors instead of string failures.', node);
          }
        },
      };
    },
    check: hasStringErrorFailure,
    message: 'Use structured tagged errors instead of string failures.',
    name: 'effect-no-string-errors',
    tokens: ['fail'],
  },
  {
    ast: (context, source): Record<string, (node: object) => void> => {
      const isEffectFail = effectCallPredicate(source, ['fail']);
      return {
        CallExpression(node): void {
          const callArguments = arrayValue(objectValue(node, 'arguments'));
          const [firstArg] = callArguments;
          if (!isEffectFail(objectValue(node, 'callee'))) {
            return;
          }
          if (!firstArg) {
            return;
          }
          if (isUntaggedErrorFailureArgument(firstArg)) {
            reportAST(
              context,
              'Use tagged/data/schema errors in Effect.fail instead of global Error values.',
              node,
            );
          }
        },
      };
    },
    check: hasUntaggedErrorFailure,
    message: 'Use tagged/data/schema errors in Effect.fail instead of global Error values.',
    name: 'effect-no-untagged-errors',
    tokens: ['fail'],
  },
  {
    message:
      'Do not erase Effect failures without recovery, logging, or explicit typed replacement.',
    name: 'effect-no-silent-error-swallowing',
    patterns: [
      /Effect\.(?:catchAll|ignore)\s*\([\s\S]*?(?:Effect\.void|Effect\.succeed\s*\(\s*undefined|undefined)/,
    ],
    tokens: ['catchAll', 'ignore'],
  },
  {
    check: hasTryPromiseWithoutTypedCatch,
    message:
      'Use Effect.tryPromise({ try, catch }) so Promise failures become typed Effect errors.',
    name: 'effect-require-typed-error-in-trypromise',
    tokens: ['tryPromise'],
  },
  {
    check: hasBroadCatchAllWithoutRethrow,
    message: 'Prefer catchTag or catchTags over broad catchAll recovery.',
    name: 'effect-prefer-catchTag-over-catchAll',
    tokens: ['catchAll'],
  },
  {
    message: 'Use mapError directly instead of catchAll when only transforming the error.',
    name: 'effect-no-catchAll-with-mapError',
    patterns: [/Effect\.catchAll\s*\([\s\S]*?=>\s*Effect\.fail\s*\(/],
    tokens: ['catchAll'],
  },
  {
    message: 'Use Effect.mapError instead of catchAll followed by fail.',
    name: 'effect-prefer-mapError-over-catchAll-rethrow',
    patterns: [/(?:^|[^\w$.])catchAll\s*\([\s\S]*?=>\s*Effect\.fail\s*\(/],
    tokens: ['catchAll'],
  },
  {
    check: hasErrorMappingWithoutCause,
    message: 'Preserve the original cause when mapping or wrapping Effect errors.',
    name: 'effect-require-error-cause-preserved',
    tokens: ['mapError', 'catchAll'],
  },
  {
    check: hasUnloggedIgnore,
    message: 'Ignored Effect failures must be logged or otherwise observable.',
    name: 'effect-prefer-ignore-logged',
    tokens: ['ignore'],
  },
  {
    check: hasMultipleCatchTagsInOnePipe,
    message: 'Use Effect.catchTags for multiple tagged Effect recoveries.',
    name: 'effect-prefer-catchTags-for-multiple-tags',
    tokens: ['catchTag'],
  },
  {
    message: 'Do not widen Effect error channels to unknown.',
    name: 'effect-no-error-channel-widening-to-unknown',
    patterns: [/Effect\s*<[^>]*,\s*unknown\b/, /Effect\.fail\s*<\s*unknown\b/],
    tokens: ['unknown'],
  },
  {
    check: hasRuntimeInEffect,
    message: 'Do not run an Effect from inside another Effect; yield or compose it instead.',
    name: 'effect-no-run-inside-effect',
    tokens: ['run'],
  },
  {
    check: (source): boolean =>
      exportedDeclarationSegments(source).some((segment): boolean =>
        /Effect\.runPromise\s*\(/.test(segment),
      ),
    message:
      'Exported APIs should expose Effect values instead of hiding execution behind Promise.',
    name: 'effect-no-runpromise-in-exported-api',
    tokens: ['runPromise'],
  },
  {
    check: hasRunForkWithoutObserver,
    message: 'Do not call runFork without explicit observation, supervision, or interruption.',
    name: 'effect-no-runfork-without-observer',
    tokens: ['runFork'],
  },
  {
    check: hasSyncForPromise,
    message: 'Use Effect.tryPromise for Promise-returning code instead of Effect.sync.',
    name: 'effect-no-sync-for-promise',
    tokenGroups: [['sync'], ['async', 'fetch', 'Promise.']],
  },
  {
    check: hasSyncForThrowingOPS,
    message: 'Use Effect.try for synchronous code that can throw instead of Effect.sync.',
    name: 'effect-no-sync-for-throwing-ops',
    tokenGroups: [['sync'], ['throw', 'JSON.parse']],
  },
  {
    ast: (context, source): Record<string, (node: object) => void> => {
      const isEffectModule = hasEffectSignal(source);
      return {
        CallExpression(node): void {
          const { objectName, propertyName } = memberParts(objectValue(node, 'callee'));
          if (
            isEffectModule &&
            objectName === 'console' &&
            propertyName &&
            ['debug', 'error', 'info', 'log', 'warn'].includes(propertyName)
          ) {
            reportAST(
              context,
              'Use Effect logging APIs instead of console logging in Effect code.',
              node,
            );
          }
        },
      };
    },
    message: 'Use Effect logging APIs instead of console logging in Effect code.',
    name: 'effect-no-console-log-in-effect-code',
    tokens: ['console'],
  },
  ...effectDefaultEnvironmentSpecs,
  ...effectDefaultCompatibilitySpecs,
] satisfies readonly RuleSpec[];

const effectDefaultRules = makeRules(effectDefaultSpecs, {
  defaultTokens: effectDefaultRuleTokens,
  schema: strictPathOptionsSchema,
});

export default effectDefaultRules;
