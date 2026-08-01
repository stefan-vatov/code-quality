import { describe, expect, it } from 'vitest';
import type { SourceRule } from '../../src/rules/effect-rule-core';
import plugin from '../../src/rules/plugin';
import { runRule } from './effect-rule-test-utils';
import theThracianOxlint from '../../src/index';

const RULE_NAME = 'effect-prefer-collection-discard-over-asVoid';
const EXPECTED_MESSAGE =
  'Use collection discard mode instead of Effect.asVoid so Effect.all or Effect.forEach does not collect values that are immediately discarded.\n' +
  'Fix: Set discard: true in the collection options and remove the trailing Effect.asVoid.\n' +
  'Example:\n```ts\nimport { Effect } from "effect"\n\n' +
  'const done = Effect.forEach(items, work, { discard: true })\n```';

const imported = (statement: string): string => `import { Effect } from "effect"; ${statement}`;
const all = (input = '[first, second]', options = ''): string =>
  `Effect.all(${input}${options ? `, ${options}` : ''})`;
const forEach = (options = '', input = 'items'): string =>
  `Effect.forEach(${input}, work${options ? `, ${options}` : ''})`;
const discarded = (collection: string, operator = 'Effect.asVoid'): string =>
  `const done = ${collection}.pipe(${operator});`;
const reportsFor = (source: string) => runRule(RULE_NAME, source);

const registeredRule = (): SourceRule => {
  const rule: unknown = Reflect.get(plugin.rules, RULE_NAME);
  expect(rule, `${RULE_NAME} must be registered`).toBeDefined();
  return rule as SourceRule;
};

const visitorKeysFor = (source: string): string[] =>
  Object.keys(
    registeredRule().create({
      report(): void {},
      sourceCode: { text: source },
    }),
  ).sort();

describe('effect-prefer-collection-discard-over-asVoid', (): void => {
  it('is registered as a problem and enabled in the default Effect config', (): void => {
    const rule = registeredRule();

    expect(rule.meta?.type).toBe('problem');
    expect(theThracianOxlint().rules).toHaveProperty(`thethracian/${RULE_NAME}`, 'error');
  });

  it.each([
    'const value = 1;',
    'asVoid all',
    'effect all',
    'effect asVoid',
    'effect asVoid collect',
  ])('keeps only the cheap Program visitor for source %j', (source): void => {
    expect(visitorKeysFor(source)).toStrictEqual(['Program']);
  });

  it.each(['effect asVoid all', 'effect asVoid forEach'])(
    'enables call analysis when all candidate tokens occur from offset zero in %j',
    (source): void => {
      expect(visitorKeysFor(source)).toStrictEqual(['CallExpression', 'Program']);
    },
  );

  it.each([
    ['Effect.all without options', imported(discarded(all()))],
    ['Effect.all with an empty options object', imported(discarded(all(undefined, '{}')))],
    [
      'Effect.all with v3 options',
      imported(
        discarded(
          all(
            undefined,
            '{ concurrency: 4, batching: true, mode: "either", concurrentFinalizers: true }',
          ),
        ),
      ),
    ],
    [
      'Effect.all with v4 options',
      imported(discarded(all(undefined, '{ concurrency: "unbounded", mode: "result" }'))),
    ],
    ['Effect.forEach without options', imported(discarded(forEach()))],
    ['Effect.forEach with an empty options object', imported(discarded(forEach('{}')))],
    [
      'Effect.forEach with v3 options',
      imported(
        discarded(
          forEach(
            '{ concurrency: 4, batching: "inherit", concurrentFinalizers: false }',
            '[first, second]',
          ),
        ),
      ),
    ],
    [
      'Effect.forEach with v4 options',
      imported(discarded(forEach('{ concurrency: 4 }', '[first, second]'))),
    ],
    [
      'Effect.forEach with only the v3 finalizer option',
      imported(discarded(forEach('{ concurrentFinalizers: true }'))),
    ],
    [
      'static quoted and shorthand option keys',
      imported(
        `const concurrency = 4; ${discarded(all(undefined, '{ concurrency, "mode": "result" }'))}`,
      ),
    ],
  ])('reports %s across Effect v3 and v4', (_name, source): void => {
    expect(reportsFor(source)).toHaveLength(1);
  });

  it.each([
    [
      'a root Effect alias',
      'import { Effect as Fx } from "effect"; const done = Fx.all([first]).pipe(Fx.asVoid);',
    ],
    [
      'an effect/Effect namespace',
      'import * as Fx from "effect/Effect"; const done = Fx.forEach(items, work).pipe(Fx.asVoid);',
    ],
    [
      'aliased named effect/Effect imports',
      'import { all as collect, asVoid as discard } from "effect/Effect"; const done = collect([first]).pipe(discard);',
    ],
    [
      'mixed root and named imports',
      'import { Effect } from "effect"; import { asVoid as discard } from "effect/Effect"; const done = Effect.all([first]).pipe(discard);',
    ],
    [
      'mixed named and namespace imports',
      'import * as Fx from "effect/Effect"; import { forEach as traverse } from "effect/Effect"; const done = traverse(items, work).pipe(Fx.asVoid);',
    ],
    [
      'a root package namespace through Effect',
      'import * as Root from "effect"; const done = Root.Effect.all([first]).pipe(Root.Effect.asVoid);',
    ],
  ])('recognizes %s', (_name, source): void => {
    expect(reportsFor(source)).toHaveLength(1);
  });

  it('reports every independent discarded collection', (): void => {
    const source = imported(
      `${discarded(all('[first]'))} ${discarded(forEach('{ concurrency: 2 }', '[second]'))}`,
    );

    expect(reportsFor(source)).toHaveLength(2);
  });

  it('publishes the exact diagnostic without a fix or suggestions', (): void => {
    const [report] = reportsFor(imported(discarded(all())));

    expect(report?.message).toBe(EXPECTED_MESSAGE);
    expect(Reflect.get(report ?? {}, 'fix')).toBeUndefined();
    expect(Reflect.get(report ?? {}, 'suggest')).toBeUndefined();
    expect(Reflect.get(report ?? {}, 'suggestions')).toBeUndefined();
  });

  it('reports the Effect.asVoid operator as the diagnostic location', (): void => {
    const source = imported(discarded(all()));
    const [report] = reportsFor(source);
    const node = report?.node as { end?: number; start?: number; type?: string } | undefined;

    expect(node?.type).toBe('MemberExpression');
    expect(source.slice(node?.start, node?.end)).toBe('Effect.asVoid');
  });

  it.each([
    ['an identifier', 'effects'],
    ['a call', 'makeEffects()'],
    ['a record', '{ first, second }'],
    ['a new expression', 'new Set([first, second])'],
  ])('preserves Effect.all collection timing for %s input', (_name, input): void => {
    expect(reportsFor(imported(discarded(all(input))))).toHaveLength(0);
  });

  it('rejects an array spread in Effect.all', (): void => {
    expect(reportsFor(imported(discarded(all('[first, ...rest]'))))).toHaveLength(0);
  });

  it.each([
    ['Effect.all without arguments', 'Effect.all().pipe(Effect.asVoid);'],
    ['Effect.all with three arguments', 'Effect.all([first], {}, extra).pipe(Effect.asVoid);'],
    ['spread Effect.all arguments', 'Effect.all(...groups).pipe(Effect.asVoid);'],
    ['generic Effect.all', 'Effect.all<Output>([first]).pipe(Effect.asVoid);'],
    ['computed Effect.all', 'Effect["all"]([first]).pipe(Effect.asVoid);'],
    ['optional Effect.all access', 'Effect?.all([first]).pipe(Effect.asVoid);'],
    ['optional Effect.all call', 'Effect.all?.([first]).pipe(Effect.asVoid);'],
    ['one-argument Effect.forEach', 'Effect.forEach(items).pipe(Effect.asVoid);'],
    ['four-argument Effect.forEach', 'Effect.forEach(items, work, {}, extra).pipe(Effect.asVoid);'],
    ['spread Effect.forEach arguments', 'Effect.forEach(...values).pipe(Effect.asVoid);'],
    ['generic Effect.forEach', 'Effect.forEach<Item, Output>(items, work).pipe(Effect.asVoid);'],
    ['computed Effect.forEach', 'Effect["forEach"](items, work).pipe(Effect.asVoid);'],
    ['optional Effect.forEach access', 'Effect?.forEach(items, work).pipe(Effect.asVoid);'],
    ['optional Effect.forEach call', 'Effect.forEach?.(items, work).pipe(Effect.asVoid);'],
  ])('rejects %s', (_name, statement): void => {
    expect(reportsFor(imported(statement))).toHaveLength(0);
  });

  it.each([
    ['identifier options', 'options'],
    ['member options', 'settings.collection'],
    ['array options', '[]'],
    ['an unknown key', '{ ordered: true }'],
    ['__proto__', '{ __proto__: prototype }'],
    ['an object spread', '{ ...options, concurrency: 4 }'],
    ['a computed key', '{ [key]: 4 }'],
    ['a computed allowed key', '{ ["concurrency"]: 4 }'],
    ['a getter', '{ get concurrency() { return 4 } }'],
    ['a setter', '{ set concurrency(value) {} }'],
    ['a method', '{ concurrency() { return 4 } }'],
    ['a duplicate key', '{ concurrency: 2, concurrency: 4 }'],
    ['an asserted object', '({ concurrency: 4 } as const)'],
    ['a satisfied object', '({ concurrency: 4 } satisfies object)'],
  ])('rejects unsafe Effect.all %s', (_name, options): void => {
    expect(reportsFor(imported(discarded(all(undefined, options))))).toHaveLength(0);
  });

  it.each([
    ['identifier options', 'options'],
    ['member options', 'settings.collection'],
    ['array options', '[]'],
    ['the Effect.all-only mode key', '{ mode: "result" }'],
    ['an unknown key', '{ ordered: true }'],
    ['__proto__', '{ __proto__: prototype }'],
    ['an object spread', '{ ...options, concurrency: 4 }'],
    ['a computed key', '{ [key]: 4 }'],
    ['a computed allowed key', '{ ["batching"]: true }'],
    ['a getter', '{ get concurrency() { return 4 } }'],
    ['a setter', '{ set concurrency(value) {} }'],
    ['a method', '{ batching() { return true } }'],
    ['a duplicate key', '{ batching: true, batching: false }'],
    ['an asserted object', '({ concurrency: 4 } as const)'],
    ['a satisfied object', '({ concurrency: 4 } satisfies object)'],
  ])('rejects unsafe Effect.forEach %s', (_name, options): void => {
    expect(reportsFor(imported(discarded(forEach(options))))).toHaveLength(0);
  });

  it.each([
    ['numeric concurrency', '{ concurrency: 2 }'],
    ['inherited concurrency', '{ concurrency: "inherit" }'],
    ['request batching', '{ batching: true }'],
    ['inherited request batching', '{ batching: "inherit" }'],
  ])('requires a direct array for Effect.forEach with %s', (_name, options): void => {
    expect(reportsFor(imported(discarded(forEach(options))))).toHaveLength(0);
    expect(reportsFor(imported(discarded(forEach(options, 'new Set(items)'))))).toHaveLength(0);
    expect(reportsFor(imported(discarded(forEach(options, '[first, ...rest]'))))).toHaveLength(0);
    expect(reportsFor(imported(discarded(forEach(options, '[first, second]'))))).toHaveLength(1);
  });

  it.each([
    ['Effect.all discard true', discarded(all(undefined, '{ discard: true }'))],
    ['Effect.all discard false', discarded(all(undefined, '{ discard: false }'))],
    ['Effect.all quoted discard', discarded(all(undefined, '{ "discard": value }'))],
    ['Effect.forEach discard true', discarded(forEach('{ discard: true }'))],
    ['Effect.forEach discard false', discarded(forEach('{ discard: false }'))],
    ['Effect.forEach quoted discard', discarded(forEach('{ "discard": value }'))],
  ])('accepts canonical or explicit %s', (_name, statement): void => {
    expect(reportsFor(imported(statement))).toHaveLength(0);
  });

  it('rejects a shorthand discard option', (): void => {
    const source = imported(
      `const discard = false; ${discarded(forEach('{ concurrency: 2, discard }'))}`,
    );

    expect(reportsFor(source)).toHaveLength(0);
  });

  it.each([
    ['no pipe operators', `${all()}.pipe();`],
    ['an operator before asVoid', `${all()}.pipe(Effect.tap(log), Effect.asVoid);`],
    ['an operator after asVoid', `${all()}.pipe(Effect.asVoid, Effect.tap(log));`],
    ['spread pipe operators', `${all()}.pipe(...operators);`],
    ['generic pipe', `${all()}.pipe<Effect.Effect<void>>(Effect.asVoid);`],
    ['computed pipe', `${all()}["pipe"](Effect.asVoid);`],
    ['optional pipe access', `${all()}?.pipe(Effect.asVoid);`],
    ['optional pipe call', `${all()}.pipe?.(Effect.asVoid);`],
    ['computed asVoid', `${all()}.pipe(Effect["asVoid"]);`],
    ['optional asVoid', `${all()}.pipe(Effect?.asVoid);`],
    ['called asVoid', `${all()}.pipe(Effect.asVoid());`],
    ['wrapped asVoid', `${all()}.pipe(identity(Effect.asVoid));`],
  ])('requires an exact sole operator and rejects %s', (_name, statement): void => {
    expect(reportsFor(imported(statement))).toHaveLength(0);
  });

  it.each([
    ['the static asVoid form', `const done = Effect.asVoid(${all()});`],
    [
      'the standalone pipe helper',
      `import { pipe } from "effect"; const done = pipe(${all()}, Effect.asVoid);`,
    ],
    ['a wrapped collection', `const done = identity(${all()}).pipe(Effect.asVoid);`],
    ['an intervening pipe', `const done = ${all()}.pipe(identity).pipe(Effect.asVoid);`],
    ['a nested collection', `const done = Effect.suspend(() => ${all()}).pipe(Effect.asVoid);`],
    ['curried Effect.forEach', 'const done = Effect.forEach(work)(items).pipe(Effect.asVoid);'],
    [
      'pipeable Effect.forEach',
      'const done = items.pipe(Effect.forEach(work)).pipe(Effect.asVoid);',
    ],
  ])('rejects %s', (_name, statement): void => {
    expect(reportsFor(imported(statement))).toHaveLength(0);
  });

  it.each([
    ['no imports', `const done = ${all()}.pipe(Effect.asVoid);`],
    [
      'a foreign root import',
      `import { Effect } from "local-effect"; const done = ${all()}.pipe(Effect.asVoid);`,
    ],
    [
      'a foreign namespace import',
      'import * as Fx from "local-effect"; const done = Fx.all([first]).pipe(Fx.asVoid);',
    ],
    [
      'a type-only root import',
      `import type { Effect } from "effect"; const done = ${all()}.pipe(Effect.asVoid);`,
    ],
    [
      'type-only named imports',
      'import { type all, type asVoid } from "effect/Effect"; const done = all([first]).pipe(asVoid);',
    ],
    [
      'a different root export aliased as Effect',
      'import { Chunk as Effect } from "effect"; const done = Effect.all([first]).pipe(Effect.asVoid);',
    ],
    [
      'local lookalikes',
      'import { Effect } from "effect"; const done = LocalEffect.all([first]).pipe(LocalEffect.asVoid);',
    ],
    [
      'direct root namespace APIs',
      'import * as Root from "effect"; const done = Root.all([first]).pipe(Root.asVoid);',
    ],
    [
      'a direct root collection with an official operator',
      'import * as Root from "effect"; const done = Root.all([first]).pipe(Root.Effect.asVoid);',
    ],
    [
      'an official collection with a direct root operator',
      'import * as Root from "effect"; const done = Root.Effect.all([first]).pipe(Root.asVoid);',
    ],
    [
      'a missing named asVoid import',
      'import { all } from "effect/Effect"; const done = all([first]).pipe(asVoid);',
    ],
    [
      'a missing named collection import',
      'import { asVoid } from "effect/Effect"; const done = all([first]).pipe(asVoid);',
    ],
  ])('ignores %s', (_name, source): void => {
    expect(reportsFor(source)).toHaveLength(0);
  });

  it.each([
    [
      'a root Effect binding',
      imported(
        `const run = (Effect: LocalEffect) => ${discarded(all()).replace(/^const done = /u, '')}`,
      ),
    ],
    [
      'an effect/Effect namespace binding',
      'import * as Fx from "effect/Effect"; const run = (Fx: LocalEffect) => Fx.all([first]).pipe(Fx.asVoid);',
    ],
    [
      'a named all binding',
      'import { all, asVoid } from "effect/Effect"; const run = (all: LocalAll) => all([first]).pipe(asVoid);',
    ],
    [
      'a named forEach binding',
      'import { forEach, asVoid } from "effect/Effect"; const run = (forEach: LocalForEach) => forEach(items, work).pipe(asVoid);',
    ],
    [
      'a named asVoid binding',
      'import { all, asVoid } from "effect/Effect"; const run = (asVoid: LocalAsVoid) => all([first]).pipe(asVoid);',
    ],
    [
      'a root package namespace binding',
      'import * as Root from "effect"; const run = (Root: LocalRoot) => Root.Effect.all([first]).pipe(Root.Effect.asVoid);',
    ],
  ])('respects lexical shadowing of %s', (_name, source): void => {
    expect(reportsFor(source)).toHaveLength(0);
  });
});
