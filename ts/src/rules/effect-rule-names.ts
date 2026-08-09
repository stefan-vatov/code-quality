/* -------------------------------------------------------------------------- */
/*    Canonical lists of custom Effect rule names exported by the config.     */
/* -------------------------------------------------------------------------- */
/**
 * High-confidence Effect correctness rules used by the shared safety preset.
 *
 * Specialized migration, version, error-model, schema, and test analyzers,
 * plus strict architecture rules, remain registered for explicit selection;
 * they are not part of the preset.
 *
 * @internal
 */
export const effectSafetyRuleNames = [
  'effect-no-floating-effect',
  'effect-require-yield-star',
  'effect-require-return-yield-star',
  'effect-no-floating-fiber',
  'effect-require-suspend-for-recursion',
  'effect-no-silent-error-swallowing',
  'effect-require-typed-error-in-trypromise',
  'effect-require-error-cause-preserved',
  'effect-no-runfork-without-observer',
  'effect-require-acquire-release',
  'effect-require-scoped-for-acquireRelease',
  'effect-require-scoped-for-resources',
  'effect-no-fork-daemon-without-cleanup',
  'effect-require-restore-for-fork-in-uninterruptible',
  'effect-require-bounded-concurrency',
  'effect-require-bounded-flatMap-concurrency',
  'effect-no-unbounded-queue',
  'effect-no-unbounded-stream-buffer',
] as const;

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const effectDefaultRuleNames = [
  'effect-no-floating-effect',
  'effect-require-yield-star',
  'effect-require-return-yield-star',
  'effect-no-floating-fiber',
  'effect-require-suspend-for-recursion',
  'effect-no-silent-error-swallowing',
  'effect-require-typed-error-in-trypromise',
  'effect-no-catchAll-with-mapError',
  'effect-require-error-cause-preserved',
  'effect-no-error-channel-widening-to-unknown',
  'effect-no-runfork-without-observer',
  'effect-schema-require-parse-error-handling',
  'effect-schema-use-decodeUnknown-for-external-data',
  'effect-schema-require-parseJson-for-json-strings',
  'effect-schema-correct-number-type-for-parsed-json',
  'effect-schema-no-redundant-tag-identifier',
  'effect-schema-avoid-old-type-names',
  'effect-schema-no-cast-after-decode',
  'effect-require-acquire-release',
  'effect-require-scoped-for-acquireRelease',
  'effect-require-scoped-for-resources',
  'effect-no-fork-daemon-without-cleanup',
  'effect-require-restore-for-fork-in-uninterruptible',
  'effect-require-bounded-concurrency',
  'effect-require-bounded-flatMap-concurrency',
  'effect-no-unbounded-queue',
  'effect-no-unbounded-stream-buffer',
  'effect-testClock-requires-fork',
  'effect-testClock-requires-testContext',
  'effect-no-real-sleep-in-tests',
  'effect-no-focused-effect-tests',
  'effect-no-skipped-effect-tests',
  'effect-no-obsolete-imports',
  'effect-no-known-fake-api',
  'effect-no-deprecated-schema-package',
  'effect-no-deprecated-context-tag-function',
  'effect-require-service-self-match',
] as const;

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const effectStrictRuleNames = [
  'effect-no-run-outside-entrypoints',
  'effect-require-platform-runmain-at-entrypoints',
  'effect-no-runSync-in-server-request-handlers',
  'effect-no-promise-returning-public-api',
  'effect-no-direct-process-env-outside-config-layer',
  'effect-no-direct-clock-random-outside-adapters',
  'effect-no-direct-http-fs-outside-platform-services',
  'effect-require-service-class-pattern',
  'effect-require-tag-identifier',
  'effect-no-leaked-service-dependencies',
  'effect-no-duplicate-layer-instances',
  'effect-require-centralized-provision',
  'effect-no-provide-in-domain-modules',
  'effect-require-layer-memoization-constant',
  'effect-require-suspend-for-circular-deps',
  'effect-avoid-layer-explosion',
  'effect-prefer-succeed-for-static-layers',
  'effect-require-scoped-for-resource-layers',
  'effect-no-service-construction-outside-layer',
  'effect-schema-require-validation-at-input-boundaries',
  'effect-schema-require-validation-at-output-boundaries',
  'effect-schema-require-http-client-response-schema',
  'effect-schema-require-http-server-request-schema',
  'effect-schema-require-config-schema',
  'effect-schema-require-persistence-schema',
  'effect-schema-require-public-command-schema',
  'effect-schema-no-unknown-crossing-boundary',
  'effect-require-timeout-on-external-effects',
  'effect-require-retry-policy-for-idempotent-external-effects',
  'effect-require-schedule-jitter-for-retries',
  'effect-require-span-external',
  'effect-require-semaphore-for-shared-resources',
  'effect-require-ref-for-shared-mutable-state',
  'effect-require-scoped-in-loops',
  'effect-require-onExit-for-cleanup',
  'effect-require-stream-resource-safety',
  'effect-require-stream-termination',
  'effect-require-explicit-asyncPush-buffer',
  'effect-require-batching-for-resolver',
  'effect-use-batched-resolver-for-n-plus-one',
  'effect-prefer-pubsub-for-broadcast',
  'effect-require-provided-services-in-tests',
  'effect-prefer-in-memory-implementations',
  'effect-no-live-services-in-unit-tests',
  'effect-require-testclock-for-time-code',
  'effect-no-test-runtime-leakage',
  'effect-no-ad-hoc-effect-wrapper-abstractions',
  'effect-require-effect-suppression-reason-and-ticket',
  'effect-no-crypto-randomUUID',
  'effect-require-schema-is-over-instanceof',
  'effect-prefer-schema-tagged-struct',
  'effect-prefer-single-schema-literal-union',
  'effect-require-deterministic-service-keys',
  'effect-no-multiple-provide-chain',
  'effect-require-layer-scoped-when-scope-required',
  'effect-no-node-builtins-when-effect-platform-exists',
  'effect-no-global-fetch',
  'effect-prefer-effect-void',
  'effect-prefer-asVoid',
  'effect-prefer-flatMap-over-map-flatten',
] as const;

/** Strict Effect rule names available for explicit project selection. @public */
export type EffectStrictRuleName = (typeof effectStrictRuleNames)[number];
