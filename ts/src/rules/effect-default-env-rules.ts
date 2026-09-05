import {
  hasForkDaemonWithoutCleanup,
  hasForkInUninterruptibleWithoutRestore,
  hasUnboundedEffectConcurrency,
  hasUnboundedFlatMapConcurrency,
} from './effect-default-helpers';
import {
  hasUnreleasedAcquire,
  hasUnscopedAcquireRelease,
  hasUnscopedResourceWorkflow,
} from './effect-default-resource-helpers';
import { isEffectTestPath } from './effect-path-options';
import { stripCommentsAndStrings } from './effect-source-helpers';
import type { Context as RuleContext, RuleSpec } from './effect-rule-core';

const hasFocusedEffectTest = (source: string, context: RuleContext): boolean =>
  isEffectTestPath(context) &&
  /\b(?:it|describe)\.effect\.only\s*\(/.test(stripCommentsAndStrings(source));

const hasSkippedEffectTest = (source: string, context: RuleContext): boolean =>
  isEffectTestPath(context) &&
  /\b(?:it|describe)\.effect\.skip\s*\(/.test(stripCommentsAndStrings(source));

export const effectDefaultEnvironmentSpecs = [
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
