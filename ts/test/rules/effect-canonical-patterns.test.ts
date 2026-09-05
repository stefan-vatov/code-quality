import { describe, expect, it } from 'vitest';
import config from '../../src/index';
import { runRule } from './effect-rule-test-utils';
import { benchmarkNativeRule } from '../../bench/performance-native-harness';
import plugin from '../../src/rules/plugin';

const canonicalCases = [
  [
    'no-catchAll-with-mapError',
    'Effect.catchAll(job, e => Effect.fail(wrap(e)))',
    'Effect.mapError(job, wrap)',
  ],
  ['prefer-effect-void', 'Effect.succeed(undefined)', 'Effect.void'],
  ['prefer-asVoid', 'Effect.map(job, () => undefined)', 'Effect.map(job, () => { log(); })'],
  [
    'prefer-flatMap-over-map-flatten',
    'Effect.flatten(Effect.map(job, f))',
    'Effect.flatMap(job, f)',
  ],
  [
    'prefer-succeed-for-static-layers',
    'Layer.effect(Service, Effect.succeed(value))',
    'Layer.succeed(Service, value)',
  ],
  [
    'prefer-schema-tagged-struct',
    'Schema.Struct({ _tag: Schema.Literal("User"), id: Schema.String })',
    'Schema.TaggedStruct("User", { id: Schema.String })',
  ],
  [
    'prefer-single-schema-literal-union',
    'Schema.Union(Schema.Literal("a"), Schema.Literal("b"))',
    'Schema.Union(Schema.Literal("a").annotations({ title: "A" }), Schema.Literal("b"))',
  ],
  [
    'schema-require-parseJson-for-json-strings',
    'Schema.decodeUnknownSync(Schema.String)(JSON.parse(text))',
    'Schema.decodeUnknownSync(Schema.parseJson(Schema.String))(text)',
  ],
  [
    'schema-no-cast-after-decode',
    'Schema.decodeUnknownSync(schema)(input) as User',
    'Schema.decodeUnknownSync(schema)(input)',
  ],
  [
    'no-error-channel-widening-to-unknown',
    'null as Effect.Effect<string, unknown>',
    'null as Effect.Effect<unknown, Failure>',
  ],
  [
    'require-service-class-pattern',
    'Context.GenericTag<Service>("Service")',
    'class Service extends Context.Tag("Service")<Service, API>() {}',
  ],
  [
    'require-deterministic-service-keys',
    'class Service extends Context.Tag("Other")<Service, API>() {}',
    'class Service extends Context.Tag("app/Service")<Service, API>() {}',
  ],
] as const;

describe('canonical Effect patterns', () => {
  it('does not recommend string-tagged structs for numeric tags', () => {
    expect(
      runRule(
        'effect-prefer-schema-tagged-struct',
        'import { Schema } from "effect"; Schema.Struct({ _tag: Schema.Literal(1) })',
      ),
    ).toHaveLength(0);
  });
  it('checks identifiers on curried Effect.Service classes', () => {
    expect(
      runRule(
        'effect-require-deterministic-service-keys',
        'import { Effect } from "effect"; class Service extends Effect.Service<Service>()("Other", { succeed: {} }) {}',
      ),
    ).toHaveLength(1);
    expect(
      runRule(
        'effect-require-deterministic-service-keys',
        'import { Effect } from "effect"; class Service extends Effect.Service<Service>()("app/Service", { succeed: {} }) {}',
      ),
    ).toHaveLength(0);
  });
  for (const [suffix, invalid, valid] of canonicalCases) {
    const name = `effect-${suffix}`;
    const imports = 'import { Effect, Layer, Schema, Context } from "effect"; ';
    it(`${name} is enabled as an error`, () => {
      expect(config({ effect: true }).rules).toHaveProperty(`thethracian/${name}`, 'error');
      expect(config().rules).not.toHaveProperty(`thethracian/${name}`);
    });
    it(`${name} rejects the noncanonical pattern`, () => {
      expect(runRule(name, imports + invalid)).toHaveLength(1);
    });
    it(`${name} accepts the canonical or semantically distinct pattern`, () => {
      expect(runRule(name, imports + valid)).toHaveLength(0);
    });
    it(`${name} reports through the native Oxlint host`, () => {
      const result = benchmarkNativeRule(
        name,
        plugin.rules[name],
        [{ filename: 'src/native.ts', source: imports + invalid }],
        { iterations: 1, warmups: 0, cold: true },
      );
      expect(result.reports).toBe(1);
    });
    it(`${name} accepts its valid case through the native host`, () => {
      expect(
        benchmarkNativeRule(
          name,
          plugin.rules[name],
          [{ filename: 'src/native-valid.ts', source: imports + valid }],
          { iterations: 1, warmups: 0, cold: true },
        ).reports,
      ).toBe(0);
    });
    it(`${name} ignores unrelated imports`, () => {
      expect(runRule(name, imports.replace('"effect"', '"other"') + invalid)).toHaveLength(0);
    });
    it(`${name} recognizes import aliases`, () => {
      const aliased = (imports + invalid)
        .replaceAll('Effect', 'E')
        .replaceAll('Schema', 'S')
        .replaceAll('Layer', 'L')
        .replaceAll('Context', 'C')
        .replace('{ E, L, S, C }', '{ Effect as E, Layer as L, Schema as S, Context as C }');
      expect(runRule(name, aliased.replace('E.E<', 'E.Effect<'))).toHaveLength(1);
    });
  }
  it('does not discard side effects in a map callback', () => {
    expect(
      runRule(
        'effect-prefer-asVoid',
        'import { Effect } from "effect"; Effect.map(job, () => { log(); return undefined; })',
      ),
    ).toHaveLength(0);
  });
  it('does not treat void expressions with side effects as pure', () => {
    expect(
      runRule(
        'effect-prefer-effect-void',
        'import { Effect } from "effect"; Effect.succeed(void log())',
      ),
    ).toHaveLength(0);
  });
  it('does not match a shadowed Effect namespace', () => {
    expect(
      runRule(
        'effect-prefer-effect-void',
        'import { Effect } from "effect"; function f(Effect) { return Effect.succeed(undefined); }',
      ),
    ).toHaveLength(0);
  });
  it('recognizes data-last map/flatten pipelines', () => {
    expect(
      runRule(
        'effect-prefer-flatMap-over-map-flatten',
        'import { Effect } from "effect"; job.pipe(Effect.map(f), Effect.flatten)',
      ),
    ).toHaveLength(1);
  });
  it('does not replace a shadowed undefined value', () => {
    expect(
      runRule(
        'effect-prefer-effect-void',
        'import { Effect } from "effect"; function f(undefined) { return Effect.succeed(undefined); }',
      ),
    ).toHaveLength(0);
  });
  it('does not replace a shadowed JSON parser', () => {
    expect(
      runRule(
        'effect-schema-require-parseJson-for-json-strings',
        'import { Schema } from "effect"; function f(JSON) { return Schema.decodeUnknownSync(schema)(JSON.parse(text)); }',
      ),
    ).toHaveLength(0);
  });
  it('recognizes type-only direct Effect imports', () => {
    expect(
      runRule(
        'effect-no-error-channel-widening-to-unknown',
        'import type { Effect as Task } from "effect/Effect"; type Work = Task<string, unknown>;',
      ),
    ).toHaveLength(1);
  });
  it('recognizes root namespace Effect types', () => {
    expect(
      runRule(
        'effect-no-error-channel-widening-to-unknown',
        'import type * as Fx from "effect"; type Work = Fx.Effect.Effect<string, unknown>;',
      ),
    ).toHaveLength(1);
  });
  it('preserves shadowed Effect type parameters', () => {
    expect(
      runRule(
        'effect-no-error-channel-widening-to-unknown',
        'import type { Effect as Task } from "effect/Effect"; type Work<Task> = Task<string, unknown>;',
      ),
    ).toHaveLength(0);
  });
  it('preserves callback parameter initializers', () => {
    expect(
      runRule(
        'effect-prefer-asVoid',
        'import { Effect } from "effect"; Effect.map(job, (value = log()) => undefined)',
      ),
    ).toHaveLength(0);
  });
  it('preserves JSON reviver semantics', () => {
    expect(
      runRule(
        'effect-schema-require-parseJson-for-json-strings',
        'import { Schema } from "effect"; Schema.decodeUnknownSync(schema)(JSON.parse(text, revive))',
      ),
    ).toHaveLength(0);
  });
});
