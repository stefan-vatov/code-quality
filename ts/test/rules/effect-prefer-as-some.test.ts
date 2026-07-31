import { describe, expect, it } from 'vitest';
import type { SourceRule } from '../../src/rules/effect-rule-core';
import plugin from '../../src/rules/plugin';
import { runRule } from './effect-rule-test-utils';
import theThracianOxlint from '../../src/index';

const RULE_NAME = 'effect-prefer-asSome';
const EXPECTED_MESSAGE =
  'Effect.asSome expresses mapping an Effect success value to Option.some more directly than Effect.map(Option.some).\n' +
  'Fix: Use the asSome export from the same Effect import style instead of mapping with Option.some.\n' +
  'Example:\n```ts\nimport { Effect } from "effect"\n\nconst optional = Effect.asSome(program)\n```';

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

describe('effect-prefer-asSome', (): void => {
  it('is registered as an error in the default Effect config', (): void => {
    expect(theThracianOxlint().rules).toHaveProperty(`thethracian/${RULE_NAME}`, 'error');
  });

  it.each(['const value = 1;', 'map', 'some'])(
    'keeps only the cheap Program visitor when the source %j cannot contain a candidate',
    (source): void => {
      expect(visitorKeysFor(source)).toStrictEqual(['Program']);
    },
  );

  it('enables call analysis when both candidate tokens are present from offset zero', (): void => {
    expect(visitorKeysFor('map some')).toStrictEqual(['CallExpression', 'Program']);
  });

  it.each([
    [
      'data-first form',
      'import { Effect, Option } from "effect"; const optional = Effect.map(program, Option.some);',
    ],
    [
      'curried form',
      'import { Effect, Option } from "effect"; const optional = Effect.map(Option.some)(program);',
    ],
    [
      'curried form in a pipe',
      'import { Effect, Option } from "effect"; const optional = program.pipe(Effect.map(Option.some));',
    ],
  ])('reports the exact diagnostic for the %s', (_name, source): void => {
    const reports = reportsFor(source);

    expect(reports).toHaveLength(1);
    expect(reports[0]?.message).toBe(EXPECTED_MESSAGE);
  });

  it('reports without offering an automatic fix', (): void => {
    const source =
      'import { Effect, Option } from "effect"; const optional = Effect.map(program, Option.some);';
    const [report] = reportsFor(source);

    expect(Reflect.get(report ?? {}, 'fix')).toBeUndefined();
  });

  it('reports the map callee as the diagnostic location', (): void => {
    const source =
      'import { Effect, Option } from "effect"; const optional = Effect.map(program, Option.some);';
    const [report] = reportsFor(source);
    const node = report?.node as { end?: number; start?: number; type?: string } | undefined;

    expect(node?.type).toBe('MemberExpression');
    expect(source.slice(node?.start, node?.end)).toBe('Effect.map');
  });

  it.each([
    [
      'root named imports',
      'import { Effect, Option } from "effect"; const optional = Effect.map(program, Option.some);',
    ],
    [
      'root named aliases',
      'import { Effect as Fx, Option as Maybe } from "effect"; const optional = Fx.map(program, Maybe.some);',
    ],
    [
      'subpath namespaces',
      'import * as Fx from "effect/Effect"; import * as Maybe from "effect/Option"; const optional = Fx.map(program, Maybe.some);',
    ],
    [
      'subpath named aliases',
      'import { map as transform } from "effect/Effect"; import { some as present } from "effect/Option"; const optional = transform(program, present);',
    ],
    [
      'root package namespace',
      'import * as EffectPackage from "effect"; const optional = EffectPackage.Effect.map(program, EffectPackage.Option.some);',
    ],
    [
      'root Effect with a subpath Option namespace',
      'import { Effect } from "effect"; import * as Maybe from "effect/Option"; const optional = Effect.map(Maybe.some);',
    ],
    [
      'direct map with a root Option import',
      'import { Option } from "effect"; import { map as transform } from "effect/Effect"; const optional = transform(Option.some);',
    ],
    [
      'root Effect alias with a direct some import',
      'import { Effect as Fx } from "effect"; import { some as present } from "effect/Option"; const optional = program.pipe(Fx.map(present));',
    ],
  ])('recognizes genuine %s', (_name, source): void => {
    expect(reportsFor(source)).toHaveLength(1);
  });

  it.each([
    ['no imports', 'const optional = Effect.map(program, Option.some);'],
    [
      'unrelated root imports',
      'import { Effect, Option } from "local-effect"; const optional = Effect.map(program, Option.some);',
    ],
    [
      'an unrelated Option import',
      'import { Effect } from "effect"; import { Option } from "local-effect"; const optional = Effect.map(program, Option.some);',
    ],
    [
      'an unrelated Effect import',
      'import { Option } from "effect"; import { Effect } from "local-effect"; const optional = Effect.map(program, Option.some);',
    ],
    [
      'a different root export aliased as Option',
      'import { Chunk as Option, Effect } from "effect"; Effect.map(program, Option.some);',
    ],
    [
      'a different Option export aliased as some',
      'import { Effect } from "effect"; import { none as some } from "effect/Option"; Effect.map(program, some);',
    ],
    [
      'a some import from an unrelated module',
      'import { Effect } from "effect"; import { some } from "local-effect"; Effect.map(program, some);',
    ],
    [
      'root type-only imports',
      'import type { Effect, Option } from "effect"; const optional = Effect.map(program, Option.some);',
    ],
    [
      'a type-only Effect specifier',
      'import { type Effect, Option } from "effect"; const optional = Effect.map(program, Option.some);',
    ],
    [
      'a type-only Option specifier',
      'import { Effect, type Option } from "effect"; const optional = Effect.map(program, Option.some);',
    ],
    [
      'a type-only Effect subpath namespace',
      'import type * as Fx from "effect/Effect"; import * as Maybe from "effect/Option"; const optional = Fx.map(program, Maybe.some);',
    ],
    [
      'a type-only Option subpath namespace',
      'import * as Fx from "effect/Effect"; import type * as Maybe from "effect/Option"; const optional = Fx.map(program, Maybe.some);',
    ],
  ])('ignores %s', (_name, source): void => {
    expect(reportsFor(source)).toHaveLength(0);
  });

  it.each([
    [
      'a root Effect binding',
      'import { Effect, Option } from "effect"; const make = (Effect: LocalEffect) => Effect.map(program, Option.some);',
    ],
    [
      'a root Option binding',
      'import { Effect, Option } from "effect"; const make = (Option: LocalOption) => Effect.map(program, Option.some);',
    ],
    [
      'a direct map binding',
      'import { map } from "effect/Effect"; import { some } from "effect/Option"; const make = (map: LocalMap) => map(program, some);',
    ],
    [
      'a direct some binding',
      'import { map } from "effect/Effect"; import { some } from "effect/Option"; const make = (some: LocalSome) => map(program, some);',
    ],
  ])('respects shadowing of %s', (_name, source): void => {
    expect(reportsFor(source)).toHaveLength(0);
  });

  it.each([
    [
      'a computed map access',
      'import { Effect, Option } from "effect"; const optional = Effect["map"](program, Option.some);',
    ],
    [
      'a computed some access',
      'import { Effect, Option } from "effect"; const optional = Effect.map(program, Option["some"]);',
    ],
    [
      'an optional Effect access',
      'import { Effect, Option } from "effect"; const optional = Effect?.map(program, Option.some);',
    ],
    [
      'an optional Option access',
      'import { Effect, Option } from "effect"; const optional = Effect.map(program, Option?.some);',
    ],
    [
      'an optional map call',
      'import { Effect, Option } from "effect"; const optional = Effect.map?.(program, Option.some);',
    ],
    [
      'a computed root-package Effect access',
      'import * as EffectPackage from "effect"; const optional = EffectPackage["Effect"].map(program, EffectPackage.Option.some);',
    ],
    [
      'a computed root-package Option access',
      'import * as EffectPackage from "effect"; const optional = EffectPackage.Effect.map(program, EffectPackage["Option"].some);',
    ],
    [
      'a computed Option access through an identifier',
      'import { Effect, Option } from "effect"; const some = "some"; Effect.map(program, Option[some]);',
    ],
    [
      'a computed root-package middle access through an identifier',
      'import * as EffectPackage from "effect"; const Option = "Option"; EffectPackage.Effect.map(program, EffectPackage[Option].some);',
    ],
  ])('preserves %s', (_name, source): void => {
    expect(reportsFor(source)).toHaveLength(0);
  });

  it.each([
    ['Effect.asSome', 'import { Effect } from "effect"; const optional = Effect.asSome(program);'],
    [
      'a direct asSome import',
      'import { asSome } from "effect/Effect"; const optional = asSome(program);',
    ],
    [
      'standalone Option.some',
      'import { Option } from "effect"; const present = Option.some(value);',
    ],
    [
      'a different map callback',
      'import { Effect } from "effect"; const changed = Effect.map(program, String);',
    ],
  ])('accepts %s', (_name, source): void => {
    expect(reportsFor(source)).toHaveLength(0);
  });

  it.each([
    [
      'a data-first arrow wrapper',
      'import { Effect, Option } from "effect"; const optional = Effect.map(program, (value) => Option.some(value));',
    ],
    [
      'a curried arrow wrapper',
      'import { Effect, Option } from "effect"; const optional = Effect.map((value) => Option.some(value))(program);',
    ],
    [
      'a function wrapper',
      'import { Effect, Option } from "effect"; const optional = Effect.map(program, function (value) { return Option.some(value); });',
    ],
  ])('leaves %s to a future broader matcher', (_name, source): void => {
    expect(reportsFor(source)).toHaveLength(0);
  });

  it.each([
    [
      'type arguments on data-first Effect.map',
      'import { Effect, Option } from "effect"; const optional = Effect.map<number, Option.Option<number>>(program, Option.some);',
    ],
    [
      'type arguments on curried Effect.map',
      'import { Effect, Option } from "effect"; const optional = Effect.map<number, Option.Option<number>>(Option.some)(program);',
    ],
    [
      'an Option.some instantiation expression',
      'import { Effect, Option } from "effect"; const optional = Effect.map(program, Option.some<number>);',
    ],
    [
      'an as assertion around Option.some',
      'import { Effect, Option } from "effect"; const optional = Effect.map(program, Option.some as typeof Option.some);',
    ],
    [
      'a satisfies wrapper around Option.some',
      'import { Effect, Option } from "effect"; const optional = Effect.map(program, Option.some satisfies typeof Option.some);',
    ],
    [
      'a non-null wrapper around Option.some',
      'import { Effect, Option } from "effect"; const optional = Effect.map(program, Option.some!);',
    ],
    [
      'an angle-bracket assertion around Option.some',
      'import { Effect, Option } from "effect"; const optional = Effect.map(program, <typeof Option.some>Option.some);',
    ],
  ])('preserves %s', (_name, source): void => {
    expect(reportsFor(source)).toHaveLength(0);
  });

  it.each([
    [
      'a zero-argument map call',
      'import { Effect, Option } from "effect"; const optional = Effect.map();',
    ],
    [
      'a data-first map call without a callback',
      'import { Effect, Option } from "effect"; const optional = Effect.map(program);',
    ],
    [
      'a three-argument map call',
      'import { Effect, Option } from "effect"; const optional = Effect.map(program, Option.some, extra);',
    ],
    [
      'a three-argument map call ending in Option.some',
      'import { Effect, Option } from "effect"; Effect.map(program, extra, Option.some);',
    ],
    [
      'a spread-only map call',
      'import { Effect, Option } from "effect"; const optional = Effect.map(...[program, Option.some]);',
    ],
    [
      'a spread data argument',
      'import { Effect, Option } from "effect"; const optional = Effect.map(...[program], Option.some);',
    ],
    [
      'a spread callback',
      'import { Effect, Option } from "effect"; const optional = Effect.map(program, ...[Option.some]);',
    ],
    [
      'a spread curried callback',
      'import { Effect, Option } from "effect"; const optional = Effect.map(...[Option.some])(program);',
    ],
  ])('ignores %s', (_name, source): void => {
    expect(reportsFor(source)).toHaveLength(0);
  });

  it.each([
    [
      'data-first form',
      'import { Effect, Option } from "effect"; const optional = Effect.map(program, ((Option.some)));',
    ],
    [
      'curried form',
      'import { Effect, Option } from "effect"; const optional = Effect.map(((Option.some)))(program);',
    ],
  ])('reports parenthesized Option.some in the %s', (_name, source): void => {
    expect(reportsFor(source)).toHaveLength(1);
  });

  it.each([
    [
      'an official Effect with a local Option lookalike',
      'import { Effect } from "effect"; const Option = LocalOption; const optional = Effect.map(program, Option.some);',
    ],
    [
      'an official Option with a local Effect lookalike',
      'import { Option } from "effect"; const Effect = LocalEffect; const optional = Effect.map(program, Option.some);',
    ],
    [
      'unrelated direct imports',
      'import { map, some } from "local-effect"; const optional = map(program, some);',
    ],
    [
      'an unrelated map member',
      'import { Option } from "effect"; const optional = LocalEffect.map(program, Option.some);',
    ],
    [
      'an unrelated some member',
      'import { Effect } from "effect"; const optional = Effect.map(program, LocalOption.some);',
    ],
    [
      'a different Option callback',
      'import { Effect, Option } from "effect"; Effect.map(program, Option.isSome);',
    ],
    [
      'a direct some import misused as a namespace',
      'import { Effect } from "effect"; import { some as Maybe } from "effect/Option"; Effect.map(program, Maybe.some);',
    ],
    [
      'an Effect root-package member used as the callback namespace',
      'import * as EffectPackage from "effect"; EffectPackage.Effect.map(program, EffectPackage.Effect.some);',
    ],
    [
      'an Option subpath namespace misused as a root package',
      'import { Effect } from "effect"; import * as Maybe from "effect/Option"; Effect.map(program, Maybe.Option.some);',
    ],
  ])('ignores %s', (_name, source): void => {
    expect(reportsFor(source)).toHaveLength(0);
  });

  it('reports every direct occurrence', (): void => {
    const source =
      'import { Effect, Option } from "effect"; const first = Effect.map(one, Option.some); const second = Effect.map(Option.some)(two);';

    expect(reportsFor(source)).toHaveLength(2);
  });
});
