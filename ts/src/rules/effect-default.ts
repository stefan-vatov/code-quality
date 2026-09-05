import { effectRecursionAST } from './effect-recursion-ast';
import {
  hasErrorMappingWithoutCause,
  hasFloatingEffect,
  hasRecursiveEffectWithoutSuspend,
  hasReturnEffectInGen,
  hasRunForkWithoutObserver,
  hasTryPromiseWithoutTypedCatch,
  hasUnobservedFork,
  hasYieldWithoutStarInGen,
} from './effect-default-helpers';
import { makeRules } from './effect-rule-core';
import schemaNoRedundantTagIdentifierRule from './effect-schema-no-redundant-tag-identifier';
import { effectDefaultCompatibilitySpecs } from './effect-default-compat-rules';
import { effectDefaultEnvironmentSpecs } from './effect-default-env-rules';
import { strictPathOptionsSchema } from './effect-path-options';

type RuleSpec = Parameters<typeof makeRules>[0][number];
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
    check: hasUnobservedFork,
    message: 'Forked fibers must be joined, interrupted, scoped, supervised, or returned.',
    name: 'effect-no-floating-fiber',
    tokens: ['fork'],
  },
  {
    ast: effectRecursionAST,
    check: hasRecursiveEffectWithoutSuspend,
    message: 'Recursive Effect construction must be wrapped in Effect.suspend.',
    name: 'effect-require-suspend-for-recursion',
    tokens: ['function', '=>'],
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
    message: 'Use mapError directly instead of catchAll when only transforming the error.',
    name: 'effect-no-catchAll-with-mapError',
    patterns: [/Effect\.catchAll\s*\([\s\S]*?=>\s*Effect\.fail\s*\(/],
    tokens: ['catchAll'],
  },
  {
    check: hasErrorMappingWithoutCause,
    message: 'Preserve the original cause when mapping or wrapping Effect errors.',
    name: 'effect-require-error-cause-preserved',
    tokens: ['mapError', 'catchAll'],
  },
  {
    message: 'Do not widen Effect error channels to unknown.',
    name: 'effect-no-error-channel-widening-to-unknown',
    patterns: [/Effect\s*<[^>]*,\s*unknown\b/, /Effect\.fail\s*<\s*unknown\b/],
    tokens: ['unknown'],
  },
  {
    check: hasRunForkWithoutObserver,
    message: 'Do not call runFork without explicit observation, supervision, or interruption.',
    name: 'effect-no-runfork-without-observer',
    tokens: ['runFork'],
  },
  ...effectDefaultEnvironmentSpecs,
  ...effectDefaultCompatibilitySpecs,
] satisfies readonly RuleSpec[];

const effectDefaultRules = {
  ...makeRules(effectDefaultSpecs, {
    defaultTokens: effectDefaultRuleTokens,
    schema: strictPathOptionsSchema,
  }),
  'effect-schema-no-redundant-tag-identifier': schemaNoRedundantTagIdentifierRule,
};

export default effectDefaultRules;
