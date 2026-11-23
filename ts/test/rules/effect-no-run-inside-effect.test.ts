import { describe, expect, it } from 'vitest';
import config from '../../src/index';
import { effectDefaultRuleNames } from '../../src/internal/effect-rule-names';
import { runRule } from './effect-rule-test-utils';

const rule = 'effect-no-run-inside-effect';
const imports = 'import { Effect, Runtime } from "effect";\n';

describe('effect-no-run-inside-effect', () => {
  it('is a default Effect rule enabled as an error', () => {
    expect(effectDefaultRuleNames).toContain(rule);
    expect(config({ effect: true }).rules).toHaveProperty(`thethracian/${rule}`, 'error');
  });

  it.each([
    [
      'runSync in an Effect.gen generator',
      'const p = Effect.gen(function* () { const v = Effect.runSync(load); return v; });',
    ],
    [
      'runPromise in an Effect.fn generator',
      'const f = Effect.fn("load")(function* () { yield* Effect.promise(() => Effect.runPromise(load)); });',
    ],
    [
      'runPromiseExit as an Effect.promise callback',
      'const p = Effect.promise(() => Effect.runPromiseExit(task));',
    ],
    ['runFork inside Effect.sync', 'const p = Effect.sync(() => Effect.runFork(worker));'],
    [
      'runSync in a piped Effect.map callback',
      'const p = load.pipe(Effect.map((v) => Effect.runSync(enrich(v))));',
    ],
    [
      'an immediately invoked helper inside a generator',
      'const p = Effect.gen(function* () { return (() => Effect.runSync(load))(); });',
    ],
    [
      'an object handler passed to an Effect API',
      'const p = Effect.tryPromise({ try: () => Effect.runPromise(load), catch: (cause) => new LoadError({ cause }) });',
    ],
    [
      'aliased Effect import',
      'import { Effect as E } from "effect";\nconst p = E.gen(function* () { return E.runSync(load); });',
    ],
  ])('reports %s', (_name, source) => {
    expect(runRule(rule, imports + source)).toHaveLength(1);
  });

  it.each([
    ['running at the program edge', 'Effect.runPromise(main);'],
    [
      'an exported entrypoint function',
      'export const handler = (event) => Effect.runPromise(handle(event));',
    ],
    [
      'a bridge callback passed to a non-Effect API',
      'const p = Effect.gen(function* () { storage.transactionSync(() => Effect.runSync(write)); });',
    ],
    [
      'stream source methods passed to a constructor',
      'const p = Effect.gen(function* () { return new ReadableStream({ pull: (controller) => Effect.runPromise(read(controller)), cancel: () => Effect.runPromise(close) }); });',
    ],
    [
      'a named listener registered with a non-Effect API',
      'const p = Effect.gen(function* () { const onAbort = () => Effect.runFork(report); signal.addEventListener("abort", onAbort); });',
    ],
    [
      'a captured runtime',
      'const p = Effect.gen(function* () { const runtime = yield* Effect.runtime(); Runtime.runFork(runtime)(worker); });',
    ],
    ['composition with yield*', 'const p = Effect.gen(function* () { return yield* load; });'],
    [
      'a method named runSync on another object',
      'const p = Effect.gen(function* () { return cache.runSync(load); });',
    ],
  ])('allows %s', (_name, source) => {
    expect(runRule(rule, imports + source)).toHaveLength(0);
  });
});
