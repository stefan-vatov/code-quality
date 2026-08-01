import { describe, expect, it } from 'vitest';
import type { SourceRule } from '../../src/rules/effect-rule-core';
import plugin from '../../src/rules/plugin';
import { runRule } from './effect-rule-test-utils';
import theThracianOxlint from '../../src/index';

const RULE_NAME = 'effect-prefer-all-discard';
const EXPECTED_MESSAGE =
  "Effect.all with { discard: true } avoids collecting successful values when a delegated yield ignores an array literal's result.\n" +
  'Fix: Pass { discard: true } as the second argument.\n' +
  'Example:\n```ts\nimport { Effect } from "effect"\n\n' +
  'Effect.gen(function* () {\n' +
  '  yield* Effect.all([first, second], { discard: true })\n' +
  '})\n```';

const imported = (statement: string): string => `import { Effect } from "effect"; ${statement}`;
const allYield = (values = '[effectA, effectB]'): string => `yield* Effect.all(${values});`;
const generated = (body: string): string => imported(`Effect.gen(function* () { ${body} });`);
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

describe('effect-prefer-all-discard', (): void => {
  it('is registered as a problem and enabled as an error in the default config', (): void => {
    const rule = registeredRule();

    expect(rule.meta?.type).toBe('problem');
    expect(theThracianOxlint().rules).toHaveProperty(`thethracian/${RULE_NAME}`, 'error');
  });

  it.each([
    'gen all yield',
    'effect all yield',
    'effect gen yield',
    'effect gen all',
    'Effect gen all yield',
  ])('keeps only the cheap Program visitor for source %j', (source): void => {
    expect(visitorKeysFor(source)).toStrictEqual(['Program']);
  });

  it('enables call analysis when every lowercase candidate token occurs from offset zero', (): void => {
    expect(visitorKeysFor('effect gen all yield')).toStrictEqual(['CallExpression', 'Program']);
  });

  it.each([
    ['the canonical array', generated(allYield())],
    ['an empty array', generated(allYield('[]'))],
    ['an array of literals', generated(allYield('[effectA, effectB, effectC]'))],
    [
      'a root Effect alias',
      'import { Effect as Fx } from "effect"; Fx.gen(function* () { yield* Fx.all([effectA, effectB]); });',
    ],
    [
      'an effect/Effect namespace',
      'import * as Fx from "effect/Effect"; Fx.gen(function* () { yield* Fx.all([effectA, effectB]); });',
    ],
    [
      'aliased named effect/Effect imports',
      'import { gen as run, all as collect } from "effect/Effect"; run(function* () { yield* collect([effectA, effectB]); });',
    ],
    [
      'a root package namespace through Effect',
      'import * as Root from "effect"; Root.Effect.gen(function* () { yield* Root.Effect.all([effectA, effectB]); });',
    ],
    [
      'a root gen mixed with a named subpath all',
      'import { Effect } from "effect"; import { all as collect } from "effect/Effect"; Effect.gen(function* () { yield* collect([effectA, effectB]); });',
    ],
    [
      'a named subpath gen mixed with a root all',
      'import { Effect } from "effect"; import { gen as run } from "effect/Effect"; run(function* () { yield* Effect.all([effectA, effectB]); });',
    ],
    ['a conditional branch', generated(`if (enabled) { ${allYield()} } return result;`)],
    ['a loop body', generated(`for (const page of pages) { ${allYield('[load(page)]')} }`)],
    ['a try block', generated(`try { ${allYield()} } finally { yield* cleanup; }`)],
    ['nested blocks', generated(`{ { ${allYield()} } }`)],
  ])('reports %s', (_name, source): void => {
    expect(reportsFor(source)).toHaveLength(1);
  });

  it('reports every independent ignored array result', (): void => {
    expect(
      reportsFor(generated(`${allYield('[first]')} ${allYield('[second, third]')}`)),
    ).toHaveLength(2);
  });

  it('publishes the exact diagnostic without a fix or suggestions', (): void => {
    const [report] = reportsFor(generated(allYield()));

    expect(report?.message).toBe(EXPECTED_MESSAGE);
    expect(Reflect.get(report ?? {}, 'fix')).toBeUndefined();
    expect(Reflect.get(report ?? {}, 'suggest')).toBeUndefined();
    expect(Reflect.get(report ?? {}, 'suggestions')).toBeUndefined();
  });

  it('reports the Effect.all callee as the diagnostic location', (): void => {
    const source = generated(allYield());
    const [report] = reportsFor(source);
    const node = report?.node as { end?: number; start?: number; type?: string } | undefined;

    expect(node?.type).toBe('MemberExpression');
    expect(source.slice(node?.start, node?.end)).toBe('Effect.all');
  });

  it.each([
    ['an assignment', generated('const results = yield* Effect.all([effectA, effectB]);')],
    ['a return', generated('return yield* Effect.all([effectA, effectB]);')],
    ['a call argument', generated('consume(yield* Effect.all([effectA, effectB]));')],
    ['an array element', generated('[yield* Effect.all([effectA, effectB])];')],
    ['a sequence expression', generated('(yield* Effect.all([effectA, effectB]), after);')],
    ['a unary wrapper', generated('void (yield* Effect.all([effectA, effectB]));')],
    ['a parenthesized all call', generated('yield* (Effect.all([effectA, effectB]));')],
    [
      'a chained all result',
      generated('yield* Effect.all([effectA, effectB]).pipe(Effect.asVoid);'),
    ],
    [
      'an all call nested in another call',
      generated('yield* consume(Effect.all([effectA, effectB]));'),
    ],
    ['a nondelegated yield', generated('yield Effect.all([effectA, effectB]);')],
    ['a bare all call without yield', generated('Effect.all([effectA, effectB]);')],
  ])(
    'ignores %s because the delegated yield is not the whole bare statement',
    (_name, source): void => {
      expect(reportsFor(source)).toHaveLength(0);
    },
  );

  it.each([
    ['an identifier input', 'effects'],
    ['a call input', 'makeEffects()'],
    ['an object input', '{ first: effectA, second: effectB }'],
    ['a new-expression input', 'new Set([effectA, effectB])'],
  ])('preserves Effect.all for the v4-safe %s', (_name, input): void => {
    expect(reportsFor(generated(allYield(input)))).toHaveLength(0);
  });

  it.each([
    ['no arguments', generated('yield* Effect.all();')],
    ['an options argument', generated('yield* Effect.all([effectA], { concurrency: 2 });')],
    ['discard false', generated('yield* Effect.all([effectA], { discard: false });')],
    ['three arguments', generated('yield* Effect.all([effectA], options, extra);')],
    ['spread call arguments', generated('yield* Effect.all(...effectGroups);')],
    ['a spread array element', generated('yield* Effect.all([...effects]);')],
    ['explicit all type arguments', generated('yield* Effect.all<Output>([effectA]);')],
    ['computed all access', generated('yield* Effect["all"]([effectA]);')],
    ['optional all access', generated('yield* Effect?.all([effectA]);')],
    ['optional all call', generated('yield* Effect.all?.([effectA]);')],
  ])('rejects %s', (_name, source): void => {
    expect(reportsFor(source)).toHaveLength(0);
  });

  it.each([
    [
      'a stored generator callback',
      imported(`const program = function* () { ${allYield()} }; Effect.gen(program);`),
    ],
    ['a named generator callback', imported(`Effect.gen(function* program() { ${allYield()} });`)],
    ['an async generator callback', imported(`Effect.gen(async function* () { ${allYield()} });`)],
    [
      'an annotated generator callback',
      imported(
        `Effect.gen(function* (): Generator<Effect.Effect<void>, void, never> { ${allYield()} });`,
      ),
    ],
    [
      'a generic generator callback',
      imported(`Effect.gen(function* <Value>() { ${allYield()} });`),
    ],
    [
      'a generator callback parameter',
      imported(`Effect.gen(function* (resume) { ${allYield()} });`),
    ],
    ['gen without arguments', imported('Effect.gen();')],
    ['gen with two arguments', imported(`Effect.gen(adapter, function* () { ${allYield()} });`)],
    [
      'gen with three arguments',
      imported(`Effect.gen(first, second, function* () { ${allYield()} });`),
    ],
    [
      'a spread gen argument',
      imported(`Effect.gen(...callbacks); function* fallback() { ${allYield()} }`),
    ],
    [
      'explicit gen type arguments',
      imported(`Effect.gen<Output>(function* () { ${allYield()} });`),
    ],
    ['computed gen access', imported(`Effect["gen"](function* () { ${allYield()} });`)],
    ['optional gen access', imported(`Effect?.gen(function* () { ${allYield()} });`)],
    ['optional gen call', imported(`Effect.gen?.(function* () { ${allYield()} });`)],
  ])('rejects %s', (_name, source): void => {
    expect(reportsFor(source)).toHaveLength(0);
  });

  it.each([
    [`no import`, `Effect.gen(function* () { ${allYield()} });`],
    [
      'a foreign root import',
      `import { Effect } from "local-effect"; Effect.gen(function* () { ${allYield()} });`,
    ],
    [
      'a type-only root import',
      `import type { Effect } from "effect"; Effect.gen(function* () { ${allYield()} });`,
    ],
    [
      'type-only subpath imports',
      'import { type gen, type all } from "effect/Effect"; gen(function* () { yield* all([effectA]); });',
    ],
    [
      'a different root export aliased as Effect',
      `import { Chunk as Effect } from "effect"; Effect.gen(function* () { ${allYield()} });`,
    ],
    [
      'a shadowed root Effect binding',
      imported(`const run = (Effect: LocalEffect) => Effect.gen(function* () { ${allYield()} });`),
    ],
    [
      'a shadowed named gen binding',
      'import { gen, all } from "effect/Effect"; const run = (gen: LocalGen) => gen(function* () { yield* all([effectA]); });',
    ],
    [
      'a shadowed named all binding',
      'import { gen, all } from "effect/Effect"; const run = (all: LocalAll) => gen(function* () { yield* all([effectA]); });',
    ],
    [
      'direct APIs on a root package namespace',
      'import * as Root from "effect"; Root.gen(function* () { yield* Root.all([effectA]); });',
    ],
    [
      'a direct root namespace gen with an official all',
      'import * as Root from "effect"; Root.gen(function* () { yield* Root.Effect.all([effectA]); });',
    ],
    [
      'an official gen with a direct root namespace all',
      'import * as Root from "effect"; Root.Effect.gen(function* () { yield* Root.all([effectA]); });',
    ],
    [
      'an official gen with a local all symbol',
      'import { gen } from "effect/Effect"; gen(function* () { yield* localAll([effectA]); });',
    ],
    [
      'a local gen with an official all symbol',
      'import { all } from "effect/Effect"; localGen(function* () { yield* all([effectA]); });',
    ],
  ])('ignores %s', (_name, source): void => {
    expect(reportsFor(source)).toHaveLength(0);
  });

  it.each([
    [
      'a nested generator declaration',
      generated(`function* nested() { ${allYield()} } yield* other;`),
    ],
    [
      'a nested generator expression',
      generated(`const nested = function* () { ${allYield()} }; yield* other;`),
    ],
  ])('does not borrow a delegated yield from %s', (_name, source): void => {
    expect(reportsFor(source)).toHaveLength(0);
  });
});
