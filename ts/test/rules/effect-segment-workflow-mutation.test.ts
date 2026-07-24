import { describe, expect, it } from 'vitest';
import {
  enclosingEffectWrapperSegment,
  hasDuplicateLayerInstance,
  hasLayerFactory,
  hasLiveTestService,
  hasRealTestService,
  hasTopLevelPipeOperator,
  hasUnsafeResourceStream,
  hasUnscopedResourceLayer,
  hasUnscopedResourceLoop,
  lineAround,
  localEffectCallSegment,
  localStatementSegment,
  testSegments,
} from '../../src/rules/effect-strict-segment-helpers';
import {
  hasAsyncAwaitInEffect,
  hasEffectInArrayForEach,
  hasEffectInPromiseCallback,
  hasNestedFlatMap,
  hasParsedJSONNumberFromString,
  hasRecursiveEffectWithoutSuspend,
  hasReturnEffectInGen,
  hasRuntimeInEffect,
  hasSyncForPromise,
  hasSyncForThrowingOPS,
  hasThrowInEffect,
  hasTryPromiseWithoutTypedCatch,
  hasUnboundedEffectConcurrency,
  hasUnboundedFlatMapConcurrency,
  hasYieldWithoutStarInGen,
} from '../../src/rules/effect-default-workflow-helpers';

type BooleanContract = readonly [name: string, source: string, expected: boolean];

const booleanContracts = (
  label: string,
  predicate: (source: string) => boolean,
  contracts: readonly BooleanContract[],
): void => {
  describe(label, (): void => {
    it.each(contracts)('%s', (_name, source, expected): void => {
      expect(predicate(source)).toBe(expected);
    });
  });
};

describe('line and test segmentation', (): void => {
  it.each([
    ['middle line', 'first\nmiddle target\nlast', 'target', 'middle target'],
    ['first line', 'first line\nsecond line', 'first', 'first line'],
    ['last line', 'first line\nlast line', 'last', 'last line'],
  ])('%s', (_name, source, target, expected): void => {
    expect(lineAround(source, source.indexOf(target))).toBe(expected);
  });

  it('preserves a source with no test token', (): void => {
    expect(testSegments('const value = 1;')).toStrictEqual(['const value = 1;']);
  });

  it('strips a non-code test token before falling back', (): void => {
    expect(testSegments('const text = "it(";')).toStrictEqual(['const text = "   ";']);
  });

  it('splits real tests at exact starts', (): void => {
    expect(testSegments('it("first", one);\nit.effect("second", two);')).toStrictEqual([
      'it("     ", one);\n',
      'it.effect("      ", two);',
    ]);
  });

  it('ignores commented tests and near-match identifiers', (): void => {
    expect(testSegments('// it("ghost", run);\nit("real", run);')).toStrictEqual([
      'it("    ", run);',
    ]);
    expect(testSegments('fit(value);')).toStrictEqual(['fit(value);']);
  });
});

booleanContracts('layer factories', hasLayerFactory, [
  [
    'function factory',
    'export function UserLayer() { return Layer.succeed(User, service); }',
    true,
  ],
  ['arrow factory', 'export const UserLayer = () => Layer.effect(User, service);', true],
  ['layer value', 'export const UserLayer = Layer.succeed(User, service);', false],
  ['near-match name', 'export function makeUser() { return Layer.succeed(User, service); }', false],
  [
    'non-code factory',
    '// export function UserLayer() { return Layer.succeed(User, service); }\nconst text = "export const UserLayer = () => Layer.effect(User, service)";',
    false,
  ],
]);

booleanContracts('unscoped resource layers', hasUnscopedResourceLayer, [
  ['unscoped acquisition', 'const layer = Layer.effect(Database, openConnection());', true],
  [
    'scoped acquisition',
    'const layer = Layer.scoped(Database, Layer.effect(Database, openConnection()));',
    false,
  ],
  ['near-match acquisition', 'const layer = Layer.effect(Database, reopenConnection());', false],
  [
    'non-code acquisition',
    '// Layer.effect(Database, openConnection());\nconst text = "Layer.effect(Database, connectClient())";',
    false,
  ],
]);

booleanContracts('unscoped resource loops', hasUnscopedResourceLoop, [
  ['loop acquisition', 'for (const item of items) { openConnection(item); }', true],
  [
    'scoped loop acquisition',
    'Effect.scoped(Effect.gen(function* () { for (const item of items) { yield* openConnection(item); } }));',
    false,
  ],
  ['near-match loop acquisition', 'while (ready) { reopenConnection(); }', false],
  [
    'non-code loop acquisition',
    '// while (ready) { connectClient(); }\nconst text = "for (;;) { listenSocket() }";',
    false,
  ],
]);

booleanContracts('resource streams', hasUnsafeResourceStream, [
  ['unscoped stream acquisition', 'const stream = Stream.repeatEffect(openConnection());', true],
  ['scoped stream acquisition', 'const stream = Stream.scoped(openConnection());', false],
  [
    'near-match stream acquisition',
    'const stream = Stream.repeatEffect(reopenConnection());',
    false,
  ],
  [
    'non-code stream acquisition',
    '// Stream.repeatEffect(connectClient());\nconst text = "Stream.repeatEffect(subscribeTopic())";',
    false,
  ],
]);

booleanContracts('live test services', hasLiveTestService, [
  ['Live binding', 'const service = UserLive;', true],
  ['Layer.live', 'const service = Layer.live(layer);', true],
  ['test binding', 'const service = UserTest;', false],
  [
    'non-code and near matches',
    '// UserLive\nconst text = "Layer.live"; const state = Liveness;',
    false,
  ],
]);

booleanContracts('real test services', hasRealTestService, [
  ['real binding', 'const service = realDatabase;', true],
  ['bare real', 'const service = real;', false],
  ['embedded near match', 'const service = surrealDatabase;', false],
  ['non-code real binding', '// realDatabase\nconst text = "realDatabase";', false],
]);

booleanContracts('duplicate layer instances', hasDuplicateLayerInstance, [
  ['duplicate service', 'Layer.succeed(User, user); Layer.effect(User, loadUser);', true],
  ['distinct services', 'Layer.succeed(User, user); Layer.effect(Database, loadDatabase);', false],
  ['one service', 'Layer.scoped(User, acquireUser);', false],
  [
    'non-code duplicate',
    'Layer.succeed(User, user); // Layer.effect(User, loadUser)\nconst text = "Layer.sync(User, user)";',
    false,
  ],
]);

describe('local and enclosing segments', (): void => {
  it('extracts one call and caches the exact result', (): void => {
    const source = 'const task = Effect.promise(() => client.get()); const next = 1;';
    const index = source.indexOf('Effect.promise');

    expect(localEffectCallSegment(source, index)).toBe('Effect.promise(() => client.get())');
    expect(localEffectCallSegment(source, index)).toBe('Effect.promise(() => client.get())');
  });

  it('includes the complete chained pipe only', (): void => {
    const source =
      'Effect.tryPromise(() => client.get()).pipe(Effect.timeout("1 second")); next();';
    expect(localEffectCallSegment(source, 0)).toBe(
      'Effect.tryPromise(() => client.get()).pipe(Effect.timeout("1 second"))',
    );
  });

  it('extracts one statement despite a string semicolon', (): void => {
    expect(localStatementSegment('Effect.succeed("a;b"); const next = 2;', 0)).toBe(
      'Effect.succeed("a;b");',
    );
  });

  it('finds only an enclosing promise wrapper', (): void => {
    const source =
      'const task = Effect.tryPromise({ try: () => client.get(), catch: toError }); next();';
    expect(enclosingEffectWrapperSegment(source, source.indexOf('client'))).toBe(
      'Effect.tryPromise({ try: () => client.get(), catch: toError })',
    );
    expect(enclosingEffectWrapperSegment(source, source.indexOf('next'))).toBeUndefined();
    const nearMatch = 'Effect.promiseLater(() => client.get());';
    expect(enclosingEffectWrapperSegment(nearMatch, nearMatch.indexOf('client'))).toBeUndefined();
  });

  it.each([
    [
      'top-level timeout',
      'Effect.promise(load).pipe(Effect.timeout("1 second"), Effect.retry(schedule))',
      'timeout',
      true,
    ],
    [
      'top-level retry',
      'Effect.promise(load).pipe(\n Effect.timeout("1 second"),\n Effect.retry(schedule))',
      'retry',
      true,
    ],
    [
      'nested timeout',
      'Effect.promise(load).pipe(Effect.map(value => Effect.timeout(value)))',
      'timeout',
      false,
    ],
    [
      'operator suffix',
      'Effect.promise(load).pipe(Effect.withSpanExtra("load"))',
      'withSpan',
      false,
    ],
    ['no pipe', 'Effect.promise(load)', 'retry', false],
  ] as const)('%s', (_name, segment, operator, expected): void => {
    expect(hasTopLevelPipeOperator(segment, operator)).toBe(expected);
  });
});

booleanContracts('runtime inside Effect workflows', hasRuntimeInEffect, [
  ['runtime in gen', 'Effect.gen(function* () { return yield* Effect.runPromise(task); });', true],
  [
    'aliased runtime in fn',
    'import { Effect as Fx } from "effect";\nconst run = Fx.fn("run")(() => Fx.runSync(task));',
    true,
  ],
  [
    'runtime outside workflow',
    'Effect.runPromise(task); Effect.gen(function* () { yield* task; });',
    false,
  ],
  [
    'non-code runtime',
    'Effect.gen(function* () { /* Effect.runSync(task) */ const text = "Effect.runPromise(task)"; yield* task; });',
    false,
  ],
]);

booleanContracts('nested flatMaps', hasNestedFlatMap, [
  [
    'direct nesting',
    'Effect.flatMap(first, value => Effect.flatMap(second, next => combine(value, next)))',
    true,
  ],
  [
    'pipe nesting',
    'Effect.flatMap(first, value => second.pipe(Effect.flatMap(next => combine(value, next))))',
    true,
  ],
  [
    'nested map',
    'Effect.flatMap(first, value => Effect.map(second, next => combine(value, next)))',
    false,
  ],
  [
    'non-code nesting',
    '// Effect.flatMap(first, x => Effect.flatMap(second, use))\nconst text = "Effect.flatMap(first, x => Effect.flatMap(second, use))";',
    false,
  ],
]);

booleanContracts('unbounded Effect concurrency', hasUnboundedEffectConcurrency, [
  ['forEach unbounded', 'Effect.forEach(items, work, { concurrency: "unbounded" });', true],
  ['all unbounded', "Effect.all(tasks, { concurrency: 'unbounded' });", true],
  ['bounded concurrency', 'Effect.forEach(items, work, { concurrency: 8 });', false],
  [
    'commented unbounded',
    'Effect.all(tasks, { /* concurrency: "unbounded" */ concurrency: 8 });',
    false,
  ],
]);

booleanContracts('unbounded flatMap concurrency', hasUnboundedFlatMapConcurrency, [
  ['unbounded', 'Effect.flatMap(task, work, { concurrency: "unbounded" });', true],
  ['bounded', 'Effect.flatMap(task, work, { concurrency: 4 });', false],
  [
    'string near match',
    'Effect.flatMap(task, work, { concurrency: "bounded" }); const text = "unbounded";',
    false,
  ],
]);

booleanContracts('JSON NumberFromString', hasParsedJSONNumberFromString, [
  ['schema cast', 'const age = JSON.parse(input) as Schema.NumberFromString;', true],
  ['named schema', 'const age: typeof AgeNumberFromString = JSON.parse(input);', true],
  [
    'schema in prior statement',
    'const schema = Schema.NumberFromString;\nconst age = JSON.parse(input);',
    false,
  ],
  [
    'non-code parse',
    '// JSON.parse(input) as Schema.NumberFromString;\nconst text = "JSON.parse";',
    false,
  ],
  ['schema suffix', 'const age = JSON.parse(input) as Schema.NumberFromStringValue;', false],
]);

booleanContracts('Effect inside Array.forEach', hasEffectInArrayForEach, [
  ['Effect callback', 'items.forEach(item => Effect.runPromise(work(item)));', true],
  ['Effect.forEach', 'Effect.forEach(items, item => work(item));', false],
  ['pure callback', 'items.forEach(item => collect(item));', false],
  [
    'non-code callback',
    '// items.forEach(x => Effect.succeed(x));\nconst text = "items.forEach(x => Effect.fail(x))";',
    false,
  ],
]);

booleanContracts('Effect inside Promise callbacks', hasEffectInPromiseCallback, [
  ['then callback', 'promise.then(value => Effect.succeed(value));', true],
  [
    'function catch callback',
    'promise.catch(function (error) { return Effect.fail(error); });',
    true,
  ],
  ['pure callback', 'promise.then(value => transform(value));', false],
  [
    'finally and non-code callbacks',
    'promise.finally(() => Effect.succeed(undefined)); // promise.then(x => Effect.succeed(x))',
    false,
  ],
]);

booleanContracts('return Effect inside gen', hasReturnEffectInGen, [
  ['direct return', 'Effect.gen(function* () { return Effect.succeed(1); });', true],
  ['yielded return', 'Effect.gen(function* () { return yield* Effect.succeed(1); });', false],
  ['inspection return', 'Effect.gen(function* () { return Effect.isEffect(value); });', false],
  [
    'non-code return',
    'Effect.gen(function* () { /* return Effect.fail(error) */ const text = "return Effect.succeed(1)"; yield* task; });',
    false,
  ],
]);

describe('yield without star', (): void => {
  it('returns the exact absolute violation index', (): void => {
    const source =
      'const task = Effect.gen(function* () { const value = yield Effect.succeed(1); });';
    expect(hasYieldWithoutStarInGen(source)).toBe(source.indexOf('yield'));
  });

  it.each([
    ['yield star', 'Effect.gen(function* () { yield* Effect.succeed(1); });'],
    ['non-code yield', 'Effect.gen(function* () { const text = "yield Effect.succeed(1)"; })'],
    ['near-match identifier', 'Effect.gen(function* () { const yielded = task; });'],
  ])('allows %s', (_name, source): void => {
    expect(hasYieldWithoutStarInGen(source)).toBe(false);
  });
});

booleanContracts('async-await workflows', hasAsyncAwaitInEffect, [
  ['await in gen', 'Effect.gen(function* () { const value = await load(); return value; });', true],
  ['async fn', 'const load = Effect.fn("load")(async () => fetch("/"));', true],
  [
    'async outside workflow',
    'const load = async () => fetch("/"); Effect.gen(function* () { yield* task; });',
    false,
  ],
  [
    'non-code async-await',
    'Effect.gen(function* () { /* await load() */ const text = "async () => await load()"; yield* task; });',
    false,
  ],
]);

booleanContracts('Effect.sync promises', hasSyncForPromise, [
  ['async callback', 'Effect.sync(async () => fetch("/"));', true],
  ['Promise call', 'Effect.sync(() => Promise.resolve(1));', true],
  ['Effect.promise', 'Effect.promise(() => fetch("/"));', false],
  [
    'near-match and non-code promise',
    'Effect.sync(() => fetchValue()); const text = "Promise.resolve(1)";',
    false,
  ],
]);

booleanContracts('throwing Effect.sync operations', hasSyncForThrowingOPS, [
  ['throw', 'Effect.sync(() => { throw new Error("boom"); });', true],
  ['JSON.parse', 'Effect.sync(() => JSON.parse(input));', true],
  ['Effect.try', 'Effect.try(() => JSON.parse(input));', false],
  ['near-match and non-code throw', 'Effect.sync(() => throwable()); const text = "throw";', false],
]);

booleanContracts('throw inside Effect workflows', hasThrowInEffect, [
  ['throw in gen', 'Effect.gen(function* () { throw new Error("boom"); });', true],
  ['throw in fn', 'const run = Effect.fn("run")(() => { throw new Error("boom"); });', true],
  ['Effect.fail', 'Effect.gen(function* () { return yield* Effect.fail(error); });', false],
  [
    'outside and non-code throw',
    'throw new Error("outside"); Effect.gen(function* () { const text = "throw"; /* throw error */ yield* task; });',
    false,
  ],
]);

booleanContracts('Effect.tryPromise typed catches', hasTryPromiseWithoutTypedCatch, [
  ['callback-only', 'Effect.tryPromise(async () => fetch("/"));', true],
  ['missing catch', 'Effect.tryPromise({ try: () => fetch("/") });', true],
  [
    'string catch',
    'Effect.tryPromise({ try: () => fetch("/"), catch: error => "request failed" });',
    true,
  ],
  [
    'untagged catch',
    'Effect.tryPromise({ try: () => fetch("/"), catch: error => ({ message: String(error) }) });',
    true,
  ],
  [
    'tagged catch',
    'Effect.tryPromise({ try: () => fetch("/"), catch: error => ({ _tag: "RequestError", cause: error }) });',
    false,
  ],
  [
    'typed constructor',
    'Effect.tryPromise({ try: () => fetch("/"), catch: error => new RequestError({ cause: error }) });',
    false,
  ],
  [
    'non-code tryPromise',
    '// Effect.tryPromise(async () => fetch("/"))\nconst text = "Effect.tryPromise({ try: load })";',
    false,
  ],
]);

booleanContracts('recursive Effect suspension', hasRecursiveEffectWithoutSuspend, [
  [
    'direct eager function recursion',
    'function loop() { Effect.succeed(undefined); return loop(); }',
    true,
  ],
  [
    'flatMap continuation recursion',
    'function loop() { return Effect.flatMap(step, () => loop()); }',
    false,
  ],
  [
    'Effect.gen continuation recursion',
    'const loop = () => Effect.gen(function* () { return yield* loop(); });',
    false,
  ],
  [
    'ordinary recursion',
    'function factorial(value) { return value <= 1 ? 1 : value * factorial(value - 1); }',
    false,
  ],
  [
    'non-code recursion',
    '// function loop() { return Effect.flatMap(step, () => loop()); }\nconst text = "const loop = () => Effect.gen(() => loop())";',
    false,
  ],
]);
