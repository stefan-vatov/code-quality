import { describe, expect, it } from 'vitest';
import { runRule } from './effect-rule-test-utils';
import theThracianOxlint from '../../src/index';

const RULE_NAME = 'effect-prefer-succeed-for-stable-values';
const EXPECTED_MESSAGE =
  'Effect.succeed expresses this stable value more directly than Effect.sync.\n' +
  'Fix: Replace Effect.sync with Effect.succeed and remove the zero-argument thunk.\n' +
  'Example:\n```ts\nconst task = Effect.succeed(value)\n```';

const reportsFor = (source: string) => runRule(RULE_NAME, source);

describe('effect-prefer-succeed-for-stable-values', (): void => {
  it('is registered as an error in the default Effect config', (): void => {
    expect(theThracianOxlint().rules).toHaveProperty(`thethracian/${RULE_NAME}`, 'error');
  });

  it.each([
    ['string', '"value"'],
    ['number', '1'],
    ['boolean', 'true'],
    ['null', 'null'],
    ['bigint', '1n'],
    ['static template', '`value`'],
  ])('reports a stable %s literal', (_name, expression): void => {
    const reports = reportsFor(
      `import { Effect } from "effect"; const task = Effect.sync(() => ${expression});`,
    );

    expect(reports).toHaveLength(1);
    expect(reports[0]?.message).toBe(EXPECTED_MESSAGE);
  });

  it('reports the global undefined value as stable', (): void => {
    const source = 'import { Effect } from "effect"; const task = Effect.sync(() => undefined);';

    expect(reportsFor(source)).toHaveLength(1);
  });

  it('reports a type-asserted global undefined value as stable', (): void => {
    const source =
      'import { Effect } from "effect"; type SomeType = undefined; ' +
      'const task = Effect.sync(() => undefined as SomeType);';

    expect(reportsFor(source)).toHaveLength(1);
  });

  it('preserves a parameter that shadows the global undefined binding', (): void => {
    const source =
      'import { Effect } from "effect"; ' +
      'const make = (undefined: string) => Effect.sync(() => undefined);';

    expect(reportsFor(source)).toHaveLength(0);
  });

  it.each([
    ['root alias', 'import { Effect as Fx } from "effect"; const task = Fx.sync(() => "value");'],
    [
      'Effect module namespace',
      'import * as Fx from "effect/Effect"; const task = Fx.sync(() => "value");',
    ],
    [
      'aliased named import',
      'import { sync as effectSync } from "effect/Effect"; const task = effectSync(() => "value");',
    ],
    [
      'root package namespace',
      'import * as EffectPackage from "effect"; const task = EffectPackage.Effect.sync(() => "value");',
    ],
  ])('recognizes a genuine %s import', (_name, source): void => {
    expect(reportsFor(source)).toHaveLength(1);
  });

  it.each([
    [
      'initialized const primitive',
      'import { Effect } from "effect"; const value = "stable"; const task = Effect.sync(() => value);',
    ],
    [
      'initialized const object identity',
      'import { Effect } from "effect"; const value = new Set<number>(); const task = Effect.sync(() => value);',
    ],
    [
      'single-return function expression',
      'import { Effect } from "effect"; const value = []; const task = Effect.sync(function() { return value; });',
    ],
    [
      'same-block const',
      'import { Effect } from "effect"; { const value = {}; const task = Effect.sync(() => value); }',
    ],
    [
      'same-switch-case earlier const',
      'import { Effect } from "effect"; declare const selected: number; switch (selected) { case 0: const value = "stable"; const task = Effect.sync(() => value); break; }',
    ],
    [
      'outer const used inside a switch case',
      'import { Effect } from "effect"; const value = "stable"; declare const selected: number; switch (selected) { case 0: const task = Effect.sync(() => value); break; }',
    ],
  ])('reports a stable %s', (_name, source): void => {
    expect(reportsFor(source)).toHaveLength(1);
  });

  it('reports the imported sync callee as the diagnostic location', (): void => {
    const source = 'import { Effect } from "effect"; const task = Effect.sync(() => "stable");';
    const [report] = reportsFor(source);
    const node = report?.node as { end?: number; start?: number; type?: string } | undefined;

    expect(node?.type).toBe('MemberExpression');
    expect(source.slice(node?.start, node?.end)).toBe('Effect.sync');
  });

  it.each([
    ['a call', 'Date.now()'],
    ['a new expression', 'new Set<number>()'],
    ['an object allocation', '({ value: 1 })'],
    ['an array allocation', '[1, 2, 3]'],
    ['a member read', 'state.value'],
    ['an optional member read', 'state?.value'],
    ['a substituted template', '`value-${state.value}`'],
    ['a regular expression allocation', '/value/u'],
    ['an update', 'counter++'],
    ['an assignment', '(counter = 1)'],
  ])('preserves Effect.sync for %s', (_name, expression): void => {
    const source =
      `import { Effect } from "effect"; let counter = 0; ` +
      `declare const state: { value: string }; const task = Effect.sync(() => ${expression});`;

    expect(reportsFor(source)).toHaveLength(0);
  });

  it.each([
    [
      'a mutable binding',
      'import { Effect } from "effect"; let value = "first"; const task = Effect.sync(() => value); value = "second";',
    ],
    [
      'a var binding',
      'import { Effect } from "effect"; var value = "first"; const task = Effect.sync(() => value);',
    ],
    [
      'a declaration after construction',
      'import { Effect } from "effect"; const task = Effect.sync(() => value); const value = "later";',
    ],
    [
      'a shadowing parameter',
      'import { Effect } from "effect"; const value = "outer"; const make = (value: string) => Effect.sync(() => value);',
    ],
    [
      'an imported live binding',
      'import { Effect } from "effect"; import { value } from "./state"; const task = Effect.sync(() => value);',
    ],
    [
      'an ambient const without an initializer',
      'import { Effect } from "effect"; declare const value: string; const task = Effect.sync(() => value);',
    ],
    [
      'an outer const captured inside an arrow execution context',
      'import { Effect } from "effect"; const value = "stable"; const make = () => Effect.sync(() => value);',
    ],
    [
      'an outer const captured inside a function expression execution context',
      'import { Effect } from "effect"; const value = "stable"; const make = function() { return Effect.sync(() => value); };',
    ],
  ])('preserves execution-time reads for %s', (_name, source): void => {
    expect(reportsFor(source)).toHaveLength(0);
  });

  it('preserves a hoisted helper capture constructed before outer const initialization', (): void => {
    const source =
      'import { Effect } from "effect"; ' +
      'const task = make(); const value = "later"; ' +
      'function make() { return Effect.sync(() => value); }';

    expect(reportsFor(source)).toHaveLength(0);
  });

  it('preserves a const capture whose declaration is in another switch case', (): void => {
    const source =
      'import { Effect } from "effect"; declare const selection: number; ' +
      'switch (selection) { case 0: const value = "stable"; break; ' +
      'case 1: const task = Effect.sync(() => value); break; }';

    expect(reportsFor(source)).toHaveLength(0);
  });

  it.each([
    [
      'an async thunk',
      'import { Effect } from "effect"; const task = Effect.sync(async () => "value");',
    ],
    [
      'a generator thunk',
      'import { Effect } from "effect"; const task = Effect.sync(function*() { return "value"; });',
    ],
    [
      'a parameterized thunk',
      'import { Effect } from "effect"; const task = Effect.sync((value = sideEffect()) => "value");',
    ],
    [
      'an effectful block',
      'import { Effect } from "effect"; const task = Effect.sync(() => { sideEffect(); return "value"; });',
    ],
    [
      'a throwing block',
      'import { Effect } from "effect"; const task = Effect.sync(() => { throw new Error("boom"); });',
    ],
    [
      'a return block with an extra statement',
      'import { Effect } from "effect"; const task = Effect.sync(() => { return "value"; sideEffect(); });',
    ],
  ])('preserves %s semantics', (_name, source): void => {
    expect(reportsFor(source)).toHaveLength(0);
  });

  it.each([
    ['no import', 'const task = Effect.sync(() => "value");'],
    [
      'unrelated import',
      'import { Effect } from "local-effect"; const task = Effect.sync(() => "value");',
    ],
    [
      'type-only import',
      'import type { Effect } from "effect"; const task = Effect.sync(() => "value");',
    ],
    [
      'computed access',
      'import { Effect } from "effect"; const task = Effect["sync"](() => "value");',
    ],
    [
      'shadowed namespace',
      'import { Effect } from "effect"; const make = (Effect: LocalEffect) => Effect.sync(() => "value");',
    ],
    [
      'shadowed direct import',
      'import { sync } from "effect/Effect"; const make = (sync: LocalSync) => sync(() => "value");',
    ],
  ])('ignores %s', (_name, source): void => {
    expect(reportsFor(source)).toHaveLength(0);
  });
});
