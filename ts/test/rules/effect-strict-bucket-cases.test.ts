import { describe, expect, it } from 'vitest';
import theThracianOxlint from '../../src/index.js';
import { effectStrictRuleNames } from '../../src/rules/effect-rule-names.js';
import { runConfiguredRules, runRule, sorted } from './effect-rule-test-utils.js';
import type { RuleCase } from './effect-rule-test-utils.js';

const strictCases: RuleCase[] = [
  {
    name: 'effect-no-run-outside-entrypoints',
    invalid: 'Effect.runSync(program);',
    valid: 'program;',
    filename: 'src/domain/user.ts',
  },
  {
    name: 'effect-require-platform-runmain-at-entrypoints',
    invalid: 'Effect.runPromise(program);',
    valid: 'NodeRuntime.runMain(program);',
    filename: 'src/main.ts',
  },
  {
    name: 'effect-no-runSync-in-server-request-handlers',
    invalid: 'const handler = () => Effect.runSync(program);',
    valid: 'const handler = () => program;',
  },
  {
    name: 'effect-no-promise-returning-public-api',
    invalid: 'export function load(): Promise<User> { return promise; }',
    valid: 'export function load(): Effect.Effect<User> { return program; }',
  },
  {
    name: 'effect-no-direct-process-env-outside-config-layer',
    invalid: 'process.env.API_TOKEN;',
    valid: 'Config.string("API_TOKEN");',
  },
  {
    name: 'effect-no-direct-clock-random-outside-adapters',
    invalid: 'Date.now();',
    valid: 'Clock.currentTimeMillis;',
  },
  {
    name: 'effect-no-direct-http-fs-outside-platform-services',
    invalid: 'fetch("/users");',
    valid: 'HttpClient.get("/users");',
  },
  {
    name: 'effect-require-service-class-pattern',
    invalid: 'const UserRepo = Context.GenericTag<UserRepo>("UserRepo");',
    valid: 'class UserRepo extends Context.Tag("UserRepo")<UserRepo, Service>() {}',
  },
  {
    name: 'effect-require-tag-identifier',
    invalid: 'Context.Tag();',
    valid: 'Context.Tag("UserRepo");',
  },
  {
    name: 'effect-no-leaked-service-dependencies',
    invalid: 'export const Live = Layer.succeed(UserRepo, service);',
    valid: 'export const load = Effect.serviceFunction(UserRepo, (_) => _.load);',
  },
  {
    name: 'effect-no-duplicate-layer-instances',
    invalid: 'Layer.succeed(UserRepo, first); Layer.succeed(UserRepo, second);',
    valid: 'Layer.succeed(UserRepo, userRepo); Layer.succeed(Clock, clock);',
  },
  {
    name: 'effect-require-centralized-provision',
    invalid: 'program.pipe(Effect.provide(Live));',
    valid: 'program;',
  },
  {
    name: 'effect-no-provide-in-domain-modules',
    invalid: 'program.pipe(Effect.provide(Live));',
    valid: 'program;',
  },
  {
    name: 'effect-require-layer-memoization-constant',
    invalid: 'export const makeLayer = () => Layer.succeed(A, a);',
    valid: 'export const layer = Layer.succeed(A, a);',
  },
  {
    name: 'effect-require-suspend-for-circular-deps',
    invalid: 'Layer.effect(A, Layer.effect(B, b));',
    valid: 'Effect.suspend(() => Layer.effect(A, a));',
  },
  {
    name: 'effect-avoid-layer-explosion',
    invalid: 'const ALayer = Layer.succeed(A, a); const BLayer = Layer.succeed(B, b);',
    valid: 'const AppLayer = Layer.merge(ALayer, BLayer);',
  },
  {
    name: 'effect-prefer-succeed-for-static-layers',
    invalid: 'Layer.effect(A, Effect.succeed(a));',
    valid: 'Layer.succeed(A, a);',
  },
  {
    name: 'effect-require-scoped-for-resource-layers',
    invalid: 'Layer.effect(Db, openConnection);',
    valid: 'Layer.scoped(Db, openConnection);',
  },
  {
    name: 'effect-no-service-construction-outside-layer',
    invalid: 'new UserRepoService();',
    valid: 'Layer.succeed(UserRepo, service);',
  },
  {
    name: 'effect-schema-require-validation-at-input-boundaries',
    invalid: 'request.body;',
    valid: 'const body = yield* Schema.decodeUnknown(Input)(payload);',
  },
  {
    name: 'effect-schema-require-validation-at-output-boundaries',
    invalid: 'return Response.json(user);',
    valid: 'return Response.json(Schema.encodeSync(User)(user));',
  },
  {
    name: 'effect-schema-require-http-client-response-schema',
    invalid: 'HttpClient.get(url).pipe(Effect.flatMap((response) => response.json()));',
    valid: 'HttpClient.get(url).pipe(Effect.flatMap(Schema.decodeUnknown(User)));',
  },
  {
    name: 'effect-schema-require-http-server-request-schema',
    invalid: 'HttpServerRequest.json;',
    valid: 'Schema.decodeUnknown(Input)(body);',
  },
  {
    name: 'effect-schema-require-config-schema',
    invalid: 'Config.string("PORT");',
    valid: 'Schema.decodeUnknown(ConfigSchema)(Config.string("PORT"));',
    filename: 'src/config/app.ts',
  },
  {
    name: 'effect-schema-require-persistence-schema',
    invalid: 'repository.find(id);',
    valid: 'const user = yield* loadDecodedUser(id);',
  },
  {
    name: 'effect-schema-require-public-command-schema',
    invalid: 'Command.make("run", { handler });',
    valid: 'Command.make("run", { schema: Input, handler });',
  },
  {
    name: 'effect-schema-no-unknown-crossing-boundary',
    invalid: 'export function parse(): unknown { return value; }',
    valid: 'export function parse(): Effect.Effect<User> { return decoded; }',
  },
  {
    name: 'effect-require-timeout-on-external-effects',
    invalid: 'HttpClient.get("/users");',
    valid: 'HttpClient.get("/users").pipe(Effect.timeout("1 second"));',
  },
  {
    name: 'effect-require-retry-policy-for-idempotent-external-effects',
    invalid: 'HttpClient.get(url);',
    valid: 'HttpClient.get(url).pipe(Effect.retry(policy));',
  },
  {
    name: 'effect-require-schedule-jitter-for-retries',
    invalid: 'Effect.retry(program, Schedule.exponential("1 second"));',
    valid: 'Effect.retry(program, Schedule.exponential("1 second").pipe(Schedule.jittered));',
  },
  {
    name: 'effect-require-span-external',
    invalid: 'HttpClient.get(url).pipe(Effect.timeout("1 second"));',
    valid: 'HttpClient.get(url).pipe(Effect.timeout("1 second"), Effect.withSpan("loadUser"));',
  },
  {
    name: 'effect-require-semaphore-for-shared-resources',
    invalid: 'const pool = createPool(); Effect.forEach(items, work);',
    valid: 'const pool = createPool(); Semaphore.withPermits(sem, 1)(Effect.forEach(items, work));',
  },
  {
    name: 'effect-require-ref-for-shared-mutable-state',
    invalid: 'import { Effect } from "effect"; let counter = 0;',
    valid: 'import { Effect, Ref } from "effect"; Ref.make(0);',
  },
  {
    name: 'effect-require-scoped-in-loops',
    invalid: 'for (const item of items) { openConnection(item); }',
    valid: 'for (const item of items) { Effect.scoped(openConnection(item)); }',
  },
  {
    name: 'effect-require-onExit-for-cleanup',
    invalid: 'Effect.ensuring(program, cleanup);',
    valid: 'program.pipe(Effect.onExit(cleanup));',
  },
  {
    name: 'effect-require-stream-resource-safety',
    invalid: 'Stream.fromIterable(openConnection());',
    valid: 'Stream.scoped(openConnection());',
  },
  {
    name: 'effect-require-stream-termination',
    invalid: 'Stream.forever(source);',
    valid: 'Stream.forever(source).pipe(Stream.takeUntil(done));',
  },
  {
    name: 'effect-require-explicit-asyncPush-buffer',
    invalid: 'Stream.asyncPush(emit);',
    valid: 'Stream.asyncPush(emit, { buffer: 16 });',
  },
  {
    name: 'effect-require-batching-for-resolver',
    invalid: 'RequestResolver.make(run);',
    valid: 'RequestResolver.makeBatched(run);',
  },
  {
    name: 'effect-use-batched-resolver-for-n-plus-one',
    invalid: 'Effect.forEach(ids, (id) => findById(id));',
    valid: 'RequestResolver.makeBatched((ids) => findMany(ids));',
  },
  {
    name: 'effect-prefer-pubsub-for-broadcast',
    invalid: 'broadcast((subscribers) => Queue.offer(queue, subscribers));',
    valid: 'PubSub.publish(pubsub, message);',
  },
  {
    name: 'effect-require-provided-services-in-tests',
    filename: 'src/user.test.ts',
    invalid: 'yield* UserRepoService;',
    valid: 'yield* UserRepoService.pipe(Effect.provide(TestLayer));',
  },
  {
    name: 'effect-prefer-in-memory-implementations',
    filename: 'src/user.test.ts',
    invalid: 'const layer = realUserRepo;',
    valid: 'const layer = UserRepoInMemory;',
  },
  {
    name: 'effect-no-live-services-in-unit-tests',
    filename: 'src/user.test.ts',
    invalid: 'const layer = UserRepoLive;',
    valid: 'const layer = UserRepoInMemory;',
  },
  {
    name: 'effect-require-testclock-for-time-code',
    filename: 'src/user.test.ts',
    invalid: 'Clock.currentTimeMillis;',
    valid: 'TestClock.adjust("1 second");',
  },
  {
    name: 'effect-no-test-runtime-leakage',
    filename: 'src/user.test.ts',
    invalid: 'const TestRuntime = makeRuntime();',
    valid: 'it.effect("works", () => makeRuntime());',
  },
  {
    name: 'effect-no-ad-hoc-effect-wrapper-abstractions',
    invalid: 'function runEffect(program) { return Effect.runPromise(program); }',
    valid: 'const program = Effect.gen(function* () { return 1; });',
  },
  {
    name: 'effect-require-effect-suppression-reason-and-ticket',
    invalid: '// oxlint-disable-next-line thethracian/effect-no-throw',
    valid:
      '// oxlint-disable-next-line thethracian/effect-no-throw -- reason: generated shim ABC-123',
  },
  {
    name: 'effect-no-crypto-randomUUID',
    invalid: 'const id = crypto.randomUUID();',
    valid: 'const id = yield* Random.next;',
  },
  {
    name: 'effect-require-schema-is-over-instanceof',
    invalid: 'if (value instanceof UserSchema) { return value; }',
    valid: 'if (Schema.is(User)(value)) { return value; }',
  },
  {
    name: 'effect-prefer-schema-tagged-struct',
    invalid: 'const User = Schema.Struct({ _tag: Schema.Literal("User") });',
    valid: 'const User = Schema.TaggedStruct("User", {});',
  },
  {
    name: 'effect-prefer-single-schema-literal-union',
    invalid: 'const Status = Schema.Union(Schema.Literal("open"), Schema.Literal("closed"));',
    valid: 'const Status = Schema.Literal("open", "closed");',
  },
  {
    name: 'effect-require-deterministic-service-keys',
    invalid: 'class UserRepo extends Context.Tag("Repo")<UserRepo, Service>() {}',
    valid: 'class UserRepo extends Context.Tag("UserRepo")<UserRepo, Service>() {}',
  },
  {
    name: 'effect-no-multiple-provide-chain',
    invalid: 'const program = effect.pipe(Effect.provide(UserLayer), Effect.provide(DbLayer));',
    valid: 'const program = effect.pipe(Effect.provide(AppLayer));',
  },
  {
    name: 'effect-require-layer-scoped-when-scope-required',
    invalid:
      'const Live = Layer.effect(UserRepo, Effect.gen(function* () { yield* Scope.Scope; return repo; }));',
    valid:
      'const Live = Layer.scoped(UserRepo, Effect.gen(function* () { yield* Scope.Scope; return repo; }));',
  },
  {
    name: 'effect-no-node-builtins-when-effect-platform-exists',
    invalid: 'import { readFileSync } from "node:fs"; const text = readFileSync(path);',
    valid: 'const text = yield* FileSystem.readFileString(path);',
  },
  {
    name: 'effect-no-global-fetch',
    filename: 'src/domain/http.ts',
    invalid:
      'const response = Effect.tryPromise({ try: () => fetch("/users"), catch: (error) => error });',
    valid: 'const response = HttpClient.get("/users");',
  },
  {
    name: 'effect-prefer-effect-void',
    invalid: 'const done = Effect.succeed(undefined);',
    valid: 'const done = Effect.void;',
  },
  {
    name: 'effect-prefer-asVoid',
    invalid: 'const done = task.pipe(Effect.map(() => undefined));',
    valid: 'const done = task.pipe(Effect.asVoid);',
  },
  {
    name: 'effect-prefer-flatMap-over-map-flatten',
    invalid: 'const value = task.pipe(Effect.map(load), Effect.flatten);',
    valid: 'const value = task.pipe(Effect.flatMap(load));',
  },
];

describe('Effect strict rule behavior', () => {
  it('has one behavior case for every strict opt-in rule', () => {
    expect(sorted(strictCases.map((testCase) => testCase.name))).toStrictEqual(
      sorted(effectStrictRuleNames),
    );
  });

  it.each(strictCases)('detects and accepts strict rule $name', (testCase) => {
    expect(runRule(testCase.name, testCase.invalid, testCase.filename)).toHaveLength(1);
    expect(runRule(testCase.name, testCase.valid, testCase.filename)).toHaveLength(0);
  });

  it.each(strictCases)('keeps exported config behavior for strict rule $name', (testCase) => {
    const config = theThracianOxlint({ effect: { strict: true } });
    const invalidRuleNames = runConfiguredRules(config, testCase.invalid, testCase.filename).map(
      (report) => report.ruleName,
    );
    const validRuleNames = runConfiguredRules(config, testCase.valid, testCase.filename).map(
      (report) => report.ruleName,
    );

    expect(invalidRuleNames).toContain(testCase.name);
    expect(validRuleNames).not.toContain(testCase.name);
  });
});
