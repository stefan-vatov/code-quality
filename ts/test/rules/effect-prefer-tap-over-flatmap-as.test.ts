import { describe, expect, it } from 'vitest';
import type { SourceRule } from '../../src/rules/effect-rule-core';
import plugin from '../../src/rules/plugin';
import { runRule } from './effect-rule-test-utils';
import theThracianOxlint from '../../src/index';

const RULE_NAME = 'effect-prefer-tap-over-flatMap-as';
const EXPECTED_MESSAGE =
  'Effect.tap expresses running an Effect while preserving the original success value more directly than Effect.flatMap followed by Effect.as.\n' +
  'Fix: Replace Effect.flatMap with Effect.tap and return the side Effect without replacing its success value.\n' +
  'Example:\n```ts\nimport { Effect } from "effect"\n\n' +
  'const result = program.pipe(Effect.tap((value) => audit(value)))\n```';

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

describe('effect-prefer-tap-over-flatMap-as', (): void => {
  it('is registered as an error in the default Effect config', (): void => {
    expect(theThracianOxlint().rules).toHaveProperty(`thethracian/${RULE_NAME}`, 'error');
  });

  it.each(['const value = 1;', 'flatMap', 'as'])(
    'keeps only the cheap Program visitor when source %j lacks a candidate token',
    (source): void => {
      expect(visitorKeysFor(source)).toStrictEqual(['Program']);
    },
  );

  it('enables call analysis when both candidate tokens occur from offset zero', (): void => {
    expect(visitorKeysFor('flatMap as')).toStrictEqual(['CallExpression', 'Program']);
  });

  it.each([
    [
      'data-first flatMap and data-first as',
      'import { Effect } from "effect"; Effect.flatMap(program, value => Effect.as(audit(value), value));',
    ],
    [
      'pipeable flatMap and data-first as',
      'import { Effect } from "effect"; program.pipe(Effect.flatMap(value => Effect.as(audit(value), value)));',
    ],
    [
      'data-first flatMap and pipeable as',
      'import { Effect } from "effect"; Effect.flatMap(program, value => audit(value).pipe(Effect.as(value)));',
    ],
    [
      'pipeable flatMap and pipeable as',
      'import { Effect } from "effect"; program.pipe(Effect.flatMap(value => audit(value).pipe(Effect.as(value))));',
    ],
    [
      'the v4 Distilled shape with ignore before final as',
      'import { Effect } from "effect"; Effect.flatMap(program, value => revoke(value).pipe(Effect.ignore, Effect.as(value)));',
    ],
  ])('reports %s', (_name, source): void => {
    const reports = reportsFor(source);

    expect(reports).toHaveLength(1);
    expect(reports[0]?.message).toBe(EXPECTED_MESSAGE);
  });

  it.each([
    [
      'an expression arrow',
      'import { Effect } from "effect"; Effect.flatMap(program, value => Effect.as(audit(value), value));',
    ],
    [
      'a typed single-return block arrow',
      'import { Effect } from "effect"; Effect.flatMap(program, (value: Value): Effect.Effect<Value> => { return Effect.as(audit(value), value); });',
    ],
    [
      'a single-return function expression',
      'import { Effect } from "effect"; Effect.flatMap(program, function (value) { return Effect.as(audit(value), value); });',
    ],
  ])('recognizes %s', (_name, source): void => {
    expect(reportsFor(source)).toHaveLength(1);
  });

  it.each([
    [
      'a root named alias',
      'import { Effect as Fx } from "effect"; Fx.flatMap(program, value => Fx.as(audit(value), value));',
    ],
    [
      'an Effect subpath namespace',
      'import * as Fx from "effect/Effect"; Fx.flatMap(program, value => audit(value).pipe(Fx.as(value)));',
    ],
    [
      'aliased named subpath imports',
      'import { flatMap as chain, as as preserve } from "effect/Effect"; chain(program, value => preserve(audit(value), value));',
    ],
    [
      'a root package namespace',
      'import * as EffectPackage from "effect"; EffectPackage.Effect.flatMap(program, value => EffectPackage.Effect.as(audit(value), value));',
    ],
    [
      'mixed named aliases in pipeable positions',
      'import { flatMap as chain, as as preserve } from "effect/Effect"; program.pipe(chain(value => audit(value).pipe(preserve(value))));',
    ],
  ])('recognizes %s', (_name, source): void => {
    expect(reportsFor(source)).toHaveLength(1);
  });

  it('reports every nested independent occurrence', (): void => {
    const source =
      'import { Effect } from "effect"; ' +
      'Effect.flatMap(first, firstValue => Effect.as(' +
      'Effect.flatMap(second, secondValue => Effect.as(audit(secondValue), secondValue)), firstValue));';

    expect(reportsFor(source)).toHaveLength(2);
  });

  it('publishes the exact diagnostic without an automatic fix', (): void => {
    const source =
      'import { Effect } from "effect"; Effect.flatMap(program, value => Effect.as(audit(value), value));';
    const [report] = reportsFor(source);

    expect(report?.message).toBe(EXPECTED_MESSAGE);
    expect(Reflect.get(report ?? {}, 'fix')).toBeUndefined();
  });

  it('reports the outer flatMap callee as the diagnostic location', (): void => {
    const source =
      'import { Effect } from "effect"; Effect.flatMap(program, value => Effect.as(audit(value), value));';
    const [report] = reportsFor(source);
    const node = report?.node as { end?: number; start?: number; type?: string } | undefined;

    expect(node?.type).toBe('MemberExpression');
    expect(source.slice(node?.start, node?.end)).toBe('Effect.flatMap');
  });

  it.each([
    [
      'a different preserved identifier',
      'import { Effect } from "effect"; Effect.flatMap(program, value => Effect.as(audit(value), other));',
    ],
    [
      'a property derived from the callback value',
      'import { Effect } from "effect"; Effect.flatMap(program, value => Effect.as(audit(value), value.id));',
    ],
    [
      'a transformation of the callback value',
      'import { Effect } from "effect"; Effect.flatMap(program, value => Effect.as(audit(value), normalize(value)));',
    ],
    [
      'a different identifier in pipeable as',
      'import { Effect } from "effect"; Effect.flatMap(program, value => audit(value).pipe(Effect.as(other)));',
    ],
  ])('preserves flatMap when as returns %s', (_name, source): void => {
    expect(reportsFor(source)).toHaveLength(0);
  });

  it.each([
    [
      'an async arrow callback',
      'import { Effect } from "effect"; Effect.flatMap(program, async value => Effect.as(audit(value), value));',
    ],
    [
      'an async function callback',
      'import { Effect } from "effect"; Effect.flatMap(program, async function (value) { return Effect.as(audit(value), value); });',
    ],
    [
      'a generator callback',
      'import { Effect } from "effect"; Effect.flatMap(program, function* (value) { return Effect.as(audit(value), value); });',
    ],
    [
      'a generic arrow callback',
      'import { Effect } from "effect"; Effect.flatMap(program, <Value>(value: Value) => Effect.as(audit(value), value));',
    ],
    [
      'a generic function callback',
      'import { Effect } from "effect"; Effect.flatMap(program, function <Value>(value: Value) { return Effect.as(audit(value), value); });',
    ],
  ])('preserves %s', (_name, source): void => {
    expect(reportsFor(source)).toHaveLength(0);
  });

  it.each([
    [
      'a zero-parameter callback',
      'import { Effect } from "effect"; Effect.flatMap(program, () => Effect.as(audit(), value));',
    ],
    [
      'a two-parameter callback',
      'import { Effect } from "effect"; Effect.flatMap(program, (value, index) => Effect.as(audit(index), value));',
    ],
    [
      'a default parameter',
      'import { Effect } from "effect"; Effect.flatMap(program, (value = fallback) => Effect.as(audit(value), value));',
    ],
    [
      'a rest parameter',
      'import { Effect } from "effect"; Effect.flatMap(program, (...value) => Effect.as(audit(value), value));',
    ],
    [
      'an object-destructured parameter',
      'import { Effect } from "effect"; Effect.flatMap(program, ({ value }) => Effect.as(audit(value), value));',
    ],
    [
      'an array-destructured parameter',
      'import { Effect } from "effect"; Effect.flatMap(program, ([value]) => Effect.as(audit(value), value));',
    ],
  ])('preserves %s', (_name, source): void => {
    expect(reportsFor(source)).toHaveLength(0);
  });

  it.each([
    [
      'a declaration before the return',
      'import { Effect } from "effect"; Effect.flatMap(program, value => { const side = audit(value); return Effect.as(side, value); });',
    ],
    [
      'a statement after the return',
      'import { Effect } from "effect"; Effect.flatMap(program, value => { return Effect.as(audit(value), value); cleanup(); });',
    ],
    [
      'an if statement',
      'import { Effect } from "effect"; Effect.flatMap(program, value => { if (value) return Effect.as(audit(value), value); return Effect.as(other, value); });',
    ],
    [
      'a conditional expression',
      'import { Effect } from "effect"; Effect.flatMap(program, value => condition ? Effect.as(audit(value), value) : Effect.as(other, value));',
    ],
    [
      'a thrown as expression',
      'import { Effect } from "effect"; Effect.flatMap(program, value => { throw Effect.as(audit(value), value); });',
    ],
  ])('preserves callback control flow for %s', (_name, source): void => {
    expect(reportsFor(source)).toHaveLength(0);
  });

  it.each([
    ['flatMap with no arguments', 'import { Effect } from "effect"; Effect.flatMap();'],
    ['flatMap with only its Effect', 'import { Effect } from "effect"; Effect.flatMap(program);'],
    [
      'flatMap with three arguments',
      'import { Effect } from "effect"; Effect.flatMap(program, value => Effect.as(audit(value), value), options);',
    ],
    [
      'flatMap with three arguments and a final callback',
      'import { Effect } from "effect"; Effect.flatMap(program, options, value => Effect.as(audit(value), value));',
    ],
    [
      'as with one argument in data-first position',
      'import { Effect } from "effect"; Effect.flatMap(program, value => Effect.as(value));',
    ],
    [
      'as with three arguments',
      'import { Effect } from "effect"; Effect.flatMap(program, value => Effect.as(audit(value), value, options));',
    ],
    [
      'a spread flatMap argument',
      'import { Effect } from "effect"; Effect.flatMap(...[program, value => Effect.as(audit(value), value)]);',
    ],
    [
      'leading spread flatMap arguments before a final callback',
      'import { Effect } from "effect"; Effect.flatMap(...effects, value => Effect.as(audit(value), value));',
    ],
    [
      'a spread as argument',
      'import { Effect } from "effect"; Effect.flatMap(program, value => Effect.as(...[audit(value), value]));',
    ],
    [
      'leading spread as arguments before the original value',
      'import { Effect } from "effect"; Effect.flatMap(program, value => Effect.as(...effects, value));',
    ],
  ])('preserves %s', (_name, source): void => {
    expect(reportsFor(source)).toHaveLength(0);
  });

  it.each([
    [
      'type arguments on flatMap',
      'import { Effect } from "effect"; Effect.flatMap<Value, Error, Env, Next>(program, value => Effect.as(audit(value), value));',
    ],
    [
      'type arguments on as',
      'import { Effect } from "effect"; Effect.flatMap(program, value => Effect.as<void, Value>(audit(value), value));',
    ],
    [
      'a computed flatMap access',
      'import { Effect } from "effect"; Effect["flatMap"](program, value => Effect.as(audit(value), value));',
    ],
    [
      'a computed as access',
      'import { Effect } from "effect"; Effect.flatMap(program, value => Effect["as"](audit(value), value));',
    ],
    [
      'an optional flatMap access',
      'import { Effect } from "effect"; Effect?.flatMap(program, value => Effect.as(audit(value), value));',
    ],
    [
      'an optional flatMap call',
      'import { Effect } from "effect"; Effect.flatMap?.(program, value => Effect.as(audit(value), value));',
    ],
    [
      'an optional as call',
      'import { Effect } from "effect"; Effect.flatMap(program, value => Effect.as?.(audit(value), value));',
    ],
    [
      'an optional pipe access',
      'import { Effect } from "effect"; Effect.flatMap(program, value => audit(value)?.pipe(Effect.as(value)));',
    ],
    [
      'a computed pipe access',
      'import { Effect } from "effect"; Effect.flatMap(program, value => audit(value)["pipe"](Effect.as(value)));',
    ],
    [
      'a computed identifier pipe access',
      'import { Effect } from "effect"; Effect.flatMap(program, value => audit(value)[pipe](Effect.as(value)));',
    ],
  ])('leaves %s outside the conservative matcher', (_name, source): void => {
    expect(reportsFor(source)).toHaveLength(0);
  });

  it.each([
    [
      'as followed by another pipe operator',
      'import { Effect } from "effect"; Effect.flatMap(program, value => audit(value).pipe(Effect.as(value), Effect.map(normalize)));',
    ],
    [
      'spread pipe operators before final as',
      'import { Effect } from "effect"; Effect.flatMap(program, value => audit(value).pipe(...operators, Effect.as(value)));',
    ],
    [
      'curried data-first as',
      'import { Effect } from "effect"; Effect.flatMap(program, value => Effect.as(value)(audit(value)));',
    ],
    [
      'a canonical data-first tap',
      'import { Effect } from "effect"; Effect.tap(program, value => audit(value));',
    ],
    [
      'a canonical pipeable tap',
      'import { Effect } from "effect"; program.pipe(Effect.tap(value => audit(value)));',
    ],
    [
      'v3 tap with a plain callback result',
      'import { Effect } from "effect"; Effect.tap(program, value => observe(value));',
    ],
    [
      'v3 tap with a Promise callback result',
      'import { Effect } from "effect"; Effect.tap(program, value => Promise.resolve(observe(value)));',
    ],
  ])('accepts %s', (_name, source): void => {
    expect(reportsFor(source)).toHaveLength(0);
  });

  it.each([
    ['no import', 'Effect.flatMap(program, value => Effect.as(audit(value), value));'],
    [
      'an unrelated root import',
      'import { Effect } from "local-effect"; Effect.flatMap(program, value => Effect.as(audit(value), value));',
    ],
    [
      'a type-only root import',
      'import type { Effect } from "effect"; Effect.flatMap(program, value => Effect.as(audit(value), value));',
    ],
    [
      'a type-only root specifier',
      'import { type Effect } from "effect"; Effect.flatMap(program, value => Effect.as(audit(value), value));',
    ],
    [
      'type-only named subpath imports',
      'import { type flatMap, type as } from "effect/Effect"; flatMap(program, value => as(audit(value), value));',
    ],
    [
      'a different root export aliased as Effect',
      'import { Chunk as Effect } from "effect"; Effect.flatMap(program, value => Effect.as(audit(value), value));',
    ],
  ])('ignores %s', (_name, source): void => {
    expect(reportsFor(source)).toHaveLength(0);
  });

  it.each([
    [
      'the root Effect binding',
      'import { Effect } from "effect"; const run = (Effect: LocalEffect) => Effect.flatMap(program, value => Effect.as(audit(value), value));',
    ],
    [
      'the named flatMap binding',
      'import { flatMap, as } from "effect/Effect"; const run = (flatMap: LocalFlatMap) => flatMap(program, value => as(audit(value), value));',
    ],
    [
      'the named as binding',
      'import { flatMap, as } from "effect/Effect"; const run = (as: LocalAs) => flatMap(program, value => as(audit(value), value));',
    ],
    [
      'the root package namespace',
      'import * as EffectPackage from "effect"; const run = (EffectPackage: LocalEffect) => EffectPackage.Effect.flatMap(program, value => EffectPackage.Effect.as(audit(value), value));',
    ],
    [
      'a hoisted local as binding in the callback',
      'import { flatMap, as } from "effect/Effect"; flatMap(program, value => { var as = LocalEffect.as; return as(audit(value), value); });',
    ],
  ])('respects shadowing of %s', (_name, source): void => {
    expect(reportsFor(source)).toHaveLength(0);
  });

  it.each([
    [
      'an unrelated flatMap with official as',
      'import { Effect } from "effect"; LocalEffect.flatMap(program, value => Effect.as(audit(value), value));',
    ],
    [
      'official flatMap with unrelated as',
      'import { Effect } from "effect"; Effect.flatMap(program, value => LocalEffect.as(audit(value), value));',
    ],
    [
      'a flatMap property read',
      'import { Effect } from "effect"; const operation = Effect.flatMap;',
    ],
    [
      'a NewExpression lookalike',
      'import { Effect } from "effect"; new Effect.flatMap(program, value => Effect.as(audit(value), value));',
    ],
    [
      'a different Effect operation',
      'import { Effect } from "effect"; Effect.map(program, value => Effect.as(audit(value), value));',
    ],
    [
      'a callback that only evaluates as',
      'import { Effect } from "effect"; Effect.flatMap(program, value => { Effect.as(audit(value), value); });',
    ],
  ])('ignores %s', (_name, source): void => {
    expect(reportsFor(source)).toHaveLength(0);
  });
});
