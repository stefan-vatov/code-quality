import { describe, expect, it } from 'vitest';
import preferSucceedNoneRule from '../../src/rules/effect-prefer-succeed-none';
import { runRule } from './effect-rule-test-utils';
import theThracianOxlint from '../../src/index';

const RULE_NAME = 'effect-prefer-succeedNone';
const EXPECTED_MESSAGE =
  'Effect.succeedNone expresses a successful None more directly than Effect.succeed(Option.none()).\n' +
  'Fix: Use the succeedNone export from the same Effect import style instead of nesting succeed around Option.none().\n' +
  'Example:\n```ts\nimport { Effect } from "effect"\n\nconst task = Effect.succeedNone\n```';

const reportsFor = (source: string) => runRule(RULE_NAME, source);

const visitorKeysFor = (source: string): string[] =>
  Object.keys(
    preferSucceedNoneRule.create({
      report(): void {},
      sourceCode: { text: source },
    }),
  ).sort();

describe('effect-prefer-succeedNone', (): void => {
  it('is registered as an error in the default Effect config', (): void => {
    expect(theThracianOxlint().rules).toHaveProperty(`thethracian/${RULE_NAME}`, 'error');
  });

  it.each(['const value = 1;', 'succeed', 'none'])(
    'keeps only the cheap Program visitor when the source %j cannot contain a candidate',
    (source): void => {
      expect(visitorKeysFor(source)).toStrictEqual(['Program']);
    },
  );

  it('enables call analysis when both candidate tokens are present from offset zero', (): void => {
    expect(visitorKeysFor('succeed none')).toStrictEqual(['CallExpression', 'Program']);
  });

  it('reports the exact diagnostic for a direct nested call', (): void => {
    const source =
      'import { Effect, Option } from "effect"; const task = Effect.succeed(Option.none());';
    const reports = reportsFor(source);

    expect(reports).toHaveLength(1);
    expect(reports[0]?.message).toBe(EXPECTED_MESSAGE);
  });

  it('reports import-style-neutral guidance for Effect and Option namespace aliases', (): void => {
    const source =
      'import * as Fx from "effect/Effect"; import * as Maybe from "effect/Option"; const task = Fx.succeed(Maybe.none());';
    const reports = reportsFor(source);

    expect(reports).toHaveLength(1);
    expect(reports[0]?.message).toBe(EXPECTED_MESSAGE);
  });

  it('reports import-style-neutral guidance for direct named aliases', (): void => {
    const source =
      'import { succeed as success } from "effect/Effect"; import { none as noValue } from "effect/Option"; const task = success(noValue());';
    const reports = reportsFor(source);

    expect(reports).toHaveLength(1);
    expect(reports[0]?.message).toBe(EXPECTED_MESSAGE);
  });

  it('reports the outer succeed callee as the diagnostic location', (): void => {
    const source =
      'import { Effect, Option } from "effect"; const task = Effect.succeed(Option.none());';
    const [report] = reportsFor(source);
    const node = report?.node as { end?: number; start?: number; type?: string } | undefined;

    expect(node?.type).toBe('MemberExpression');
    expect(source.slice(node?.start, node?.end)).toBe('Effect.succeed');
  });

  it.each([
    [
      'root named imports',
      'import { Effect, Option } from "effect"; const task = Effect.succeed(Option.none());',
    ],
    [
      'root named aliases',
      'import { Effect as Fx, Option as Maybe } from "effect"; const task = Fx.succeed(Maybe.none());',
    ],
    [
      'subpath namespaces',
      'import * as Fx from "effect/Effect"; import * as Maybe from "effect/Option"; const task = Fx.succeed(Maybe.none());',
    ],
    [
      'subpath named aliases',
      'import { succeed as success } from "effect/Effect"; import { none as noValue } from "effect/Option"; const task = success(noValue());',
    ],
    [
      'root package namespace',
      'import * as EffectPackage from "effect"; const task = EffectPackage.Effect.succeed(EffectPackage.Option.none());',
    ],
    [
      'root Effect with a subpath Option namespace',
      'import { Effect } from "effect"; import * as Maybe from "effect/Option"; const task = Effect.succeed(Maybe.none());',
    ],
    [
      'direct succeed with a root Option import',
      'import { Option } from "effect"; import { succeed as success } from "effect/Effect"; const task = success(Option.none());',
    ],
    [
      'root Effect alias with a direct none import',
      'import { Effect as Fx } from "effect"; import { none as noValue } from "effect/Option"; const task = Fx.succeed(noValue());',
    ],
  ])('recognizes genuine %s', (_name, source): void => {
    expect(reportsFor(source)).toHaveLength(1);
  });

  it.each([
    ['no imports', 'const task = Effect.succeed(Option.none());'],
    [
      'unrelated root imports',
      'import { Effect, Option } from "local-effect"; const task = Effect.succeed(Option.none());',
    ],
    [
      'an unrelated Option import',
      'import { Effect } from "effect"; import { Option } from "local-effect"; const task = Effect.succeed(Option.none());',
    ],
    [
      'an unrelated Effect import',
      'import { Option } from "effect"; import { Effect } from "local-effect"; const task = Effect.succeed(Option.none());',
    ],
    [
      'root type-only imports',
      'import type { Effect, Option } from "effect"; const task = Effect.succeed(Option.none());',
    ],
    [
      'a type-only Effect specifier',
      'import { type Effect, Option } from "effect"; const task = Effect.succeed(Option.none());',
    ],
    [
      'a type-only Option specifier',
      'import { Effect, type Option } from "effect"; const task = Effect.succeed(Option.none());',
    ],
    [
      'a type-only Effect subpath namespace',
      'import type * as Fx from "effect/Effect"; import * as Maybe from "effect/Option"; const task = Fx.succeed(Maybe.none());',
    ],
    [
      'a type-only Option subpath namespace',
      'import * as Fx from "effect/Effect"; import type * as Maybe from "effect/Option"; const task = Fx.succeed(Maybe.none());',
    ],
  ])('ignores %s', (_name, source): void => {
    expect(reportsFor(source)).toHaveLength(0);
  });

  it.each([
    [
      'a root Effect binding',
      'import { Effect, Option } from "effect"; const make = (Effect: LocalEffect) => Effect.succeed(Option.none());',
    ],
    [
      'a root Option binding',
      'import { Effect, Option } from "effect"; const make = (Option: LocalOption) => Effect.succeed(Option.none());',
    ],
    [
      'a direct succeed binding',
      'import { succeed } from "effect/Effect"; import { none } from "effect/Option"; const make = (succeed: LocalSucceed) => succeed(none());',
    ],
    [
      'a direct none binding',
      'import { succeed } from "effect/Effect"; import { none } from "effect/Option"; const make = (none: LocalNone) => succeed(none());',
    ],
  ])('respects shadowing of %s', (_name, source): void => {
    expect(reportsFor(source)).toHaveLength(0);
  });

  it.each([
    [
      'a computed succeed access',
      'import { Effect, Option } from "effect"; const task = Effect["succeed"](Option.none());',
    ],
    [
      'a computed none access',
      'import { Effect, Option } from "effect"; const task = Effect.succeed(Option["none"]());',
    ],
    [
      'an optional Effect access',
      'import { Effect, Option } from "effect"; const task = Effect?.succeed(Option.none());',
    ],
    [
      'an optional Option access',
      'import { Effect, Option } from "effect"; const task = Effect.succeed(Option?.none());',
    ],
    [
      'an optional succeed call',
      'import { Effect, Option } from "effect"; const task = Effect.succeed?.(Option.none());',
    ],
    [
      'an optional none call',
      'import { Effect, Option } from "effect"; const task = Effect.succeed(Option.none?.());',
    ],
    [
      'a computed root-package Effect access',
      'import * as EffectPackage from "effect"; const task = EffectPackage["Effect"].succeed(EffectPackage.Option.none());',
    ],
    [
      'a computed root-package Option access',
      'import * as EffectPackage from "effect"; const task = EffectPackage.Effect.succeed(EffectPackage["Option"].none());',
    ],
  ])('preserves %s', (_name, source): void => {
    expect(reportsFor(source)).toHaveLength(0);
  });

  it.each([
    ['Effect.succeedNone', 'import { Effect } from "effect"; const task = Effect.succeedNone;'],
    [
      'a direct succeedNone import',
      'import { succeedNone } from "effect/Effect"; const task = succeedNone;',
    ],
    ['standalone Option.none', 'import { Option } from "effect"; const value = Option.none();'],
  ])('accepts %s', (_name, source): void => {
    expect(reportsFor(source)).toHaveLength(0);
  });

  it.each([
    ['Option.some', 'Option.some(1)'],
    ['Option.fromNullable', 'Option.fromNullable(value)'],
    ['an unrelated factory', 'LocalOption.none()'],
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
      'import { Effect, Option } from "effect"; const task = Effect.succeed(Option.none(), Option.none());',
    ],
    [
      'a spread succeed argument',
      'import { Effect, Option } from "effect"; const task = Effect.succeed(...[Option.none()]);',
    ],
    [
      'an argument passed to Option.none',
      'import { Effect, Option } from "effect"; const task = Effect.succeed(Option.none(undefined));',
    ],
    [
      'spread arguments passed to Option.none',
      'import { Effect, Option } from "effect"; const task = Effect.succeed(Option.none(...[]));',
    ],
  ])('ignores %s', (_name, source): void => {
    expect(reportsFor(source)).toHaveLength(0);
  });

  it.each([
    [
      'type arguments on Effect.succeed',
      'import { Effect, Option } from "effect"; const task = Effect.succeed<Option.Option<never>>(Option.none());',
    ],
    [
      'type arguments on Option.none',
      'import { Effect, Option } from "effect"; const task = Effect.succeed(Option.none<never>());',
    ],
  ])('preserves %s', (_name, source): void => {
    expect(reportsFor(source)).toHaveLength(0);
  });

  it.each([
    [
      'an as assertion around Option.none',
      'import { Effect, Option } from "effect"; const task = Effect.succeed(Option.none() as Option.Option<never>);',
    ],
    [
      'a satisfies wrapper around Option.none',
      'import { Effect, Option } from "effect"; const task = Effect.succeed(Option.none() satisfies Option.Option<never>);',
    ],
    [
      'a non-null wrapper around Option.none',
      'import { Effect, Option } from "effect"; const task = Effect.succeed(Option.none()!);',
    ],
    [
      'an angle-bracket assertion around Option.none',
      'import { Effect, Option } from "effect"; const task = Effect.succeed(<Option.Option<never>>Option.none());',
    ],
  ])('preserves %s', (_name, source): void => {
    expect(reportsFor(source)).toHaveLength(0);
  });

  it.each([
    [
      'an official Effect with a local Option lookalike',
      'import { Effect } from "effect"; const Option = LocalOption; const task = Effect.succeed(Option.none());',
    ],
    [
      'an official Option with a local Effect lookalike',
      'import { Option } from "effect"; const Effect = LocalEffect; const task = Effect.succeed(Option.none());',
    ],
    [
      'unrelated direct imports',
      'import { succeed, none } from "local-effect"; const task = succeed(none());',
    ],
    [
      'an unrelated succeed member',
      'import { Option } from "effect"; const task = LocalEffect.succeed(Option.none());',
    ],
    [
      'an unrelated none member',
      'import { Effect } from "effect"; const task = Effect.succeed(LocalOption.none());',
    ],
  ])('ignores %s', (_name, source): void => {
    expect(reportsFor(source)).toHaveLength(0);
  });
});
