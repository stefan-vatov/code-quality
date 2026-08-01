import { describe, expect, it } from 'vitest';
import type { SourceRule } from '../../src/rules/effect-rule-core';
import plugin from '../../src/rules/plugin';
import { runRule } from './effect-rule-test-utils';
import theThracianOxlint from '../../src/index';

const RULE_NAME = 'effect-prefer-succeedSome';
const EXPECTED_MESSAGE =
  'Effect.succeedSome expresses a successful Some more directly than Effect.succeed(Option.some(value)).\n' +
  'Fix: Use the succeedSome export from the same Effect import style and pass the value directly.\n' +
  'Example:\n```ts\nimport { Effect } from "effect"\n\nconst task = Effect.succeedSome(value)\n```';

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

describe('effect-prefer-succeedSome', (): void => {
  it('is registered as an error in the default Effect config', (): void => {
    expect(theThracianOxlint().rules).toHaveProperty(`thethracian/${RULE_NAME}`, 'error');
  });

  it.each(['const value = 1;', 'succeed', 'some'])(
    'keeps only the cheap Program visitor when the source %j cannot contain a candidate',
    (source): void => {
      expect(visitorKeysFor(source)).toStrictEqual(['Program']);
    },
  );

  it('enables call analysis when both candidate tokens are present from offset zero', (): void => {
    expect(visitorKeysFor('succeed some')).toStrictEqual(['CallExpression', 'Program']);
  });

  it('reports the exact diagnostic for a direct nested call', (): void => {
    const source =
      'import { Effect, Option } from "effect"; const task = Effect.succeed(Option.some(value));';
    const reports = reportsFor(source);

    expect(reports).toHaveLength(1);
    expect(reports[0]?.message).toBe(EXPECTED_MESSAGE);
  });

  it.each([
    [
      'namespace aliases',
      'import * as Fx from "effect/Effect"; import * as Maybe from "effect/Option"; const task = Fx.succeed(Maybe.some(value));',
    ],
    [
      'direct named aliases',
      'import { succeed as success } from "effect/Effect"; import { some as present } from "effect/Option"; const task = success(present(value));',
    ],
  ])('reports import-style-neutral guidance for %s', (_name, source): void => {
    const reports = reportsFor(source);

    expect(reports).toHaveLength(1);
    expect(reports[0]?.message).toBe(EXPECTED_MESSAGE);
  });

  it('reports the outer succeed callee as the diagnostic location', (): void => {
    const source =
      'import { Effect, Option } from "effect"; const task = Effect.succeed(Option.some(value));';
    const [report] = reportsFor(source);
    const node = report?.node as { end?: number; start?: number; type?: string } | undefined;

    expect(node?.type).toBe('MemberExpression');
    expect(source.slice(node?.start, node?.end)).toBe('Effect.succeed');
  });

  it.each([
    [
      'root named imports',
      'import { Effect, Option } from "effect"; const task = Effect.succeed(Option.some(value));',
    ],
    [
      'root named aliases',
      'import { Effect as Fx, Option as Maybe } from "effect"; const task = Fx.succeed(Maybe.some(value));',
    ],
    [
      'subpath namespaces',
      'import * as Fx from "effect/Effect"; import * as Maybe from "effect/Option"; const task = Fx.succeed(Maybe.some(value));',
    ],
    [
      'subpath named aliases',
      'import { succeed as success } from "effect/Effect"; import { some as present } from "effect/Option"; const task = success(present(value));',
    ],
    [
      'root package namespace',
      'import * as EffectPackage from "effect"; const task = EffectPackage.Effect.succeed(EffectPackage.Option.some(value));',
    ],
    [
      'root Effect with a subpath Option namespace',
      'import { Effect } from "effect"; import * as Maybe from "effect/Option"; const task = Effect.succeed(Maybe.some(value));',
    ],
    [
      'direct succeed with a root Option import',
      'import { Option } from "effect"; import { succeed as success } from "effect/Effect"; const task = success(Option.some(value));',
    ],
    [
      'root Effect alias with a direct some import',
      'import { Effect as Fx } from "effect"; import { some as present } from "effect/Option"; const task = Fx.succeed(present(value));',
    ],
  ])('recognizes genuine %s', (_name, source): void => {
    expect(reportsFor(source)).toHaveLength(1);
  });

  it.each([
    ['no imports', 'const task = Effect.succeed(Option.some(value));'],
    [
      'unrelated root imports',
      'import { Effect, Option } from "local-effect"; const task = Effect.succeed(Option.some(value));',
    ],
    [
      'an unrelated Option import',
      'import { Effect } from "effect"; import { Option } from "local-effect"; const task = Effect.succeed(Option.some(value));',
    ],
    [
      'an unrelated Effect import',
      'import { Option } from "effect"; import { Effect } from "local-effect"; const task = Effect.succeed(Option.some(value));',
    ],
    [
      'root type-only imports',
      'import type { Effect, Option } from "effect"; const task = Effect.succeed(Option.some(value));',
    ],
    [
      'a type-only Effect specifier',
      'import { type Effect, Option } from "effect"; const task = Effect.succeed(Option.some(value));',
    ],
    [
      'a type-only Option specifier',
      'import { Effect, type Option } from "effect"; const task = Effect.succeed(Option.some(value));',
    ],
    [
      'a type-only Effect subpath namespace',
      'import type * as Fx from "effect/Effect"; import * as Maybe from "effect/Option"; const task = Fx.succeed(Maybe.some(value));',
    ],
    [
      'a type-only Option subpath namespace',
      'import * as Fx from "effect/Effect"; import type * as Maybe from "effect/Option"; const task = Fx.succeed(Maybe.some(value));',
    ],
  ])('ignores %s', (_name, source): void => {
    expect(reportsFor(source)).toHaveLength(0);
  });

  it.each([
    [
      'a root Effect binding',
      'import { Effect, Option } from "effect"; const make = (Effect: LocalEffect) => Effect.succeed(Option.some(value));',
    ],
    [
      'a root Option binding',
      'import { Effect, Option } from "effect"; const make = (Option: LocalOption) => Effect.succeed(Option.some(value));',
    ],
    [
      'a direct succeed binding',
      'import { succeed } from "effect/Effect"; import { some } from "effect/Option"; const make = (succeed: LocalSucceed) => succeed(some(value));',
    ],
    [
      'a direct some binding',
      'import { succeed } from "effect/Effect"; import { some } from "effect/Option"; const make = (some: LocalSome) => succeed(some(value));',
    ],
  ])('respects shadowing of %s', (_name, source): void => {
    expect(reportsFor(source)).toHaveLength(0);
  });

  it.each([
    [
      'a computed succeed access',
      'import { Effect, Option } from "effect"; const task = Effect["succeed"](Option.some(value));',
    ],
    [
      'a computed some access',
      'import { Effect, Option } from "effect"; const task = Effect.succeed(Option["some"](value));',
    ],
    [
      'an optional Effect access',
      'import { Effect, Option } from "effect"; const task = Effect?.succeed(Option.some(value));',
    ],
    [
      'an optional Option access',
      'import { Effect, Option } from "effect"; const task = Effect.succeed(Option?.some(value));',
    ],
    [
      'an optional succeed call',
      'import { Effect, Option } from "effect"; const task = Effect.succeed?.(Option.some(value));',
    ],
    [
      'an optional some call',
      'import { Effect, Option } from "effect"; const task = Effect.succeed(Option.some?.(value));',
    ],
    [
      'a computed root-package Effect access',
      'import * as EffectPackage from "effect"; const task = EffectPackage["Effect"].succeed(EffectPackage.Option.some(value));',
    ],
    [
      'a computed root-package Option access',
      'import * as EffectPackage from "effect"; const task = EffectPackage.Effect.succeed(EffectPackage["Option"].some(value));',
    ],
  ])('preserves %s', (_name, source): void => {
    expect(reportsFor(source)).toHaveLength(0);
  });

  it.each([
    [
      'Effect.succeedSome',
      'import { Effect } from "effect"; const task = Effect.succeedSome(value);',
    ],
    [
      'a direct succeedSome import',
      'import { succeedSome } from "effect/Effect"; const task = succeedSome(value);',
    ],
    ['standalone Option.some', 'import { Option } from "effect"; const value = Option.some(1);'],
    [
      'Effect.succeed around Option.none',
      'import { Effect, Option } from "effect"; const task = Effect.succeed(Option.none());',
    ],
  ])('accepts %s', (_name, source): void => {
    expect(reportsFor(source)).toHaveLength(0);
  });

  it.each([
    ['Option.none', 'Option.none()'],
    ['Option.fromNullable', 'Option.fromNullable(value)'],
    ['an unrelated factory', 'LocalOption.some(value)'],
  ])('ignores succeed around %s', (_name, expression): void => {
    const source =
      `import { Effect, Option } from "effect"; declare const value: unknown; ` +
      `const task = Effect.succeed(${expression});`;

    expect(reportsFor(source)).toHaveLength(0);
  });

  it.each([
    [
      'a zero-argument succeed call',
      'import { Effect, Option } from "effect"; const task = Effect.succeed();',
    ],
    [
      'a two-argument succeed call',
      'import { Effect, Option } from "effect"; const task = Effect.succeed(Option.some(value), value);',
    ],
    [
      'a spread succeed argument',
      'import { Effect, Option } from "effect"; const task = Effect.succeed(...[Option.some(value)]);',
    ],
    [
      'a zero-argument Option.some call',
      'import { Effect, Option } from "effect"; const task = Effect.succeed(Option.some());',
    ],
    [
      'a two-argument Option.some call',
      'import { Effect, Option } from "effect"; const task = Effect.succeed(Option.some(value, other));',
    ],
    [
      'a spread Option.some argument',
      'import { Effect, Option } from "effect"; const task = Effect.succeed(Option.some(...values));',
    ],
  ])('ignores %s', (_name, source): void => {
    expect(reportsFor(source)).toHaveLength(0);
  });

  it.each([
    [
      'type arguments on Effect.succeed',
      'import { Effect, Option } from "effect"; const task = Effect.succeed<Option.Option<number>>(Option.some(value));',
    ],
    [
      'type arguments on Option.some',
      'import { Effect, Option } from "effect"; const task = Effect.succeed(Option.some<number>(value));',
    ],
    [
      'an as assertion around Option.some',
      'import { Effect, Option } from "effect"; const task = Effect.succeed(Option.some(value) as Option.Option<number>);',
    ],
    [
      'a satisfies wrapper around Option.some',
      'import { Effect, Option } from "effect"; const task = Effect.succeed(Option.some(value) satisfies Option.Option<number>);',
    ],
    [
      'a non-null wrapper around Option.some',
      'import { Effect, Option } from "effect"; const task = Effect.succeed(Option.some(value)!);',
    ],
    [
      'an angle-bracket assertion around Option.some',
      'import { Effect, Option } from "effect"; const task = Effect.succeed(<Option.Option<number>>Option.some(value));',
    ],
  ])('preserves %s', (_name, source): void => {
    expect(reportsFor(source)).toHaveLength(0);
  });

  it.each([
    ['a call value', 'loadValue()'],
    ['an object value', '{ id: value }'],
    ['an asserted value', 'value as number'],
    ['a satisfies value', 'value satisfies number'],
  ])('reports while preserving %s inside Option.some', (_name, value): void => {
    const source =
      `import { Effect, Option } from "effect"; declare const value: number; ` +
      `declare const loadValue: () => number; const task = Effect.succeed(Option.some(${value}));`;

    expect(reportsFor(source)).toHaveLength(1);
  });

  it('reports parenthesized direct calls', (): void => {
    const source =
      'import { Effect, Option } from "effect"; const task = Effect.succeed((Option.some(value)));';

    expect(reportsFor(source)).toHaveLength(1);
  });

  it('reports every direct occurrence', (): void => {
    const source =
      'import { Effect, Option } from "effect"; const first = Effect.succeed(Option.some(1)); const second = Effect.succeed(Option.some(2));';

    expect(reportsFor(source)).toHaveLength(2);
  });

  it.each([
    [
      'an official Effect with a local Option lookalike',
      'import { Effect } from "effect"; const Option = LocalOption; const task = Effect.succeed(Option.some(value));',
    ],
    [
      'an official Option with a local Effect lookalike',
      'import { Option } from "effect"; const Effect = LocalEffect; const task = Effect.succeed(Option.some(value));',
    ],
    [
      'unrelated direct imports',
      'import { succeed, some } from "local-effect"; const task = succeed(some(value));',
    ],
    [
      'an unrelated succeed member',
      'import { Option } from "effect"; const task = LocalEffect.succeed(Option.some(value));',
    ],
    [
      'an unrelated some member',
      'import { Effect } from "effect"; const task = Effect.succeed(LocalOption.some(value));',
    ],
  ])('ignores %s', (_name, source): void => {
    expect(reportsFor(source)).toHaveLength(0);
  });
});
