import { describe, expect, it } from 'vitest';
import { runAllRules, runRule } from './effect-rule-test-utils';
import type { SourceRule } from '../../src/rules/effect-rule-core';
import plugin from '../../src/rules/plugin';
import theThracianOxlint from '../../src/index';

const RULE_NAME = 'effect-prefer-forEach-discard';
const EXPECTED_MESSAGE =
  'Effect.forEach with { discard: true } avoids collecting a result array when a delegated yield ignores the result.\n' +
  'Fix: Add discard: true to the existing options object, or add an options object when none exists.\n' +
  'Example:\n```ts\nimport { Effect } from "effect"\n\n' +
  'Effect.gen(function* () {\n' +
  '  yield* Effect.forEach(items, work, { concurrency: 4, discard: true })\n' +
  '})\n```';

const imported = (statement: string): string => `import { Effect } from "effect"; ${statement}`;
const forEachYield = (options = ''): string =>
  `yield* Effect.forEach(items, work${options ? `, ${options}` : ''});`;
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

describe('effect-prefer-forEach-discard', (): void => {
  it('is registered as a problem and enabled in the default Effect config', (): void => {
    const rule = registeredRule();

    expect(rule.meta?.type).toBe('problem');
    expect(theThracianOxlint().rules).toHaveProperty(`thethracian/${RULE_NAME}`, 'error');
  });

  it.each(['const value = 1;', 'gen yield', 'forEach yield', 'forEach gen'])(
    'keeps only the cheap Program visitor for source %j',
    (source): void => {
      expect(visitorKeysFor(source)).toStrictEqual(['Program']);
    },
  );

  it('enables call analysis when every candidate token occurs from offset zero', (): void => {
    expect(visitorKeysFor('forEach gen yield')).toStrictEqual(['CallExpression', 'Program']);
  });

  it.each([
    ['no options', generated(forEachYield())],
    ['an empty options object', generated(forEachYield('{}'))],
    ['bounded concurrency', generated(forEachYield('{ concurrency: 4 }'))],
    ['v3 batching', generated(forEachYield('{ batching: true }'))],
    ['v3 concurrent finalizers', generated(forEachYield('{ concurrentFinalizers: true }'))],
    [
      'all cross-version and v3 options',
      generated(
        forEachYield(
          '{ concurrency: "unbounded", batching: "inherit", concurrentFinalizers: false }',
        ),
      ),
    ],
    [
      'quoted and shorthand option keys',
      imported(
        'const concurrency = 4; Effect.gen(function* () { yield* Effect.forEach(items, work, { concurrency, "batching": true }); });',
      ),
    ],
    [
      'the two-argument gen form',
      imported(`Effect.gen(adapter, function* () { ${forEachYield()} });`),
    ],
    [
      'a v3 generator adapter parameter',
      imported(`Effect.gen(function* (resume) { ${forEachYield()} });`),
    ],
    [
      'a root Effect alias',
      'import { Effect as Fx } from "effect"; Fx.gen(function* () { yield* Fx.forEach(items, work); });',
    ],
    [
      'an Effect subpath namespace',
      'import * as Fx from "effect/Effect"; Fx.gen(function* () { yield* Fx.forEach(items, work); });',
    ],
    [
      'aliased named subpath imports',
      'import { gen as run, forEach as traverse } from "effect/Effect"; run(function* () { yield* traverse(items, work); });',
    ],
    [
      'a root package namespace',
      'import * as EffectPackage from "effect"; EffectPackage.Effect.gen(function* () { yield* EffectPackage.Effect.forEach(items, work); });',
    ],
    [
      'mixed valid import styles',
      'import { Effect } from "effect"; import { forEach as traverse } from "effect/Effect"; Effect.gen(function* () { yield* traverse(items, work); });',
    ],
    ['a conditional branch', generated(`if (enabled) { ${forEachYield()} } return result;`)],
    ['a loop body', generated(`for (const page of pages) { ${forEachYield()} }`)],
    ['a try block', generated(`try { ${forEachYield()} } finally { yield* cleanup; }`)],
    ['a nested block', generated(`{ { ${forEachYield()} } }`)],
  ])('reports %s across the supported Effect v3/v4 source forms', (_name, source): void => {
    expect(reportsFor(source)).toHaveLength(1);
  });

  it('reports every independent ignored traversal', (): void => {
    const source = generated(
      `${forEachYield('{ concurrency: 2 }')} ${forEachYield('{ batching: true }')}`,
    );

    expect(reportsFor(source)).toHaveLength(2);
  });

  it('publishes the exact diagnostic without an automatic fix', (): void => {
    const [report] = reportsFor(generated(forEachYield('{ concurrency: 4 }')));

    expect(report?.message).toBe(EXPECTED_MESSAGE);
    expect(Reflect.get(report ?? {}, 'fix')).toBeUndefined();
  });

  it('reports the forEach callee as the diagnostic location', (): void => {
    const source = generated(forEachYield());
    const [report] = reportsFor(source);
    const node = report?.node as { end?: number; start?: number; type?: string } | undefined;

    expect(node?.type).toBe('MemberExpression');
    expect(source.slice(node?.start, node?.end)).toBe('Effect.forEach');
  });

  it.each([
    ['assignment', generated(`const results = ${forEachYield().replace(/;$/, '')};`)],
    ['return', generated(`return ${forEachYield().replace(/;$/, '')};`)],
    ['a call argument', generated(`consume(${forEachYield().replace(/;$/, '')});`)],
    ['an array element', generated(`[${forEachYield().replace(/;$/, '')}];`)],
    ['a sequence expression', generated(`(${forEachYield().replace(/;$/, '')}, after);`)],
    ['a unary expression', generated(`void (${forEachYield().replace(/;$/, '')});`)],
    [
      'a chained forEach result',
      generated('yield* Effect.forEach(items, work).pipe(Effect.asVoid);'),
    ],
    ['plain yield', generated('yield Effect.forEach(items, work);')],
  ])('preserves collection when the result is consumed by %s', (_name, source): void => {
    expect(reportsFor(source)).toHaveLength(0);
  });

  it.each([
    ['a data-last call', generated('yield* Effect.forEach(work)(items);')],
    [
      'a data-last operator with options',
      generated('yield* Effect.forEach(work, { concurrency: 4 });'),
    ],
    ['a pipeable call', generated('yield* items.pipe(Effect.forEach(work));')],
    ['one argument', generated('yield* Effect.forEach(items);')],
    ['four arguments', generated('yield* Effect.forEach(items, work, {}, extra);')],
    ['a spread iterable', generated('yield* Effect.forEach(...values, work);')],
    ['a spread callback', generated('yield* Effect.forEach(items, ...callbacks);')],
    ['spread-only arguments', generated('yield* Effect.forEach(...argumentsList);')],
    [
      'explicit forEach type arguments',
      generated('yield* Effect.forEach<Item, Output>(items, work);'),
    ],
    ['computed forEach access', generated('yield* Effect["forEach"](items, work);')],
    ['optional forEach access', generated('yield* Effect?.forEach(items, work);')],
    ['optional forEach call', generated('yield* Effect.forEach?.(items, work);')],
  ])('ignores %s', (_name, source): void => {
    expect(reportsFor(source)).toHaveLength(0);
  });

  it.each([
    ['existing discard true', '{ discard: true }'],
    ['existing discard false', '{ discard: false }'],
    ['existing quoted discard', '{ "discard": value }'],
    ['identifier options', 'options'],
    ['member options', 'settings.forEach'],
    ['an unknown key', '{ ordered: true }'],
    ['__proto__', '{ __proto__: prototype }'],
    ['an object spread', '{ ...options, concurrency: 4 }'],
    ['a computed key', '{ [key]: 4 }'],
    ['a computed allowed key', '{ ["concurrency"]: 4 }'],
    ['a getter', '{ get concurrency() { return 4 } }'],
    ['a setter', '{ set concurrency(value) {} }'],
    ['a method', '{ concurrency() { return 4 } }'],
    ['an asserted options object', '({ concurrency: 4 } as const)'],
    ['a satisfied options object', '({ concurrency: 4 } satisfies object)'],
  ])('rejects unsafe options for %s', (_name, options): void => {
    expect(reportsFor(generated(forEachYield(options)))).toHaveLength(0);
  });

  it.each([
    [
      'explicit gen type arguments',
      imported(`Effect.gen<Output>(function* () { ${forEachYield()} });`),
    ],
    [
      'an annotated generator callback',
      imported(
        `Effect.gen(function* (): Generator<Effect.Effect<void>, void, never> { ${forEachYield()} });`,
      ),
    ],
    [
      'a generic generator callback',
      imported(`Effect.gen(function* <Value>() { ${forEachYield()} });`),
    ],
    [
      'a named generator callback that can escape',
      imported(`Effect.gen(function* program() { ${forEachYield()} });`),
    ],
    [
      'an async generator callback',
      imported(`Effect.gen(async function* () { ${forEachYield()} });`),
    ],
    [
      'a stored generator callback',
      imported(`const program = function* () { ${forEachYield()} }; Effect.gen(program);`),
    ],
    ['a standalone generator', imported(`function* program() { ${forEachYield()} }`)],
    [
      'a nested ordinary generator',
      generated(`function* nested() { ${forEachYield()} } yield* other;`),
    ],
    [
      'a nested ordinary function',
      generated(`const nested = function* () { ${forEachYield()} }; yield* other;`),
    ],
    ['gen without arguments', imported('Effect.gen();')],
    [
      'gen with three arguments',
      imported(`Effect.gen(first, second, function* () { ${forEachYield()} });`),
    ],
    [
      'a spread gen callback',
      imported(`Effect.gen(...callbacks, function* () { ${forEachYield()} });`),
    ],
    ['computed gen access', imported(`Effect["gen"](function* () { ${forEachYield()} });`)],
    ['optional gen access', imported(`Effect?.gen(function* () { ${forEachYield()} });`)],
    ['optional gen call', imported(`Effect.gen?.(function* () { ${forEachYield()} });`)],
  ])('rejects %s', (_name, source): void => {
    expect(reportsFor(source)).toHaveLength(0);
  });

  it.each([
    ['no import', `Effect.gen(function* () { ${forEachYield()} });`],
    [
      'an unrelated root import',
      `import { Effect } from "local-effect"; Effect.gen(function* () { ${forEachYield()} });`,
    ],
    [
      'a type-only root import',
      `import type { Effect } from "effect"; Effect.gen(function* () { ${forEachYield()} });`,
    ],
    [
      'type-only subpath imports',
      'import { type gen, type forEach } from "effect/Effect"; gen(function* () { yield* forEach(items, work); });',
    ],
    [
      'a different root export aliased as Effect',
      `import { Chunk as Effect } from "effect"; Effect.gen(function* () { ${forEachYield()} });`,
    ],
    [
      'a shadowed root Effect binding',
      imported(
        `const run = (Effect: LocalEffect) => Effect.gen(function* () { ${forEachYield()} });`,
      ),
    ],
    [
      'a shadowed named gen binding',
      'import { gen, forEach } from "effect/Effect"; const run = (gen: LocalGen) => gen(function* () { yield* forEach(items, work); });',
    ],
    [
      'a shadowed named forEach binding',
      'import { gen, forEach } from "effect/Effect"; const run = (forEach: LocalForEach) => gen(function* () { yield* forEach(items, work); });',
    ],
    [
      'local lookalikes',
      'import { Effect } from "effect"; LocalEffect.gen(function* () { yield* LocalEffect.forEach(items, work); });',
    ],
    [
      'invalid direct APIs on a root package namespace',
      'import * as EffectPackage from "effect"; EffectPackage.gen(function* () { yield* EffectPackage.forEach(items, work); });',
    ],
  ])('ignores %s', (_name, source): void => {
    expect(reportsFor(source)).toHaveLength(0);
  });

  it('accepts canonical discarded collection', (): void => {
    expect(reportsFor(generated(forEachYield('{ concurrency: 4, discard: true }')))).toHaveLength(
      0,
    );
  });

  it('does not overlap adjacent Effect composition rules', (): void => {
    registeredRule();
    const relevantRules = new Set([
      RULE_NAME,
      'effect-no-floating-effect',
      'effect-no-unnecessary-gen',
      'effect-require-bounded-concurrency',
      'effect-require-return-yield-star',
      'effect-require-yield-star',
      'effect-prefer-andThen-over-flatMap-discarded-value',
      'effect-prefer-map-over-flatMap-succeed',
    ]);
    const reports = runAllRules(
      imported(
        'const program = Effect.gen(function* () { yield* Effect.forEach(items, (item) => Effect.succeed(item), { concurrency: 4 }); return result; });',
      ),
    )
      .map((report) => report.ruleName)
      .filter((ruleName): ruleName is string => Boolean(ruleName && relevantRules.has(ruleName)));

    expect(reports).toStrictEqual([RULE_NAME]);
  });
});
