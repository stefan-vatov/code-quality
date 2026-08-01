import { describe, expect, it } from 'vitest';
import type { SourceRule } from '../../src/rules/effect-rule-core';
import plugin from '../../src/rules/plugin';
import { runRule } from './effect-rule-test-utils';
import theThracianOxlint from '../../src/index';

const RULE_NAME = 'effect-prefer-andThen-over-flatMap-discarded-value';
const EXPECTED_MESSAGE =
  'Effect.andThen expresses sequencing an Effect when the previous success value is unused more directly than Effect.flatMap with a zero-parameter callback.\n' +
  'Fix: Replace Effect.flatMap with Effect.andThen and keep the zero-parameter callback unchanged.\n' +
  'Example:\n```ts\nimport { Effect } from "effect"\n\n' +
  'const result = first.pipe(Effect.andThen(() => second))\n```';

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

describe('effect-prefer-andThen-over-flatMap-discarded-value', (): void => {
  it('is registered as a problem and enabled in the default Effect config', (): void => {
    const rule = registeredRule();

    expect(rule.meta?.type).toBe('problem');
    expect(theThracianOxlint().rules).toHaveProperty(`thethracian/${RULE_NAME}`, 'error');
  });

  it.each(['const value = 1;', 'flatMap', '=>', 'function', 'flatMap function'])(
    'keeps only the cheap Program visitor for source %j',
    (source): void => {
      expect(visitorKeysFor(source)).toStrictEqual(['Program']);
    },
  );

  it.each(['flatMap =>'])(
    'enables call analysis for candidate source %j from offset zero',
    (source): void => {
      expect(visitorKeysFor(source)).toStrictEqual(['CallExpression', 'Program']);
    },
  );

  it.each([
    [
      'a data-first expression arrow',
      'import { Effect } from "effect"; Effect.flatMap(first, () => second);',
    ],
    [
      'a pipeable expression arrow',
      'import { Effect } from "effect"; first.pipe(Effect.flatMap(() => second));',
    ],
    [
      'a standalone pipeable operator',
      'import { Effect } from "effect"; const continueWithSecond = Effect.flatMap(() => second);',
    ],
    [
      'a sole-return arrow block',
      'import { Effect } from "effect"; Effect.flatMap(first, () => { return second; });',
    ],
    [
      'a return-annotated arrow',
      'import { Effect } from "effect"; Effect.flatMap(first, (): Effect.Effect<string> => second);',
    ],
    [
      'an arrow with multiple statements',
      'import { Effect } from "effect"; Effect.flatMap(first, () => { audit(); const next = second; return next; });',
    ],
    [
      'an arrow with control flow',
      'import { Effect } from "effect"; Effect.flatMap(first, () => { if (condition) { return second; } return third; });',
    ],
  ])('reports the exact diagnostic for %s', (_name, source): void => {
    const reports = reportsFor(source);

    expect(reports).toHaveLength(1);
    expect(reports[0]?.message).toBe(EXPECTED_MESSAGE);
  });

  it.each([
    [
      'a root Effect alias',
      'import { Effect as Fx } from "effect"; Fx.flatMap(first, () => second);',
    ],
    [
      'an Effect subpath namespace',
      'import * as Fx from "effect/Effect"; first.pipe(Fx.flatMap(() => second));',
    ],
    [
      'an aliased named subpath import',
      'import { flatMap as chain } from "effect/Effect"; chain(first, () => second);',
    ],
    [
      'a pipeable named subpath import',
      'import { flatMap as chain } from "effect/Effect"; first.pipe(chain(() => second));',
    ],
    [
      'a root package namespace',
      'import * as EffectPackage from "effect"; EffectPackage.Effect.flatMap(first, () => second);',
    ],
  ])('recognizes %s', (_name, source): void => {
    expect(reportsFor(source)).toHaveLength(1);
  });

  it('reports every nested independent occurrence', (): void => {
    const source =
      'import { Effect } from "effect"; ' +
      'Effect.flatMap(first, () => Effect.flatMap(second, () => third));';

    expect(reportsFor(source)).toHaveLength(2);
  });

  it('publishes the exact diagnostic without an automatic fix', (): void => {
    const source = 'import { Effect } from "effect"; Effect.flatMap(first, () => second);';
    const [report] = reportsFor(source);

    expect(report?.message).toBe(EXPECTED_MESSAGE);
    expect(Reflect.get(report ?? {}, 'fix')).toBeUndefined();
  });

  it('reports the outer flatMap callee as the diagnostic location', (): void => {
    const source = 'import { Effect } from "effect"; Effect.flatMap(first, () => second);';
    const [report] = reportsFor(source);
    const node = report?.node as { end?: number; start?: number; type?: string } | undefined;

    expect(node?.type).toBe('MemberExpression');
    expect(source.slice(node?.start, node?.end)).toBe('Effect.flatMap');
  });

  it.each([
    [
      'a value parameter',
      'import { Effect } from "effect"; Effect.flatMap(first, value => second);',
    ],
    [
      'an underscore parameter',
      'import { Effect } from "effect"; Effect.flatMap(first, _ => second);',
    ],
    [
      'a default parameter',
      'import { Effect } from "effect"; Effect.flatMap(first, (value = fallback) => second);',
    ],
    [
      'a rest parameter',
      'import { Effect } from "effect"; Effect.flatMap(first, (...values) => second);',
    ],
    [
      'an object-destructured parameter',
      'import { Effect } from "effect"; Effect.flatMap(first, ({ value }) => second);',
    ],
    [
      'an array-destructured parameter',
      'import { Effect } from "effect"; Effect.flatMap(first, ([value]) => second);',
    ],
    [
      'a function-expression parameter',
      'import { Effect } from "effect"; Effect.flatMap(first, function (value) { return second; });',
    ],
  ])('preserves flatMap for %s', (_name, source): void => {
    expect(reportsFor(source)).toHaveLength(0);
  });

  it.each([
    [
      'a plain zero-parameter function expression',
      'import { Effect } from "effect"; Effect.flatMap(first, function () { return second; });',
    ],
    [
      'a function expression reading arguments',
      'import { Effect } from "effect"; Effect.flatMap(first, function () { return continueWith(arguments[0]); });',
    ],
    [
      'a function expression reading this',
      'import { Effect } from "effect"; Effect.flatMap(first, function () { return this.continueWithSecond(); });',
    ],
    [
      'a named function expression with multiple statements',
      'import { Effect } from "effect"; Effect.flatMap(first, function continueWithoutValue() { audit(); const next = second; return next; });',
    ],
  ])('preserves dynamic callback semantics for %s', (_name, source): void => {
    expect(reportsFor(source)).toHaveLength(0);
  });

  it.each([
    [
      'an async arrow callback',
      'import { Effect } from "effect"; Effect.flatMap(first, async () => second);',
    ],
    [
      'an async function callback',
      'import { Effect } from "effect"; Effect.flatMap(first, async function () { return second; });',
    ],
    [
      'a generator callback',
      'import { Effect } from "effect"; Effect.flatMap(first, function* () { return second; });',
    ],
    [
      'a generic arrow callback',
      'import { Effect } from "effect"; Effect.flatMap(first, <Value>() => second);',
    ],
    [
      'a generic function callback',
      'import { Effect } from "effect"; Effect.flatMap(first, function <Value>() { return second; });',
    ],
  ])('preserves %s', (_name, source): void => {
    expect(reportsFor(source)).toHaveLength(0);
  });

  it.each([
    ['flatMap with no arguments', 'import { Effect } from "effect"; Effect.flatMap();'],
    [
      'flatMap with only a non-callback argument',
      'import { Effect } from "effect"; Effect.flatMap(first);',
    ],
    [
      'flatMap with three arguments ending in a valid callback',
      'import { Effect } from "effect"; Effect.flatMap(first, options, () => second);',
    ],
    [
      'flatMap with three arguments and a middle callback',
      'import { Effect } from "effect"; Effect.flatMap(first, () => second, options);',
    ],
    [
      'a spread-only call',
      'import { Effect } from "effect"; Effect.flatMap(...[first, () => second]);',
    ],
    [
      'mixed leading spread arguments with a final callback',
      'import { Effect } from "effect"; Effect.flatMap(...effects, () => second);',
    ],
    [
      'a spread data argument',
      'import { Effect } from "effect"; Effect.flatMap(...[first], () => second);',
    ],
    [
      'a spread callback',
      'import { Effect } from "effect"; Effect.flatMap(first, ...[() => second]);',
    ],
  ])('leaves %s outside the exact-arity matcher', (_name, source): void => {
    expect(reportsFor(source)).toHaveLength(0);
  });

  it.each([
    [
      'type arguments on data-first flatMap',
      'import { Effect } from "effect"; Effect.flatMap<string, never, never, string>(first, () => second);',
    ],
    [
      'type arguments on pipeable flatMap',
      'import { Effect } from "effect"; first.pipe(Effect.flatMap<string, never, never, string>(() => second));',
    ],
    [
      'a computed string flatMap access',
      'import { Effect } from "effect"; Effect["flatMap"](first, () => second);',
    ],
    [
      'a computed identifier flatMap access',
      'import { Effect } from "effect"; Effect[flatMap](first, () => second);',
    ],
    [
      'an optional flatMap access',
      'import { Effect } from "effect"; Effect?.flatMap(first, () => second);',
    ],
    [
      'an optional flatMap call',
      'import { Effect } from "effect"; Effect.flatMap?.(first, () => second);',
    ],
    [
      'an optional root-package namespace',
      'import * as EffectPackage from "effect"; EffectPackage?.Effect.flatMap(first, () => second);',
    ],
  ])('leaves %s outside the conservative syntax matcher', (_name, source): void => {
    expect(reportsFor(source)).toHaveLength(0);
  });

  it.each([
    ['no import', 'Effect.flatMap(first, () => second);'],
    [
      'an unrelated root import',
      'import { Effect } from "local-effect"; Effect.flatMap(first, () => second);',
    ],
    [
      'a type-only root import',
      'import type { Effect } from "effect"; Effect.flatMap(first, () => second);',
    ],
    [
      'a type-only root specifier',
      'import { type Effect } from "effect"; Effect.flatMap(first, () => second);',
    ],
    [
      'a type-only subpath namespace',
      'import type * as Fx from "effect/Effect"; Fx.flatMap(first, () => second);',
    ],
    [
      'a type-only named subpath import',
      'import { type flatMap } from "effect/Effect"; flatMap(first, () => second);',
    ],
    [
      'a different root export aliased as Effect',
      'import { Chunk as Effect } from "effect"; Effect.flatMap(first, () => second);',
    ],
  ])('ignores %s', (_name, source): void => {
    expect(reportsFor(source)).toHaveLength(0);
  });

  it.each([
    [
      'the root Effect binding',
      'import { Effect } from "effect"; const run = (Effect: LocalEffect) => Effect.flatMap(first, () => second);',
    ],
    [
      'the named flatMap binding',
      'import { flatMap } from "effect/Effect"; const run = (flatMap: LocalFlatMap) => flatMap(first, () => second);',
    ],
    [
      'a root package namespace binding',
      'import * as EffectPackage from "effect"; const run = (EffectPackage: LocalEffect) => EffectPackage.Effect.flatMap(first, () => second);',
    ],
    [
      'a function-hoisted named binding',
      'import { flatMap } from "effect/Effect"; function run() { var flatMap = LocalEffect.flatMap; return flatMap(first, () => second); }',
    ],
    [
      'a catch binding',
      'import { Effect } from "effect"; try { throw LocalEffect; } catch (Effect) { Effect.flatMap(first, () => second); }',
    ],
  ])('respects lexical shadowing of %s', (_name, source): void => {
    expect(reportsFor(source)).toHaveLength(0);
  });

  it.each([
    [
      'a callback identifier',
      'import { Effect } from "effect"; Effect.flatMap(first, continueWithSecond);',
    ],
    [
      'a callback identifier when an unrelated arrow activates the token gate',
      'import { Effect } from "effect"; const unrelated = () => 1; Effect.flatMap(first, continueWithSecond);',
    ],
    [
      'a callback member expression',
      'import { Effect } from "effect"; Effect.flatMap(first, service.continueWithSecond);',
    ],
    [
      'an unrelated flatMap call',
      'import { Effect } from "effect"; LocalEffect.flatMap(first, () => second);',
    ],
    [
      'a flatMap property read',
      'import { Effect } from "effect"; const operation = Effect.flatMap; const callback = () => second;',
    ],
    [
      'a NewExpression lookalike',
      'import { Effect } from "effect"; new Effect.flatMap(first, () => second);',
    ],
    [
      'canonical data-first andThen',
      'import { Effect } from "effect"; Effect.andThen(first, () => second);',
    ],
    [
      'canonical pipeable andThen',
      'import { Effect } from "effect"; first.pipe(Effect.andThen(() => second));',
    ],
    [
      'a different Effect call',
      'import { Effect } from "effect"; Effect.map(first, () => second);',
    ],
  ])('accepts %s', (_name, source): void => {
    expect(reportsFor(source)).toHaveLength(0);
  });
});
