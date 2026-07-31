import { describe, expect, it } from 'vitest';
import type { SourceRule } from '../../src/rules/effect-rule-core';
import plugin from '../../src/rules/plugin';
import { runRule } from './effect-rule-test-utils';
import theThracianOxlint from '../../src/index';

const RULE_NAME = 'effect-prefer-as-over-map-constant';
const EXPECTED_MESSAGE =
  'Effect.as expresses replacing an Effect success value with a stable constant more directly than Effect.map with a constant callback.\n' +
  'Fix: Use the as export from the same Effect import style and pass the constant directly.\n' +
  'Example:\n```ts\nimport { Effect } from "effect"\n\nconst completed = program.pipe(Effect.as("done"))\n```';

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

const stableConstants = [
  ['a string', '"done"'],
  ['a number', '42'],
  ['zero', '0'],
  ['true', 'true'],
  ['false', 'false'],
  ['a bigint', '42n'],
  ['null', 'null'],
  ['a static template', '`done`'],
  ['a negative number', '-1'],
  ['a positive number', '+1'],
  ['a parenthesized literal', '(("done"))'],
  ['a const-asserted string', '"done" as const'],
  ['a const-asserted boolean', 'true as const'],
] as const;

describe('effect-prefer-as-over-map-constant', (): void => {
  it('is registered as an error in the default Effect config', (): void => {
    expect(theThracianOxlint().rules).toHaveProperty(`thethracian/${RULE_NAME}`, 'error');
  });

  it.each(['const value = 1;', 'map', '=>'])(
    'keeps only the cheap Program visitor when the source %j cannot contain a candidate',
    (source): void => {
      expect(visitorKeysFor(source)).toStrictEqual(['Program']);
    },
  );

  it('enables call analysis when both candidate tokens are present from offset zero', (): void => {
    expect(visitorKeysFor('map =>')).toStrictEqual(['CallExpression', 'Program']);
  });

  it.each(stableConstants)('reports data-first mapping to %s', (_name, expression): void => {
    const source =
      `import { Effect } from "effect"; ` +
      `const completed = Effect.map(program, () => ${expression});`;
    const reports = reportsFor(source);

    expect(reports).toHaveLength(1);
    expect(reports[0]?.message).toBe(EXPECTED_MESSAGE);
  });

  it.each(stableConstants)('reports pipeable mapping to %s', (_name, expression): void => {
    const source =
      `import { Effect } from "effect"; ` +
      `const completed = program.pipe(Effect.map(() => ${expression}));`;

    expect(reportsFor(source)).toHaveLength(1);
  });

  it('reports a standalone curried map operator', (): void => {
    const source = 'import { Effect } from "effect"; const replace = Effect.map(() => "done");';

    expect(reportsFor(source)).toHaveLength(1);
  });

  it.each([
    ['a root named alias', 'import { Effect as Fx } from "effect"; Fx.map(program, () => "done");'],
    [
      'an Effect subpath namespace',
      'import * as Fx from "effect/Effect"; Fx.map(program, () => "done");',
    ],
    [
      'an aliased named subpath import',
      'import { map as transform } from "effect/Effect"; transform(program, () => "done");',
    ],
    [
      'a root package namespace',
      'import * as EffectPackage from "effect"; EffectPackage.Effect.map(program, () => "done");',
    ],
    [
      'a pipeable named subpath import',
      'import { map as transform } from "effect/Effect"; program.pipe(transform(() => "done"));',
    ],
  ])('recognizes %s', (_name, source): void => {
    expect(reportsFor(source)).toHaveLength(1);
  });

  it('reports without offering an automatic fix', (): void => {
    const source = 'import { Effect } from "effect"; Effect.map(program, () => "done");';
    const [report] = reportsFor(source);

    expect(Reflect.get(report ?? {}, 'fix')).toBeUndefined();
  });

  it('reports the map callee as the diagnostic location', (): void => {
    const source = 'import { Effect } from "effect"; Effect.map(program, () => "done");';
    const [report] = reportsFor(source);
    const node = report?.node as { end?: number; start?: number; type?: string } | undefined;

    expect(node?.type).toBe('MemberExpression');
    expect(source.slice(node?.start, node?.end)).toBe('Effect.map');
  });

  it.each([
    ['a call', 'Date.now()'],
    ['a new expression', 'new Set<number>()'],
    ['an object allocation', '({ value: 1 })'],
    ['an array allocation', '[1, 2, 3]'],
    ['a function allocation', '() => "done"'],
    ['a class allocation', 'class {}'],
    ['a member read', 'state.value'],
    ['an optional member read', 'state?.value'],
    ['an identifier read', 'replacement'],
    ['the undefined identifier', 'undefined'],
    ['a substituted template', '`done-${state.value}`'],
    ['a tagged template', 'tag`done`'],
    ['a regular expression allocation', '/done/u'],
    ['an update', 'counter++'],
    ['an assignment', '(counter = 1)'],
    ['unary plus over a bigint', '+1n'],
    ['logical negation', '!true'],
    ['bitwise negation', '~1'],
    ['unary minus over an identifier', '-counter'],
    ['unary minus over a string', '-"1"'],
    ['unary minus over a parenthesized number', '-(1)'],
  ])('preserves Effect.map timing for %s', (_name, expression): void => {
    const source =
      `import { Effect } from "effect"; let counter = 0; ` +
      `declare const state: { value: string }; declare const replacement: string; ` +
      `Effect.map(program, () => ${expression});`;

    expect(reportsFor(source)).toHaveLength(0);
  });

  it.each([
    [
      'an async callback',
      'import { Effect } from "effect"; Effect.map(program, async () => "done");',
    ],
    [
      'a parameterized callback',
      'import { Effect } from "effect"; Effect.map(program, (_value) => "done");',
    ],
    [
      'a defaulted callback parameter',
      'import { Effect } from "effect"; Effect.map(program, (value = sideEffect()) => "done");',
    ],
    [
      'a destructured callback parameter',
      'import { Effect } from "effect"; Effect.map(program, ({ value }) => "done");',
    ],
    [
      'a block callback',
      'import { Effect } from "effect"; Effect.map(program, () => { return "done"; });',
    ],
    [
      'a callback return annotation',
      'import { Effect } from "effect"; Effect.map(program, (): string => "done");',
    ],
    [
      'a generic callback',
      'import { Effect } from "effect"; Effect.map(program, <A>() => "done");',
    ],
    [
      'a function expression',
      'import { Effect } from "effect"; Effect.map(program, function () { return "done"; });',
    ],
    [
      'a generator function expression',
      'import { Effect } from "effect"; Effect.map(program, function* () { return "done"; });',
    ],
  ])('preserves %s', (_name, source): void => {
    expect(reportsFor(source)).toHaveLength(0);
  });

  it.each([
    [
      'an explicit string assertion',
      'import { Effect } from "effect"; Effect.map(program, () => "done" as string);',
    ],
    [
      'a satisfies wrapper',
      'import { Effect } from "effect"; Effect.map(program, () => "done" satisfies string);',
    ],
    ['a non-null wrapper', 'import { Effect } from "effect"; Effect.map(program, () => "done"!);'],
    [
      'an angle-bracket assertion',
      'import { Effect } from "effect"; Effect.map(program, () => <string>"done");',
    ],
    [
      'const assertion around an allocation',
      'import { Effect } from "effect"; Effect.map(program, () => ({ value: 1 } as const));',
    ],
  ])('leaves %s to a future broader matcher', (_name, source): void => {
    expect(reportsFor(source)).toHaveLength(0);
  });

  it.each([
    ['no import', 'Effect.map(program, () => "done");'],
    [
      'an unrelated import',
      'import { Effect } from "local-effect"; Effect.map(program, () => "done");',
    ],
    [
      'a type-only root import',
      'import type { Effect } from "effect"; Effect.map(program, () => "done");',
    ],
    [
      'a type-only root specifier',
      'import { type Effect } from "effect"; Effect.map(program, () => "done");',
    ],
    [
      'a type-only subpath namespace',
      'import type * as Fx from "effect/Effect"; Fx.map(program, () => "done");',
    ],
    [
      'a different root export aliased as Effect',
      'import { Chunk as Effect } from "effect"; Effect.map(program, () => "done");',
    ],
    [
      'a shadowed root import',
      'import { Effect } from "effect"; const make = (Effect: LocalEffect) => Effect.map(program, () => "done");',
    ],
    [
      'a shadowed direct import',
      'import { map } from "effect/Effect"; const make = (map: LocalMap) => map(program, () => "done");',
    ],
    [
      'a computed map access',
      'import { Effect } from "effect"; Effect["map"](program, () => "done");',
    ],
    [
      'an optional map access',
      'import { Effect } from "effect"; Effect?.map(program, () => "done");',
    ],
    [
      'an optional map call',
      'import { Effect } from "effect"; Effect.map?.(program, () => "done");',
    ],
    [
      'an optional root-package namespace',
      'import * as EffectPackage from "effect"; EffectPackage?.Effect.map(program, () => "done");',
    ],
    [
      'an optional root-package Effect member',
      'import * as EffectPackage from "effect"; EffectPackage.Effect?.map(program, () => "done");',
    ],
    [
      'a shadowed root-package namespace',
      'import * as EffectPackage from "effect"; const make = (EffectPackage: LocalEffect) => EffectPackage.Effect.map(program, () => "done");',
    ],
  ])('ignores %s', (_name, source): void => {
    expect(reportsFor(source)).toHaveLength(0);
  });

  it.each([
    [
      'type arguments on data-first map',
      'import { Effect } from "effect"; Effect.map<number, string>(program, () => "done");',
    ],
    [
      'type arguments on pipeable map',
      'import { Effect } from "effect"; program.pipe(Effect.map<number, string>(() => "done"));',
    ],
    ['a zero-argument map call', 'import { Effect } from "effect"; Effect.map();'],
    [
      'a data-first call without a callback',
      'import { Effect } from "effect"; Effect.map(program);',
    ],
    [
      'a three-argument map call',
      'import { Effect } from "effect"; Effect.map(program, () => "done", extra);',
    ],
    [
      'a two-argument curried map call',
      'import { Effect } from "effect"; Effect.map(() => "done", extra);',
    ],
    [
      'a spread-only call',
      'import { Effect } from "effect"; Effect.map(...[program, () => "done"]);',
    ],
    [
      'a spread data argument',
      'import { Effect } from "effect"; Effect.map(...[program], () => "done");',
    ],
    [
      'a spread callback',
      'import { Effect } from "effect"; Effect.map(program, ...[() => "done"]);',
    ],
    [
      'a spread pipeable callback',
      'import { Effect } from "effect"; program.pipe(Effect.map(...[() => "done"]));',
    ],
  ])('preserves %s', (_name, source): void => {
    expect(reportsFor(source)).toHaveLength(0);
  });

  it.each([
    ['Effect.as', 'import { Effect } from "effect"; Effect.as(program, "done");'],
    ['pipeable Effect.as', 'import { Effect } from "effect"; program.pipe(Effect.as("done"));'],
    ['Effect.asVoid', 'import { Effect } from "effect"; Effect.asVoid(program);'],
    [
      'a value-dependent map',
      'import { Effect } from "effect"; Effect.map(program, (value) => String(value));',
    ],
  ])('accepts %s', (_name, source): void => {
    expect(reportsFor(source)).toHaveLength(0);
  });

  it('reports every direct occurrence', (): void => {
    const source =
      'import { Effect } from "effect"; ' +
      'const first = Effect.map(one, () => "done"); ' +
      'const second = two.pipe(Effect.map(() => null));';

    expect(reportsFor(source)).toHaveLength(2);
  });
});
