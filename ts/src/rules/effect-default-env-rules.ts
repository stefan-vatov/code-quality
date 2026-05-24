/**
 * Environment, schema, resource, and test Effect rule specs.
 *
 * @internal
 */
import {
  hasCastAfterSchemaDecode,
  hasExternalJSONWithoutDecodeUnknown,
  hasForkDaemonWithoutCleanup,
  hasForkInUninterruptibleWithoutRestore,
  hasJSONParsedBeforeSchemaStringDecode,
  hasParsedJSONNumberFromString,
  hasSchemaPromiseDecode,
  hasSchemaSyncDecodeInEffectWorkflow,
  hasUnboundedEffectConcurrency,
  hasUnboundedFlatMapConcurrency,
  hasUnhandledSchemaEffectDecode,
} from './effect-default-helpers';
import { hasEffectSignal, hasRuntimeCall } from './effect-rule-core';
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
import { isConfiguredPath, isEffectTestPath } from './effect-path-options';
import { memberParts, objectValue, reportAST } from './effect-default-ast';
import { stripCommentsAndStrings } from './effect-source-helpers';

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

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const effectDefaultEnvironmentSpecs = [
  {
    ast: (context, source): Record<string, (node: object) => void> => {
      const isEffectModule = hasEffectSignal(source);
      const isConfigLayer = isConfiguredPath(context, 'configLayers');
      return {
        MemberExpression(node): void {
          const { objectName, propertyName } = memberParts(node);
          const processEnv = objectName === 'process' && propertyName === 'env';
          if (isEffectModule && !isConfigLayer && processEnv) {
            reportAST(context, 'Use Effect Config instead of process.env in Effect code.', node);
          }
        },
      };
    },
    message: 'Use Effect Config instead of process.env in Effect code.',
    name: 'effect-no-process-env-in-effect-code',
    tokens: ['process'],
  },
  {
    ast: (context, source): Record<string, (node: object) => void> => {
      const isEffectModule = hasEffectSignal(source);
      const isAdapterLayer = isConfiguredPath(context, 'adapterLayers');
      return {
        CallExpression(node): void {
          const { objectName, propertyName } = memberParts(objectValue(node, 'callee'));
          if (
            isEffectModule &&
            !isAdapterLayer &&
            objectName === 'Date' &&
            propertyName === 'now'
          ) {
            reportAST(context, 'Use Effect Clock instead of Date.now in Effect code.', node);
          }
        },
      };
    },
    message: 'Use Effect Clock instead of Date.now in Effect code.',
    name: 'effect-no-date-now-in-effect-code',
    tokens: ['Date'],
  },
  {
    ast: (context, source): Record<string, (node: object) => void> => {
      const isEffectModule = hasEffectSignal(source);
      const isAdapterLayer = isConfiguredPath(context, 'adapterLayers');
      return {
        CallExpression(node): void {
          const { objectName, propertyName } = memberParts(objectValue(node, 'callee'));
          if (
            isEffectModule &&
            !isAdapterLayer &&
            objectName === 'Math' &&
            propertyName === 'random'
          ) {
            reportAST(context, 'Use Effect Random instead of Math.random in Effect code.', node);
          }
        },
      };
    },
    message: 'Use Effect Random instead of Math.random in Effect code.',
    name: 'effect-no-math-random-in-effect-code',
    tokens: ['Math'],
  },
  {
    message: 'Decode external JSON with Schema instead of casting parsed unknown data.',
    name: 'effect-no-json-parse-cast',
    patterns: [
      /\bJSON\.parse\s*\([^)]*\)\s+as\s+[A-Za-z_$][\w$]*/,
      /\.json\s*\(\s*\)\s+as\s+[A-Za-z_$][\w$]*/,
    ],
    tokenGroups: [[' as '], ['JSON.parse', '.json']],
  },
  {
    check: hasSchemaPromiseDecode,
    message: 'Use Schema.decodeUnknown to decode unknown input into the Effect error channel.',
    name: 'effect-schema-prefer-decodeUnknown-effect',
    tokens: ['decode'],
  },
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
    check: hasSchemaSyncDecodeInEffectWorkflow,
    message: 'Do not use throwing synchronous Schema decoders in Effect modules.',
    name: 'effect-schema-no-unsafe-sync-decode-in-effect-code',
    tokens: ['decodeSync', 'decodeUnknownSync'],
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
    message: 'Prefer Schema.TaggedClass over hand-written _tag fields.',
    name: 'effect-schema-prefer-taggedClass-over-manual-tag',
    patterns: [/Schema\.Struct\s*\(\s*{[\s\S]*?_tag\s*:\s*Schema\.Literal/],
    tokens: ['_tag'],
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
    message: 'Long-running listeners should use forkScoped so they follow Scope lifetime.',
    name: 'effect-prefer-fork-scoped-for-listeners',
    patterns: [
      /Effect\.fork\s*\([\s\S]*?\b(?:listen[A-Z]\w*|subscribe[A-Z]\w*|watch[A-Z]\w*|listen|subscribe|watch)\b/,
    ],
    tokens: ['fork'],
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
    check: (source, context): boolean => isEffectTestPath(context) && hasRuntimeCall(source),
    message: 'Use @effect/vitest it.effect instead of manually running Effects in tests.',
    name: 'effect-test-no-runpromise',
    tokens: ['run'],
  },
  {
    check: (source, context): boolean =>
      isEffectTestPath(context) &&
      !hasRuntimeCall(source) &&
      /\bit\s*\([\s\S]*?Effect\./.test(stripCommentsAndStrings(source)),
    message: 'Use it.effect for tests that exercise Effect programs.',
    name: 'effect-prefer-it-effect-for-unit-tests',
    tokens: ['it('],
  },
  {
    check: (source): boolean =>
      /TestClock\.adjust\s*\(/.test(stripCommentsAndStrings(source)) &&
      !hasForkBeforeTestClockAdjust(source),
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
    check: (source, context): boolean =>
      isEffectTestPath(context) &&
      !hasRuntimeCall(source) &&
      /\b(?:rejects|toThrow)\b/.test(stripCommentsAndStrings(source)) &&
      /\bEffect\./.test(stripCommentsAndStrings(source)),
    message: 'Use Effect.exit inside it.effect when asserting Effect failures.',
    name: 'effect-use-exit-for-failure-tests',
    tokens: ['rejects', 'toThrow'],
  },
  {
    check: (source, context): boolean =>
      isEffectTestPath(context) &&
      /\b(?:it|describe)\.effect\.only\s*\(/.test(stripCommentsAndStrings(source)),
    message: 'Focused Effect tests must not be committed.',
    name: 'effect-no-focused-effect-tests',
    tokens: ['.only'],
  },
  {
    check: (source, context): boolean =>
      isEffectTestPath(context) &&
      /\b(?:it|describe)\.effect\.skip\s*\(/.test(stripCommentsAndStrings(source)),
    message: 'Skipped Effect tests must not be committed.',
    name: 'effect-no-skipped-effect-tests',
    tokens: ['.skip'],
  },
] satisfies readonly RuleSpec[];
