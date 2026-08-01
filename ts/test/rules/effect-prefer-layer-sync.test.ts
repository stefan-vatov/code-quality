import { describe, expect, it } from 'vitest';
import type { SourceRule } from '../../src/rules/effect-rule-core';
import plugin from '../../src/rules/plugin';
import { runRule } from './effect-rule-test-utils';
import theThracianOxlint from '../../src/index';

const RULE_NAME = 'effect-prefer-layer-sync';
const EXPECTED_MESSAGE =
  'Layer.sync expresses synchronous service construction more directly than Layer.effect with Effect.sync.\n' +
  'Fix: Pass the Effect.sync thunk directly to Layer.sync.\n' +
  'Example:\n```ts\nimport { Layer } from "effect"\n\n' +
  'const live = Layer.sync(Service, () => makeService())\n```';

const imported = (statement: string): string =>
  `import { Effect, Layer } from "effect"; ${statement}`;
const candidate = (thunk = 'makeService'): string =>
  imported(`const live = Layer.effect(Service, Effect.sync(${thunk}));`);
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

describe('effect-prefer-layer-sync', (): void => {
  it('is registered as a problem and enabled as an error in the default config', (): void => {
    const rule = registeredRule();

    expect(rule.meta?.type).toBe('problem');
    expect(theThracianOxlint().rules).toHaveProperty(`thethracian/${RULE_NAME}`, 'error');
  });

  it.each(['Layer sync', 'effect sync', 'effect Layer', 'effect layer sync', 'Effect Layer sync'])(
    'keeps only the cheap Program visitor when source %j lacks a gate token',
    (source): void => {
      expect(visitorKeysFor(source)).toStrictEqual(['Program']);
    },
  );

  it.each(['effect Layer sync', 'sync effect Layer'])(
    'enables call analysis when every gate token occurs from offset zero in %j',
    (source): void => {
      expect(visitorKeysFor(source)).toStrictEqual(['CallExpression', 'Program']);
    },
  );

  it.each([
    ['the data-first form', candidate()],
    ['the curried form', imported('const live = Layer.effect(Service)(Effect.sync(makeService));')],
    ['an inline object-producing thunk', candidate('() => ({ load: () => value })')],
    ['an inline block with additional work', candidate('() => { observe(); return service; }')],
  ])('reports the exact diagnostic for %s', (_name, source): void => {
    const reports = reportsFor(source);

    expect(reports).toHaveLength(1);
    expect(reports[0]?.message).toBe(EXPECTED_MESSAGE);
  });

  it.each([
    [
      'root named imports',
      'import { Effect, Layer } from "effect"; Layer.effect(Service, Effect.sync(makeService));',
    ],
    [
      'aliased root named imports',
      'import { Effect as Fx, Layer as Layers } from "effect"; Layers.effect(Service, Fx.sync(makeService));',
    ],
    [
      'subpath namespaces',
      'import * as Fx from "effect/Effect"; import * as Layers from "effect/Layer"; Layers.effect(Service, Fx.sync(makeService));',
    ],
    [
      'aliased subpath named imports',
      'import { sync as defer } from "effect/Effect"; import { effect as fromEffect } from "effect/Layer"; fromEffect(Service, defer(makeService));',
    ],
    [
      'unaliased subpath named imports',
      'import { sync } from "effect/Effect"; import { effect } from "effect/Layer"; effect(Service, sync(makeService));',
    ],
    [
      'the APIs through a root package namespace',
      'import * as Root from "effect"; Root.Layer.effect(Service, Root.Effect.sync(makeService));',
    ],
    [
      'mixed root and subpath imports',
      'import { Layer } from "effect"; import { sync as defer } from "effect/Effect"; Layer.effect(Service)(defer(makeService));',
    ],
  ])('recognizes the shared Effect v3/v4 import idiom %s', (_name, source): void => {
    expect(reportsFor(source)).toHaveLength(1);
  });

  it('reports every independent exact construction', (): void => {
    const source = imported(
      'const first = Layer.effect(First, Effect.sync(makeFirst)); ' +
        'const second = Layer.effect(Second)(Effect.sync(makeSecond));',
    );

    expect(reportsFor(source)).toHaveLength(2);
  });

  it('publishes the exact diagnostic without an automatic fix', (): void => {
    const [report] = reportsFor(candidate());

    expect(report?.message).toBe(EXPECTED_MESSAGE);
    expect(Reflect.get(report ?? {}, 'fix')).toBeUndefined();
  });

  it('reports the Layer.effect callee as the diagnostic location', (): void => {
    const source = candidate();
    const [report] = reportsFor(source);
    const node = report?.node as { end?: number; start?: number; type?: string } | undefined;

    expect(node?.type).toBe('MemberExpression');
    expect(source.slice(node?.start, node?.end)).toBe('Layer.effect');
  });

  it.each([
    ['missing imports', 'Layer.effect(Service, Effect.sync(makeService));'],
    [
      'foreign namespace imports',
      'import { Effect, Layer } from "local-effect"; Layer.effect(Service, Effect.sync(makeService));',
    ],
    [
      'a type-only root import',
      'import type { Effect, Layer } from "effect"; Layer.effect(Service, Effect.sync(makeService));',
    ],
    [
      'type-only subpath specifiers',
      'import { type sync } from "effect/Effect"; import { type effect } from "effect/Layer"; effect(Service, sync(makeService));',
    ],
    [
      'an official Layer with a local Effect',
      'import { Layer } from "effect"; const Effect = localEffect; Layer.effect(Service, Effect.sync(makeService));',
    ],
    [
      'an official Effect with a local Layer',
      'import { Effect } from "effect"; const Layer = localLayer; Layer.effect(Service, Effect.sync(makeService));',
    ],
    [
      'an official Effect with a local curried Layer',
      'import { Effect } from "effect"; const Layer = localLayer; Layer.effect(Service)(Effect.sync(makeService));',
    ],
    [
      'a shadowed Layer binding',
      'import { Effect, Layer } from "effect"; function build(Layer: LocalLayer) { return Layer.effect(Service, Effect.sync(makeService)); }',
    ],
    [
      'a shadowed Effect binding',
      'import { Effect, Layer } from "effect"; function build(Effect: LocalEffect) { return Layer.effect(Service, Effect.sync(makeService)); }',
    ],
    [
      'shadowed named subpath aliases',
      'import { sync as defer } from "effect/Effect"; import { effect as fromEffect } from "effect/Layer"; function build(defer: LocalSync) { return fromEffect(Service, defer(makeService)); }',
    ],
  ])('rejects %s for import provenance or lexical identity', (_name, source): void => {
    expect(reportsFor(source)).toHaveLength(0);
  });

  it.each([
    [
      'a direct effect call on the root package namespace',
      'import * as Root from "effect"; Root.effect(Service, Root.Effect.sync(makeService));',
    ],
    [
      'a direct sync call on the root package namespace',
      'import * as Root from "effect"; Root.Layer.effect(Service, Root.sync(makeService));',
    ],
    [
      'a direct sync call in a curried root package construction',
      'import * as Root from "effect"; Root.Layer.effect(Service)(Root.sync(makeService));',
    ],
    ['a computed Layer method', imported('Layer["effect"](Service, Effect.sync(makeService));')],
    ['a computed Effect method', imported('Layer.effect(Service, Effect["sync"](makeService));')],
    ['an optional Layer member', imported('Layer?.effect(Service, Effect.sync(makeService));')],
    ['an optional Layer call', imported('Layer.effect?.(Service, Effect.sync(makeService));')],
    ['an optional Effect member', imported('Layer.effect(Service, Effect?.sync(makeService));')],
    ['an optional Effect call', imported('Layer.effect(Service, Effect.sync?.(makeService));')],
    [
      'Layer.effect type arguments',
      imported('Layer.effect<Service>(Service, Effect.sync(makeService));'),
    ],
    [
      'Effect.sync type arguments',
      imported('Layer.effect(Service, Effect.sync<Service>(makeService));'),
    ],
    ['a spread outer argument', imported('Layer.effect(...args);')],
    ['a spread inner argument', imported('Layer.effect(Service, Effect.sync(...thunks));')],
    ['a missing service tag', imported('Layer.effect(Effect.sync(makeService));')],
    [
      'an extra outer argument',
      imported('Layer.effect(Service, Effect.sync(makeService), options);'),
    ],
    ['a missing sync thunk', imported('Layer.effect(Service, Effect.sync());')],
    [
      'an extra sync argument',
      imported('Layer.effect(Service, Effect.sync(makeService, options));'),
    ],
    ['an empty curried head', imported('Layer.effect()(Effect.sync(makeService));')],
    [
      'an extra curried head argument',
      imported('Layer.effect(Service, Other)(Effect.sync(makeService));'),
    ],
    ['an empty curried application', imported('Layer.effect(Service)();')],
    [
      'an extra curried application argument',
      imported('Layer.effect(Service)(Effect.sync(makeService), options);'),
    ],
    ['a wrapped sync call', imported('Layer.effect(Service, Effect.sync(makeService) as any);')],
    ['a pipe expression', imported('Effect.sync(makeService).pipe(Layer.effect(Service));')],
    [
      'a locally aliased curried constructor',
      imported('const fromService = Layer.effect(Service); fromService(Effect.sync(makeService));'),
    ],
  ])('rejects unsupported call grammar: %s', (_name, source): void => {
    expect(reportsFor(source)).toHaveLength(0);
  });

  it.each([
    ['Layer.sync', imported('Layer.sync(Service, makeService);')],
    [
      'Layer.effect with Effect.succeed',
      imported('Layer.effect(Service, Effect.succeed(service));'),
    ],
    ['Layer.effect with another Effect', imported('Layer.effect(Service, makeEffect());')],
    [
      'curried Layer.effect with Effect.succeed',
      imported('Layer.effect(Service)(Effect.succeed(service));'),
    ],
    ['curried Layer.effect with another Effect', imported('Layer.effect(Service)(makeEffect());')],
  ])('accepts the canonical or unrelated construction %s', (_name, source): void => {
    expect(reportsFor(source)).toHaveLength(0);
  });

  it.each([
    ['a number literal', '() => 1'],
    ['a string literal', '() => "service"'],
    ['a boolean literal', '() => true'],
    ['null', '() => null'],
    ['the global undefined value', '() => undefined'],
    ['a bare identifier', '() => service'],
    ['a sole-return number block', '() => { return 1; }'],
    ['a sole-return undefined block', '() => { return undefined; }'],
    ['a sole-return identifier block', '() => { return service; }'],
    ['an ordinary function with a sole stable return', 'function () { return service; }'],
  ])('defers stable thunk %s to the stronger Layer.succeed guidance', (_name, thunk): void => {
    expect(reportsFor(candidate(thunk))).toHaveLength(0);
  });

  it.each([
    ['an identifier thunk', 'makeService'],
    ['a call-producing thunk', '() => makeService()'],
    ['an object-producing thunk', '() => ({ service })'],
    ['an array-producing thunk', '() => [service]'],
    ['a constructor-producing thunk', '() => new Service()'],
    ['a parameterized arrow returning its parameter', 'service => service'],
    ['an async arrow returning an identifier', 'async () => service'],
    ['a generator function returning an identifier', 'function* () { return service; }'],
    ['a block with work before a stable return', '() => { observe(); return service; }'],
    ['a block with work after a stable return', '() => { return service; observe(); }'],
    ['a throwing block', '() => { throw service; }'],
    ['an ordinary function with a computed return', 'function () { return makeService(); }'],
  ])('reports non-stable synchronous thunk %s', (_name, thunk): void => {
    expect(reportsFor(candidate(thunk))).toHaveLength(1);
  });
});
