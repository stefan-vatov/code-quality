/* -------------------------------------------------------------------------- */
/*             Core opt-in strict custom Effect lint rule specs.              */
/* -------------------------------------------------------------------------- */
import { exportedDeclarationTexts, stripCommentsAndStrings } from './effect-source-helpers';
import {
  hasAsyncPushWithoutBuffer,
  hasBoundaryDataWithoutSchema,
  hasCommandHandlerWithoutSchema,
  hasDuplicateLayerInstance,
  hasEnsuringCleanupWithoutOnExit,
  hasExternalEffectWithoutSpan,
  hasExternalEffectWithoutTimeout,
  hasHTTPClientResponseWithoutSchema,
  hasHTTPServerRequestWithoutSchema,
  hasIdempotentExternalEffectWithoutRetry,
  hasLayerFactory,
  hasLiveTestService,
  hasNPlusOneWithoutBatchedResolver,
  hasOutputBoundaryWithoutSchema,
  hasPersistenceReadWithoutSchema,
  hasRealTestService,
  hasSharedMutableStateWithoutRef,
  hasSharedResourceForEachWithoutSemaphore,
  hasTimeCodeWithoutTestClock,
  hasUnbatchedResolver,
  hasUnprovidedServiceInEffectTest,
  hasUnsafeResourceStream,
  hasUnscopedResourceLayer,
  hasUnscopedResourceLoop,
  hasUnterminatedLongRunningStream,
} from './effect-strict-helpers';
import {
  hasDirectPlatformAccess,
  hasEffectSignal,
  hasExportedRunPromiseAPI,
  hasPromiseReturningPublicAPI,
  hasRetryScheduleWithoutJitter,
  hasRunSyncInServerRequestHandler,
  hasRuntimeCall,
  publicAPIDeclarationSignature,
} from './effect-strict-internals';
import { isConfiguredPath, isEffectTestPath, isUnitTestPath } from './effect-path-options';
import type { RuleSpec } from './effect-rule-core';
import { hasRunForkWithoutObserver } from './effect-default-helpers';

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const effectStrictCoreSpecs: readonly RuleSpec[] = [
  {
    check: (source, context): boolean =>
      hasRuntimeCall(source) &&
      !hasExportedRunPromiseAPI(source) &&
      !hasRunForkWithoutObserver(source) &&
      !isEffectTestPath(context) &&
      !isConfiguredPath(context, 'entrypoints'),
    message: 'Run Effect programs only from configured entrypoints.',
    name: 'effect-no-run-outside-entrypoints',
    tokens: ['Effect', 'effect', 'runMain'],
  },
  {
    check: (source, context): boolean =>
      isConfiguredPath(context, 'entrypoints') &&
      /Effect\.run(?:Promise|Sync|Fork)/.test(stripCommentsAndStrings(source)),
    message: 'Entrypoints should use the platform runMain boundary instead of raw Effect runners.',
    name: 'effect-require-platform-runmain-at-entrypoints',
    tokens: ['Effect.run', 'effect/Effect', 'runPromise', 'runSync', 'runFork'],
  },
  {
    check: hasRunSyncInServerRequestHandler,
    message: 'Server handlers must not synchronously run Effects.',
    name: 'effect-no-runSync-in-server-request-handlers',
    tokens: ['Effect.runSync'],
  },
  {
    check: hasPromiseReturningPublicAPI,
    message: 'Public APIs should expose Effect return types instead of Promise.',
    name: 'effect-no-promise-returning-public-api',
    tokens: ['Promise', 'async'],
  },
  {
    check: (source, context): boolean =>
      /\bprocess\s*\.\s*env\b/.test(stripCommentsAndStrings(source)) &&
      !hasEffectSignal(source) &&
      !isConfiguredPath(context, 'configLayers'),
    message: 'Read process.env only inside the configured Effect Config layer.',
    name: 'effect-no-direct-process-env-outside-config-layer',
    tokens: ['process'],
  },
  {
    check: (source, context): boolean =>
      /\b(?:Date\s*\.\s*now|Math\s*\.\s*random)\s*\(/.test(stripCommentsAndStrings(source)) &&
      !hasEffectSignal(source) &&
      !isConfiguredPath(context, 'adapterLayers'),
    message: 'Use Clock and Random services outside configured adapter modules.',
    name: 'effect-no-direct-clock-random-outside-adapters',
    tokens: ['Date', 'Math'],
  },
  {
    check: hasDirectPlatformAccess,
    message: 'Use Effect platform services for HTTP and filesystem access outside adapters.',
    name: 'effect-no-direct-http-fs-outside-platform-services',
    tokens: ['fetch', 'readFileSync', 'writeFileSync', 'createReadStream'],
  },
  {
    message: 'Services must use the configured class-based Effect service pattern.',
    name: 'effect-require-service-class-pattern',
    patterns: [/Context\.GenericTag(?:<[^>]+>)?\s*\(\s*['"`]/],
    tokens: ['Context.GenericTag'],
  },
  {
    message: 'Service tags require stable identifiers.',
    name: 'effect-require-tag-identifier',
    patterns: [
      /Context\.Tag(?:<[^>]+>)?\s*\(\s*\)/,
      /Context\.GenericTag(?:<[^>]+>)?\s*\(\s*\)/,
      /class\s+[A-Z][\w$]*\s+extends\s+Context\.Tag\s*\(\s*\)/,
    ],
    tokens: ['Context.Tag', 'Context.GenericTag'],
  },
  {
    check: (source, context): boolean =>
      isConfiguredPath(context, 'domain') && /Layer\.|Live\b/.test(stripCommentsAndStrings(source)),
    message: 'Domain exports must not leak raw service implementation dependencies.',
    name: 'effect-no-leaked-service-dependencies',
    tokens: ['Layer', 'Live'],
  },
  {
    check: hasDuplicateLayerInstance,
    message: 'Do not construct the same Layer multiple times in one module.',
    name: 'effect-no-duplicate-layer-instances',
    tokens: ['Layer'],
  },
  {
    check: (source, context): boolean =>
      /Effect\.provide|Layer\.provide/.test(stripCommentsAndStrings(source)) &&
      !isConfiguredPath(context, 'compositionRoots'),
    message: 'Provide layers only from configured composition roots.',
    name: 'effect-require-centralized-provision',
    tokens: ['Effect.provide', 'Layer.provide'],
  },
  {
    check: (source, context): boolean =>
      isConfiguredPath(context, 'domain') &&
      /Effect\.provide|Layer\.provide/.test(stripCommentsAndStrings(source)),
    message: 'Domain modules should declare requirements, not provide concrete layers.',
    name: 'effect-no-provide-in-domain-modules',
    tokens: ['Effect.provide', 'Layer.provide'],
  },
  {
    check: hasLayerFactory,
    message:
      'Shared layers should be memoized constants instead of functions that recreate resources.',
    name: 'effect-require-layer-memoization-constant',
    tokens: ['Layer'],
  },
  {
    message: 'Circular layer dependencies must be suspended.',
    name: 'effect-require-suspend-for-circular-deps',
    patterns: [
      /Layer\.(?:effect|scoped)\s*\([\s\S]*?Layer\.(?:effect|scoped)\s*\((?![\s\S]*Effect\.suspend)/,
    ],
    tokens: ['Layer'],
  },
  {
    message: 'Avoid tiny one-off Layer declarations that fragment dependency wiring.',
    name: 'effect-avoid-layer-explosion',
    patterns: [
      /const\s+[A-Za-z_$][\w$]*Layer\s*=\s*Layer\.[\s\S]*const\s+[A-Za-z_$][\w$]*Layer\s*=\s*Layer\./,
    ],
    tokens: ['Layer'],
  },
  {
    message: 'Use Layer.succeed for static pure services.',
    name: 'effect-prefer-succeed-for-static-layers',
    patterns: [/Layer\.effect\s*\([^,]+,\s*Effect\.succeed\s*\(/],
    tokens: ['Layer.effect', 'Effect.succeed'],
  },
  {
    check: hasUnscopedResourceLayer,
    message: 'Layers that allocate resources must be scoped.',
    name: 'effect-require-scoped-for-resource-layers',
    tokens: ['Layer'],
  },
  {
    check: (source, context): boolean =>
      !isConfiguredPath(context, 'adapterLayers') &&
      !isConfiguredPath(context, 'configLayers') &&
      !/Layer\./.test(stripCommentsAndStrings(source)) &&
      /new\s+[A-Z][\w$]*(?:Service|Repo|Client)\s*\(/.test(stripCommentsAndStrings(source)),
    message: 'Construct services inside Layers, not directly in domain or application logic.',
    name: 'effect-no-service-construction-outside-layer',
    tokens: ['Service', 'Repo', 'Client'],
  },
  {
    check: hasBoundaryDataWithoutSchema,
    message: 'Input boundaries must decode request, command, or message data with Schema.',
    name: 'effect-schema-require-validation-at-input-boundaries',
    tokens: ['.body', '.params', '.query', '.payload'],
  },
  {
    check: hasOutputBoundaryWithoutSchema,
    message: 'Output boundaries should encode or validate public response data.',
    name: 'effect-schema-require-validation-at-output-boundaries',
    tokens: ['Response.json', 'return json'],
  },
  {
    check: hasHTTPClientResponseWithoutSchema,
    message: 'HTTP client responses must be decoded with Schema.',
    name: 'effect-schema-require-http-client-response-schema',
    tokens: ['HttpClient.', 'response.json'],
  },
  {
    check: hasHTTPServerRequestWithoutSchema,
    message: 'HTTP server requests must be decoded with Schema.',
    name: 'effect-schema-require-http-server-request-schema',
    tokens: ['HttpRouter.', 'HttpServerRequest'],
  },
  {
    check: (source, context): boolean =>
      isConfiguredPath(context, 'configLayers') &&
      /Config\./.test(stripCommentsAndStrings(source)) &&
      !/Schema\./.test(stripCommentsAndStrings(source)),
    message: 'Configuration modules must decode configuration with Schema.',
    name: 'effect-schema-require-config-schema',
    tokens: ['Config'],
  },
  {
    check: hasPersistenceReadWithoutSchema,
    message: 'Persistence boundaries must validate loaded records with Schema.',
    name: 'effect-schema-require-persistence-schema',
    tokens: ['db.', 'database.', 'collection.', 'repository.'],
  },
  {
    check: hasCommandHandlerWithoutSchema,
    message: 'Public command handlers must declare and use input schemas.',
    name: 'effect-schema-require-public-command-schema',
    tokens: ['handler'],
  },
  {
    check: (source): boolean =>
      exportedDeclarationTexts(source).some((declaration): boolean =>
        /\bunknown\b/.test(stripCommentsAndStrings(publicAPIDeclarationSignature(declaration))),
      ),
    message: 'unknown values must be decoded before crossing configured boundaries.',
    name: 'effect-schema-no-unknown-crossing-boundary',
    tokens: ['unknown'],
  },
  {
    check: (source): boolean => hasExternalEffectWithoutTimeout(source),
    message: 'External effects must declare a timeout.',
    name: 'effect-require-timeout-on-external-effects',
    tokens: ['HttpClient.', 'fetch', 'FileSystem.', 'SqlClient.'],
  },
  {
    check: (source): boolean => hasIdempotentExternalEffectWithoutRetry(source),
    message: 'Idempotent external effects must declare retry policy deliberately.',
    name: 'effect-require-retry-policy-for-idempotent-external-effects',
    tokens: ['HttpClient.', 'fetch', 'find', 'lookup', 'read'],
  },
  {
    check: hasRetryScheduleWithoutJitter,
    message: 'Retry schedules must include jitter.',
    name: 'effect-require-schedule-jitter-for-retries',
    tokenGroups: [['Effect.retry'], ['Schedule.']],
  },
  {
    check: (source): boolean => hasExternalEffectWithoutSpan(source),
    message: 'External effects must declare an observability span.',
    name: 'effect-require-span-external',
    tokens: ['HttpClient.', 'fetch', 'FileSystem.', 'SqlClient.'],
  },
  {
    check: hasSharedResourceForEachWithoutSemaphore,
    message: 'Shared scarce resources must be guarded by Semaphore.',
    name: 'effect-require-semaphore-for-shared-resources',
    tokens: ['Effect.forEach'],
  },
  {
    check: hasSharedMutableStateWithoutRef,
    message: 'Shared mutable state must use Ref, SynchronizedRef, or scoped services.',
    name: 'effect-require-ref-for-shared-mutable-state',
    tokens: ['let '],
  },
  {
    check: hasUnscopedResourceLoop,
    message: 'Loops that acquire resources must scope each acquisition.',
    name: 'effect-require-scoped-in-loops',
    tokens: ['open', 'connect', 'subscribe', 'listen'],
  },
  {
    check: hasEnsuringCleanupWithoutOnExit,
    message: 'Cleanup logic should use onExit so success, failure, and interruption are handled.',
    name: 'effect-require-onExit-for-cleanup',
    tokens: ['Effect.ensuring', 'cleanup'],
  },
  {
    check: hasUnsafeResourceStream,
    message: 'Streams over resources must be scoped or bracketed.',
    name: 'effect-require-stream-resource-safety',
    tokens: ['Stream'],
  },
  {
    check: hasUnterminatedLongRunningStream,
    message: 'Long-running streams must declare termination or shutdown behavior.',
    name: 'effect-require-stream-termination',
    tokens: ['Stream'],
  },
  {
    check: hasAsyncPushWithoutBuffer,
    message: 'Stream.asyncPush must declare an explicit buffer/backpressure policy.',
    name: 'effect-require-explicit-asyncPush-buffer',
    tokens: ['Stream.asyncPush'],
  },
  {
    check: hasUnbatchedResolver,
    message: 'RequestResolver implementations should batch requests.',
    name: 'effect-require-batching-for-resolver',
    tokens: ['RequestResolver'],
  },
  {
    check: hasNPlusOneWithoutBatchedResolver,
    message: 'Potential N+1 data access should use a batched RequestResolver.',
    name: 'effect-use-batched-resolver-for-n-plus-one',
    tokens: ['Effect.forEach'],
  },
  {
    message: 'Use PubSub for broadcast semantics instead of manually fanning out queues.',
    name: 'effect-prefer-pubsub-for-broadcast',
    patterns: [/Queue\.[\s\S]*?\bsubscribers\b|broadcast\s*\([\s\S]*?Queue\./],
    tokens: ['Queue', 'broadcast', 'subscribers'],
  },
  {
    check: (source, context): boolean =>
      isEffectTestPath(context) && hasUnprovidedServiceInEffectTest(source),
    message: 'Effect tests must provide required services explicitly.',
    name: 'effect-require-provided-services-in-tests',
    tokens: ['Service', 'Repo', 'Client'],
  },
  {
    check: (source, context): boolean => isUnitTestPath(context) && hasRealTestService(source),
    message: 'Unit tests should use in-memory service implementations.',
    name: 'effect-prefer-in-memory-implementations',
    tokens: ['real'],
  },
  {
    check: (source, context): boolean => isUnitTestPath(context) && hasLiveTestService(source),
    message: 'Live services belong in integration tests, not unit tests.',
    name: 'effect-no-live-services-in-unit-tests',
    tokens: ['Live', 'Layer.live'],
  },
  {
    check: (source, context): boolean =>
      isEffectTestPath(context) && hasTimeCodeWithoutTestClock(source),
    message: 'Tests for time-dependent Effect code should use TestClock.',
    name: 'effect-require-testclock-for-time-code',
    tokens: ['Effect.timeout', 'Effect.delay', 'Clock.'],
  },
  {
    check: (source, context): boolean =>
      isEffectTestPath(context) &&
      /const\s+[A-Za-z_$][\w$]*(?:Runtime|Layer|Service)\s*=/.test(source),
    message: 'Do not share mutable runtime, layer, or service state across Effect tests.',
    name: 'effect-no-test-runtime-leakage',
    tokens: ['Runtime', 'Layer', 'Service'],
  },
  {
    message: 'Do not hide Effect semantics behind local wrapper DSLs.',
    name: 'effect-no-ad-hoc-effect-wrapper-abstractions',
    patterns: [/function\s+(?:runEffect|makeEffect|effectify|toEffect)\s*\(/],
    tokens: ['runEffect', 'makeEffect', 'effectify', 'toEffect'],
  },
  {
    check: (source): boolean =>
      source.split('\n').some((line) => {
        if (!/(?:eslint|oxlint)-disable[^\n]*effect-/.test(line)) {
          return false;
        }

        return !/(?:reason|because)[^\n]*(?:[A-Z]+-\d+|#\d+)/.test(line);
      }),
    message: 'Effect rule suppressions must name a rule, a reason, and a tracking ticket.',
    name: 'effect-require-effect-suppression-reason-and-ticket',
    tokens: ['disable', 'effect-'],
  },
] satisfies readonly RuleSpec[];
