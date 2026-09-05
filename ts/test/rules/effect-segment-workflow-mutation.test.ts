import { describe, expect, it } from 'vitest';
import {
  hasRecursiveEffectWithoutSuspend,
  hasReturnEffectInGen,
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
