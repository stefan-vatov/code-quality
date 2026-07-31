import { describe, expect, it } from 'vitest';
import type { SourceRule } from '../../src/rules/effect-rule-core';
import plugin from '../../src/rules/plugin';
import { runRule } from './effect-rule-test-utils';
import theThracianOxlint from '../../src/index';

const RULE_NAME = 'effect-prefer-mapBoth';
const EXPECTED_MESSAGE =
  'Effect.mapBoth expresses adjacent success and failure transformations more directly ' +
  'and in one Effect stage than separate Effect.map and Effect.mapError calls.\n' +
  'Fix: Replace the adjacent operators with Effect.mapBoth({ onFailure, onSuccess }), ' +
  'keeping callback expressions in their original evaluation order.\n' +
  'Example:\n```ts\nimport { Effect } from "effect"\n\n' +
  'const normalized = program.pipe(\n' +
  '  Effect.mapBoth({ onFailure: normalizeError, onSuccess: normalizeValue })\n)\n```';

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

describe('effect-prefer-mapBoth', (): void => {
  it('is registered as an error in the default Effect config', (): void => {
    expect(theThracianOxlint().rules).toHaveProperty(`thethracian/${RULE_NAME}`, 'error');
  });

  it.each(['const value = 1;', 'map', 'mapError'])(
    'keeps only the cheap Program visitor when the source %j cannot contain a pair',
    (source): void => {
      expect(visitorKeysFor(source)).toStrictEqual(['Program']);
    },
  );

  it.each(['map mapError', 'mapError map'])(
    'enables call analysis when both candidate tokens occur in %j',
    (source): void => {
      expect(visitorKeysFor(source)).toStrictEqual(['CallExpression', 'Program']);
    },
  );

  it.each([
    [
      'map then mapError in a pipe',
      'import { Effect } from "effect"; program.pipe(Effect.map(onSuccess), Effect.mapError(onFailure));',
    ],
    [
      'mapError then map in a pipe',
      'import { Effect } from "effect"; program.pipe(Effect.mapError(onFailure), Effect.map(onSuccess));',
    ],
    [
      'map nested inside data-first mapError',
      'import { Effect } from "effect"; Effect.mapError(Effect.map(program, onSuccess), onFailure);',
    ],
    [
      'mapError nested inside data-first map',
      'import { Effect } from "effect"; Effect.map(Effect.mapError(program, onFailure), onSuccess);',
    ],
    [
      'an adjacent pair surrounded by other pipe operators',
      'import { Effect } from "effect"; program.pipe(before, Effect.map(onSuccess), Effect.mapError(onFailure), after);',
    ],
  ])('reports the exact diagnostic for %s', (_name, source): void => {
    const reports = reportsFor(source);

    expect(reports).toHaveLength(1);
    expect(reports[0]?.message).toBe(EXPECTED_MESSAGE);
  });

  it('reports without offering an automatic fix', (): void => {
    const source =
      'import { Effect } from "effect"; program.pipe(Effect.map(onSuccess), Effect.mapError(onFailure));';
    const [report] = reportsFor(source);

    expect(Reflect.get(report ?? {}, 'fix')).toBeUndefined();
  });

  it.each([
    [
      'map then mapError',
      'import { Effect } from "effect"; program.pipe(Effect.map(onSuccess), Effect.mapError(onFailure));',
      'Effect.mapError',
    ],
    [
      'mapError then map',
      'import { Effect } from "effect"; Effect.map(Effect.mapError(program, onFailure), onSuccess);',
      'Effect.map',
    ],
  ])('reports the second transformation callee for %s', (_name, source, expected): void => {
    const [report] = reportsFor(source);
    const node = report?.node as { end?: number; start?: number; type?: string } | undefined;

    expect(node?.type).toBe('MemberExpression');
    expect(source.slice(node?.start, node?.end)).toBe(expected);
  });

  it.each([
    [
      'a root named alias',
      'import { Effect as Fx } from "effect"; program.pipe(Fx.map(onSuccess), Fx.mapError(onFailure));',
    ],
    [
      'an Effect subpath namespace',
      'import * as Fx from "effect/Effect"; program.pipe(Fx.mapError(onFailure), Fx.map(onSuccess));',
    ],
    [
      'aliased named subpath imports',
      'import { map as successMap, mapError as failureMap } from "effect/Effect"; program.pipe(successMap(onSuccess), failureMap(onFailure));',
    ],
    [
      'a root package namespace',
      'import * as EffectPackage from "effect"; program.pipe(EffectPackage.Effect.map(onSuccess), EffectPackage.Effect.mapError(onFailure));',
    ],
    [
      'aliased data-first named imports',
      'import { map as successMap, mapError as failureMap } from "effect/Effect"; failureMap(successMap(program, onSuccess), onFailure);',
    ],
  ])('recognizes %s', (_name, source): void => {
    expect(reportsFor(source)).toHaveLength(1);
  });

  it('reports two non-overlapping adjacent pairs', (): void => {
    const source =
      'import { Effect } from "effect"; ' +
      'program.pipe(Effect.map(firstSuccess), Effect.mapError(firstFailure), ' +
      'Effect.map(secondSuccess), Effect.mapError(secondFailure));';

    expect(reportsFor(source)).toHaveLength(2);
  });

  it.each([
    [
      'map, mapError, map',
      'import { Effect } from "effect"; program.pipe(Effect.map(first), Effect.mapError(failure), Effect.map(second));',
    ],
    [
      'mapError, map, mapError',
      'import { Effect } from "effect"; program.pipe(Effect.mapError(first), Effect.map(success), Effect.mapError(second));',
    ],
    [
      'nested map, mapError, map',
      'import { Effect } from "effect"; Effect.map(Effect.mapError(Effect.map(program, first), failure), second);',
    ],
  ])('reports one non-overlapping pair for %s', (_name, source): void => {
    expect(reportsFor(source)).toHaveLength(1);
  });

  it.each([
    ['no import', 'program.pipe(Effect.map(onSuccess), Effect.mapError(onFailure));'],
    [
      'an unrelated root import',
      'import { Effect } from "local-effect"; program.pipe(Effect.map(onSuccess), Effect.mapError(onFailure));',
    ],
    [
      'a type-only root import',
      'import type { Effect } from "effect"; program.pipe(Effect.map(onSuccess), Effect.mapError(onFailure));',
    ],
    [
      'a type-only root specifier',
      'import { type Effect } from "effect"; program.pipe(Effect.map(onSuccess), Effect.mapError(onFailure));',
    ],
    [
      'type-only named subpath imports',
      'import { type map, type mapError } from "effect/Effect"; program.pipe(map(onSuccess), mapError(onFailure));',
    ],
    [
      'a different root export aliased as Effect',
      'import { Chunk as Effect } from "effect"; program.pipe(Effect.map(onSuccess), Effect.mapError(onFailure));',
    ],
  ])('ignores %s', (_name, source): void => {
    expect(reportsFor(source)).toHaveLength(0);
  });

  it.each([
    [
      'a root Effect binding',
      'import { Effect } from "effect"; const make = (Effect: LocalEffect) => program.pipe(Effect.map(onSuccess), Effect.mapError(onFailure));',
    ],
    [
      'a direct map binding',
      'import { map, mapError } from "effect/Effect"; const make = (map: LocalMap) => program.pipe(map(onSuccess), mapError(onFailure));',
    ],
    [
      'a direct mapError binding',
      'import { map, mapError } from "effect/Effect"; const make = (mapError: LocalMap) => program.pipe(map(onSuccess), mapError(onFailure));',
    ],
    [
      'a root package namespace',
      'import * as EffectPackage from "effect"; ' +
        'const make = (EffectPackage: LocalEffect) => program.pipe(' +
        'EffectPackage.Effect.map(onSuccess), EffectPackage.Effect.mapError(onFailure));',
    ],
  ])('respects shadowing of %s', (_name, source): void => {
    expect(reportsFor(source)).toHaveLength(0);
  });

  it.each([
    [
      'a computed map access',
      'import { Effect } from "effect"; program.pipe(Effect["map"](onSuccess), Effect.mapError(onFailure));',
    ],
    [
      'a computed mapError access',
      'import { Effect } from "effect"; program.pipe(Effect.map(onSuccess), Effect["mapError"](onFailure));',
    ],
    [
      'an optional map access',
      'import { Effect } from "effect"; program.pipe(Effect?.map(onSuccess), Effect.mapError(onFailure));',
    ],
    [
      'an optional mapError call',
      'import { Effect } from "effect"; program.pipe(Effect.map(onSuccess), Effect.mapError?.(onFailure));',
    ],
    [
      'an optional pipe access',
      'import { Effect } from "effect"; program?.pipe(Effect.map(onSuccess), Effect.mapError(onFailure));',
    ],
    [
      'a computed pipe access',
      'import { Effect } from "effect"; program["pipe"](Effect.map(onSuccess), Effect.mapError(onFailure));',
    ],
  ])('preserves %s', (_name, source): void => {
    expect(reportsFor(source)).toHaveLength(0);
  });

  it.each([
    [
      'type arguments on pipeable map',
      'import { Effect } from "effect"; program.pipe(Effect.map<number, string>(onSuccess), Effect.mapError(onFailure));',
    ],
    [
      'type arguments on pipeable mapError',
      'import { Effect } from "effect"; program.pipe(Effect.map(onSuccess), Effect.mapError<string, Error>(onFailure));',
    ],
    [
      'a spread map callback',
      'import { Effect } from "effect"; program.pipe(Effect.map(...[onSuccess]), Effect.mapError(onFailure));',
    ],
    [
      'a spread mapError callback',
      'import { Effect } from "effect"; program.pipe(Effect.map(onSuccess), Effect.mapError(...[onFailure]));',
    ],
    [
      'a zero-argument map operator',
      'import { Effect } from "effect"; program.pipe(Effect.map(), Effect.mapError(onFailure));',
    ],
    [
      'a two-argument map operator',
      'import { Effect } from "effect"; program.pipe(Effect.map(other, onSuccess), Effect.mapError(onFailure));',
    ],
    [
      'a zero-argument mapError operator',
      'import { Effect } from "effect"; program.pipe(Effect.map(onSuccess), Effect.mapError());',
    ],
    [
      'a two-argument mapError operator',
      'import { Effect } from "effect"; program.pipe(Effect.map(onSuccess), Effect.mapError(other, onFailure));',
    ],
    [
      'type arguments on the pipe call',
      'import { Effect } from "effect"; program.pipe<Output>(Effect.map(onSuccess), Effect.mapError(onFailure));',
    ],
  ])('preserves %s', (_name, source): void => {
    expect(reportsFor(source)).toHaveLength(0);
  });

  it.each([
    [
      'type arguments on nested map',
      'import { Effect } from "effect"; Effect.mapError(Effect.map<number, string>(program, onSuccess), onFailure);',
    ],
    [
      'a spread nested map argument',
      'import { Effect } from "effect"; Effect.mapError(Effect.map(...[program, onSuccess]), onFailure);',
    ],
    [
      'an inner map with one argument',
      'import { Effect } from "effect"; Effect.mapError(Effect.map(onSuccess), onFailure);',
    ],
    [
      'an outer mapError with one argument',
      'import { Effect } from "effect"; Effect.mapError(Effect.map(program, onSuccess));',
    ],
    [
      'curried nested operators',
      'import { Effect } from "effect"; Effect.mapError(onFailure)(Effect.map(onSuccess)(program));',
    ],
  ])('leaves %s outside the conservative data-first matcher', (_name, source): void => {
    expect(reportsFor(source)).toHaveLength(0);
  });

  it.each([
    [
      'operators separated by another stage',
      'import { Effect } from "effect"; program.pipe(Effect.map(onSuccess), Effect.tap(logValue), Effect.mapError(onFailure));',
    ],
    [
      'two map operators',
      'import { Effect } from "effect"; program.pipe(Effect.map(first), Effect.map(second));',
    ],
    [
      'two mapError operators',
      'import { Effect } from "effect"; program.pipe(Effect.mapError(first), Effect.mapError(second));',
    ],
    [
      'independent transformations',
      'import { Effect } from "effect"; Effect.map(first, onSuccess); Effect.mapError(second, onFailure);',
    ],
    [
      'the canonical pipeable form',
      'import { Effect } from "effect"; program.pipe(Effect.mapBoth({ onFailure, onSuccess }));',
    ],
    [
      'the canonical data-first form',
      'import { Effect } from "effect"; Effect.mapBoth(program, { onFailure, onSuccess });',
    ],
  ])('accepts %s', (_name, source): void => {
    expect(reportsFor(source)).toHaveLength(0);
  });

  it('reports every independent occurrence', (): void => {
    const source =
      'import { Effect } from "effect"; ' +
      'one.pipe(Effect.map(onSuccess), Effect.mapError(onFailure)); ' +
      'Effect.map(Effect.mapError(two, otherFailure), otherSuccess);';

    expect(reportsFor(source)).toHaveLength(2);
  });
});
