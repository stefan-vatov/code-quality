/* -------------------------------------------------------------------------- */
/*         Environment, schema, resource, and test Effect rule specs.         */
/* -------------------------------------------------------------------------- */
import {
  hasCastAfterSchemaDecode,
  hasExternalJSONWithoutDecodeUnknown,
  hasForkDaemonWithoutCleanup,
  hasForkInUninterruptibleWithoutRestore,
  hasJSONParsedBeforeSchemaStringDecode,
  hasParsedJSONNumberFromString,
  hasUnboundedEffectConcurrency,
  hasUnboundedFlatMapConcurrency,
  hasUnhandledSchemaEffectDecode,
} from './effect-default-helpers';
import {
  hasForkBeforeTestClockAdjust,
  hasRealSleepWithoutTestClock,
  hasTestClockWithoutEffectContext,
} from './effect-default-test-helpers';
import {
  hasUnreleasedAcquire,
  hasUnscopedAcquireRelease,
  hasUnscopedResourceWorkflow,
} from './effect-default-resource-helpers';
import { isEffectTestPath } from './effect-path-options';
import { stripCommentsAndStrings } from './effect-source-helpers';
import type { Context as RuleContext, RuleSpec } from './effect-rule-core';

const hasTestClockAdjustWithoutFork = (source: string): boolean => {
  const code = stripCommentsAndStrings(source);
  return /TestClock\.adjust\s*\(/.test(code) && !hasForkBeforeTestClockAdjust(source);
};

const hasFocusedEffectTest = (source: string, context: RuleContext): boolean =>
  isEffectTestPath(context) &&
  /\b(?:it|describe)\.effect\.only\s*\(/.test(stripCommentsAndStrings(source));

const hasSkippedEffectTest = (source: string, context: RuleContext): boolean =>
  isEffectTestPath(context) &&
  /\b(?:it|describe)\.effect\.skip\s*\(/.test(stripCommentsAndStrings(source));

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const effectDefaultEnvironmentSpecs = [
  {
    check: hasUnhandledSchemaEffectDecode,
    message: 'Schema parsing must expose parse errors through typed Effect handling.',
    name: 'effect-schema-require-parse-error-handling',
    tokens: ['decode'],
  },
  {
    check: hasExternalJSONWithoutDecodeUnknown,
    message: 'External data must enter through Schema.decodeUnknown.',
    name: 'effect-schema-use-decodeUnknown-for-external-data',
    tokens: ['.json'],
  },
  {
    check: hasJSONParsedBeforeSchemaStringDecode,
    message: 'Use Schema.parseJson when decoding JSON strings with Schema.',
    name: 'effect-schema-require-parseJson-for-json-strings',
    tokens: ['JSON.parse'],
  },
  {
    check: hasParsedJSONNumberFromString,
    message: 'Use the correct Schema number type for already-parsed JSON numbers.',
    name: 'effect-schema-correct-number-type-for-parsed-json',
    tokens: ['JSON.parse'],
  },
  {
    message: 'Use current Effect Schema API names instead of obsolete lowercase helpers.',
    name: 'effect-schema-avoid-old-type-names',
    patterns: [/\bSchema\.(?:string|number|boolean|array|object)\s*\(/],
    tokens: ['Schema.'],
  },
  {
    check: hasCastAfterSchemaDecode,
    message: 'Do not cast after Schema decoding; let the schema provide the type.',
    name: 'effect-schema-no-cast-after-decode',
    tokenGroups: [['Schema.decode'], [' as ']],
  },
  {
    check: hasUnreleasedAcquire,
    message: 'Resource acquisition must use acquireRelease, scoped, or equivalent finalization.',
    name: 'effect-require-acquire-release',
    tokens: ['open', 'connect', 'subscribe', 'listen'],
  },
  {
    check: hasUnscopedAcquireRelease,
    message: 'Use Effect.scoped around acquireRelease when exposing acquired resources.',
    name: 'effect-require-scoped-for-acquireRelease',
    tokens: ['acquireRelease'],
  },
  {
    check: hasUnscopedResourceWorkflow,
    message: 'Resourceful workflows must be scoped.',
    name: 'effect-require-scoped-for-resources',
    tokens: ['Socket.', 'Connection.'],
  },
  {
    check: hasForkDaemonWithoutCleanup,
    message: 'Daemon fibers must have cleanup, interruption, or supervision.',
    name: 'effect-no-fork-daemon-without-cleanup',
    tokens: ['forkDaemon'],
  },
  {
    check: hasForkInUninterruptibleWithoutRestore,
    message: 'Use restore when forking inside uninterruptible regions.',
    name: 'effect-require-restore-for-fork-in-uninterruptible',
    tokenGroups: [['uninterruptible'], ['fork']],
  },
  {
    check: hasUnboundedEffectConcurrency,
    message: 'Concurrent Effect traversal must declare an explicit concurrency bound.',
    name: 'effect-require-bounded-concurrency',
    tokens: ['concurrency'],
  },
  {
    check: hasUnboundedFlatMapConcurrency,
    message: 'Concurrent Effect.flatMap usage must declare a bounded concurrency value.',
    name: 'effect-require-bounded-flatMap-concurrency',
    tokenGroups: [['flatMap'], ['concurrency']],
  },
  {
    message: 'Use bounded, sliding, or dropping queues instead of unbounded queues.',
    name: 'effect-no-unbounded-queue',
    patterns: [/\bQueue\.unbounded\s*\(/],
    tokens: ['unbounded'],
  },
  {
    message: 'Stream buffers must be explicitly bounded.',
    name: 'effect-no-unbounded-stream-buffer',
    patterns: [
      /\bStream\.(?:buffer|fromQueue|async|asyncPush)\s*\([^)]*\b(?:Infinity|unbounded)\b/,
    ],
    tokens: ['unbounded', 'Infinity'],
  },
  {
    check: (source, context): boolean =>
      isEffectTestPath(context) && hasTestClockAdjustWithoutFork(source),
    message: 'Fork time-dependent work before adjusting TestClock.',
    name: 'effect-testClock-requires-fork',
    tokens: ['TestClock.adjust'],
  },
  {
    check: (source, context): boolean =>
      isEffectTestPath(context) && hasTestClockWithoutEffectContext(source),
    message: 'Use Effect test context when using TestClock.',
    name: 'effect-testClock-requires-testContext',
    tokens: ['TestClock'],
  },
  {
    check: (source, context): boolean =>
      isEffectTestPath(context) && hasRealSleepWithoutTestClock(source),
    message: 'Use TestClock instead of real sleeps in Effect tests.',
    name: 'effect-no-real-sleep-in-tests',
    tokens: ['sleep'],
  },
  {
    check: hasFocusedEffectTest,
    message: 'Focused Effect tests must not be committed.',
    name: 'effect-no-focused-effect-tests',
    tokens: ['.only'],
  },
  {
    check: hasSkippedEffectTest,
    message: 'Skipped Effect tests must not be committed.',
    name: 'effect-no-skipped-effect-tests',
    tokens: ['.skip'],
  },
] satisfies readonly RuleSpec[];
