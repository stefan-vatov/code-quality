import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import preferMapOverFlatMapSucceedRule from '../../src/rules/effect-prefer-map-over-flatmap-succeed';
import { readFileSync } from 'node:fs';
import { runConfiguredRules } from './effect-rule-test-utils';
import { strictPathOptionsSchema } from '../../src/rules/effect-path-options';
import theThracianOxlint from '../../src/index';

const RULE_NAME = 'effect-prefer-map-over-flatMap-succeed';
const EXPECTED_MESSAGE =
  'Effect.map expresses this success-value transformation more directly than Effect.flatMap followed by Effect.succeed.\n' +
  'Fix: Replace Effect.flatMap with Effect.map and return the value directly from the callback.\n' +
  'Example:\n```ts\nconst result = program.pipe(Effect.map((value) => value + 1))\n```';
const fixturesDirectory = join(
  import.meta.dirname,
  'fixtures',
  'effect-prefer-map-over-flatmap-succeed',
);

const reportsForRule = (source: string) =>
  runConfiguredRules(theThracianOxlint(), source).filter(
    (report): boolean => report.ruleName === RULE_NAME,
  );

const strictRuleNames = (source: string): string[] =>
  runConfiguredRules(theThracianOxlint({ effect: { strict: true } }), source)
    .map((report) => report.ruleName)
    .filter((ruleName): ruleName is string => Boolean(ruleName));

type SyntheticNode = {
  [key: string]: unknown;
  type: string;
};

const syntheticIdentifier = (name: string): SyntheticNode => ({ name, type: 'Identifier' });

const syntheticEffectImport = (specifiers?: unknown[]): SyntheticNode => ({
  source: { type: 'Literal', value: 'effect' },
  specifiers: specifiers ?? [
    {
      imported: syntheticIdentifier('Effect'),
      local: syntheticIdentifier('Effect'),
      type: 'ImportSpecifier',
    },
  ],
  type: 'ImportDeclaration',
});

const syntheticViolation = (): SyntheticNode => {
  const effectMember = (property: string): SyntheticNode => ({
    computed: false,
    object: syntheticIdentifier('Effect'),
    property: syntheticIdentifier(property),
    type: 'MemberExpression',
  });
  return {
    arguments: [
      syntheticIdentifier('program'),
      {
        async: false,
        body: {
          arguments: [syntheticIdentifier('value')],
          callee: effectMember('succeed'),
          type: 'CallExpression',
        },
        generator: false,
        params: [syntheticIdentifier('value')],
        type: 'ArrowFunctionExpression',
      },
    ],
    callee: effectMember('flatMap'),
    type: 'CallExpression',
  };
};

const syntheticReportCount = (program: unknown): number => {
  let reportCount = 0;
  const visitor = preferMapOverFlatMapSucceedRule.create({
    report(): void {
      reportCount += 1;
    },
  });

  visitor.Program(program as object);
  return reportCount;
};

const noReportCases = [
  ['a bare Effect namespace', 'Effect.flatMap(program, (value) => Effect.succeed(value));'],
  [
    'an unrelated Effect import',
    'import { Effect } from "local-effect"; Effect.flatMap(program, (value) => Effect.succeed(value));',
  ],
  [
    'a type-only Effect import',
    'import type { Effect } from "effect"; Effect.flatMap(program, (value) => Effect.succeed(value));',
  ],
  [
    'a type-only Effect import specifier',
    'import { type Effect } from "effect"; Effect.flatMap(program, (value) => Effect.succeed(value));',
  ],
  [
    'an unsupported root namespace import',
    'import * as Effect from "effect"; Effect.flatMap(program, (value) => Effect.succeed(value));',
  ],
  [
    'an assignment-pattern parameter',
    'import { Effect } from "effect"; const run = (Effect = LocalEffect) => Effect.flatMap(program, (value) => Effect.succeed(value));',
  ],
  [
    'a rest parameter',
    'import { Effect } from "effect"; const run = (...[Effect]: [typeof LocalEffect]) => Effect.flatMap(program, (value) => Effect.succeed(value));',
  ],
  [
    'an object-destructured parameter',
    'import { Effect } from "effect"; const run = ({ Effect }: { Effect: typeof LocalEffect }) => Effect.flatMap(program, (value) => Effect.succeed(value));',
  ],
  [
    'an array-destructured parameter',
    'import { Effect } from "effect"; const run = ([Effect]: [typeof LocalEffect]) => Effect.flatMap(program, (value) => Effect.succeed(value));',
  ],
  [
    'a catch binding',
    'import { Effect } from "effect"; try { throw LocalEffect; } catch (Effect) { Effect.flatMap(program, (value) => Effect.succeed(value)); }',
  ],
  [
    'a named class expression',
    'import { Effect } from "effect"; const Local = class Effect { static value = Effect.flatMap(program, (value) => Effect.succeed(value)); };',
  ],
  [
    'a for-of declaration',
    'import { Effect } from "effect"; for (const Effect of localEffects) { Effect.flatMap(program, (value) => Effect.succeed(value)); }',
  ],
  [
    'a classic for declaration',
    'import { Effect } from "effect"; for (let Effect = LocalEffect; condition; Effect = LocalEffect) { Effect.flatMap(program, (value) => Effect.succeed(value)); }',
  ],
  [
    'a switch lexical declaration',
    'import { Effect } from "effect"; switch (kind) { case "local": const Effect = LocalEffect; Effect.flatMap(program, (value) => Effect.succeed(value)); }',
  ],
  [
    'a class static-block declaration',
    'import { Effect } from "effect"; class Local { static { const Effect = LocalEffect; Effect.flatMap(program, (value) => Effect.succeed(value)); } }',
  ],
  [
    'a TypeScript parameter property',
    'import { Effect } from "effect"; class Local { constructor(public Effect: typeof LocalEffect) { Effect.flatMap(program, (value) => Effect.succeed(value)); } }',
  ],
  [
    'a nested-block var hoisted to function scope',
    'import { Effect } from "effect"; function run() { { var Effect = LocalEffect; } return Effect.flatMap(program, (value) => Effect.succeed(value)); }',
  ],
  [
    'a generic callback',
    'import { Effect } from "effect"; Effect.flatMap(<Value>(value: Value) => Effect.succeed(value));',
  ],
  [
    'a generic function-expression callback',
    'import { Effect } from "effect"; Effect.flatMap(function <Value>(value: Value) { return Effect.succeed(value); });',
  ],
  [
    'an official flatMap with an unrelated succeed',
    'import { Effect } from "effect"; Effect.flatMap((value) => LocalEffect.succeed(value));',
  ],
  [
    'an unrelated flatMap with an official succeed',
    'import { Effect } from "effect"; LocalEffect.flatMap((value) => Effect.succeed(value));',
  ],
  [
    'a computed flatMap access',
    'import { Effect } from "effect"; Effect["flatMap"]((value) => Effect.succeed(value));',
  ],
  [
    'a parenthesized flatMap callee',
    'import { Effect } from "effect"; (Effect.flatMap)((value) => Effect.succeed(value));',
  ],
  [
    'an assertion-wrapped callback',
    'import { Effect } from "effect"; Effect.flatMap(((value) => Effect.succeed(value)) as Transformer);',
  ],
  [
    'computed identifiers at every namespace-chain level',
    'import { Effect } from "effect"; import * as EffectPackage from "effect"; Effect.flatMap(program, value => Effect[succeed](value)); EffectPackage[Effect].flatMap(program, value => EffectPackage.Effect.succeed(value)); EffectPackage.Effect[flatMap](program, value => EffectPackage.Effect.succeed(value)); EffectPackage.Effect.flatMap(program, value => EffectPackage[Effect].succeed(value)); EffectPackage.Effect.flatMap(program, value => EffectPackage.Effect[succeed](value));',
  ],
  [
    'unrelated aliases, package chains, and unsupported root named imports',
    'import { Effect, Runtime as EffectPackage } from "effect"; import { flatMap as localFlatMap, succeed as localSucceed } from "local-effect"; import * as LocalPackage from "local-effect"; localFlatMap(program, value => localSucceed(value)); LocalPackage.Effect.flatMap(program, value => LocalPackage.Effect.succeed(value)); EffectPackage.Effect.flatMap(program, value => EffectPackage.Effect.succeed(value));',
  ],
  [
    'empty, expression, throw, and two-statement callback blocks',
    'import { Effect } from "effect"; Effect.flatMap(program, () => {}); Effect.flatMap(program, value => { Effect.succeed(value); }); Effect.flatMap(program, value => { throw value; }); Effect.flatMap(program, value => { const next = value; return Effect.succeed(next); });',
  ],
  [
    'a body-hoisted direct succeed shadow',
    'import { flatMap, succeed } from "effect/Effect"; flatMap(program, value => { var succeed = LocalEffect.succeed; return succeed(value); });',
  ],
  [
    'member and NewExpression lookalikes',
    'import { Effect } from "effect"; const operation = Effect.flatMap; new Effect.flatMap(program, value => Effect.succeed(value));',
  ],
  [
    'wrong root-namespace API properties',
    'import * as EffectPackage from "effect"; EffectPackage.Effect.other(program, value => EffectPackage.Effect.succeed(value)); EffectPackage.Effect.flatMap(program, value => EffectPackage.Effect.other(value));',
  ],
  [
    'a returned success followed by a statement and a thrown success',
    'import { Effect } from "effect"; Effect.flatMap(program, value => { return Effect.succeed(value); cleanup(); }); Effect.flatMap(program, value => { throw Effect.succeed(value); });',
  ],
  [
    'a non-Effect root named import locally aliased as Effect',
    'import { Runtime as Effect } from "effect"; Effect.flatMap(program, value => Effect.succeed(value));',
  ],
  ['flatMap with no callback', 'import { Effect } from "effect"; Effect.flatMap();'],
  [
    'flatMap with unsupported arity',
    'import { Effect } from "effect"; Effect.flatMap(program, (value) => Effect.succeed(value), options);',
  ],
  [
    'succeed with no arguments',
    'import { Effect } from "effect"; Effect.flatMap(() => Effect.succeed());',
  ],
  [
    'succeed with unsupported arity',
    'import { Effect } from "effect"; Effect.flatMap((value) => Effect.succeed(value, value));',
  ],
] as const;

const scopeBoundaryCases = [
  [
    'shadows an official Effect import with a namespace-local const',
    'import { Effect } from "effect"; namespace Local { const Effect = LocalEffect; export const result = Effect.flatMap(program, (value) => Effect.succeed(value)); }',
    0,
  ],
  [
    'does not leak a namespace-local var into the outer module',
    'import { Effect } from "effect"; namespace Local { var Effect = LocalEffect; } Effect.flatMap(program, (value) => Effect.succeed(value));',
    1,
  ],
  [
    'does not leak a declared-module var into the outer module',
    'import { Effect } from "effect"; declare module "local" { var Effect: typeof LocalEffect; } Effect.flatMap(program, (value) => Effect.succeed(value));',
    1,
  ],
  [
    'keeps a function-body var out of a default parameter initializer',
    'import { Effect } from "effect"; function run(result = Effect.flatMap(program, (value) => Effect.succeed(value))) { var Effect = LocalEffect; return result; }',
    1,
  ],
  [
    'keeps switch-case lexical bindings out of the discriminant',
    'import { Effect } from "effect"; switch (Effect.flatMap(program, (value) => Effect.succeed(value))) { case 1: const Effect = LocalEffect; }',
    1,
  ],
  [
    'shadows an official Effect import with an internal import-equals declaration',
    'import { Effect } from "effect"; namespace Local { import Effect = LocalEffect; export const result = Effect.flatMap(program, (value) => Effect.succeed(value)); }',
    0,
  ],
  [
    'shadows an official Effect import with a nested namespace',
    'import { Effect } from "effect"; namespace Local { namespace Effect {} export const result = Effect.flatMap(program, (value) => Effect.succeed(value)); }',
    0,
  ],
] as const;

const parsedCoverageCases = [
  [
    'handles holes in array binding patterns',
    'import { Effect } from "effect"; function run([, Effect]: [unknown, typeof LocalEffect]) { return Effect.flatMap(program, (value) => Effect.succeed(value)); }',
    0,
  ],
  [
    'ignores export lists that do not declare bindings',
    'import { Effect } from "effect"; const value = 1; export { value }; Effect.flatMap(program, (item) => Effect.succeed(item));',
    1,
  ],
  [
    'handles non-lexical and var loop declarations',
    'import { Effect } from "effect"; for (counter = 0; counter < 1; counter += 1) { Effect.flatMap(program, (value) => Effect.succeed(value)); } for (var key in entries) { Effect.flatMap(program, (value) => Effect.succeed(value)); } for (var item of entries) { Effect.flatMap(program, (value) => Effect.succeed(value)); }',
    3,
  ],
  [
    'handles ambient and overload declarations without bodies',
    'import { Effect } from "effect"; declare function ambient(): void; function overloaded(value: string): string; function overloaded(value: number): number; function overloaded(value: string | number) { return value; } Effect.flatMap(program, (value) => Effect.succeed(value));',
    1,
  ],
  [
    'ignores unsupported named imports from the Effect module',
    'import { map } from "effect/Effect"; map(program, (value) => value);',
    0,
  ],
] as const;

describe('effect-prefer-map-over-flatMap-succeed', (): void => {
  it('publishes the exact diagnostic and rule metadata contract', (): void => {
    expect(preferMapOverFlatMapSucceedRule.meta).toEqual({
      docs: { description: EXPECTED_MESSAGE },
      schema: strictPathOptionsSchema,
      type: 'problem',
    });
    const [report] = reportsForRule(
      'import { Effect } from "effect"; Effect.flatMap(program, value => Effect.succeed(value));',
    );
    expect(report?.message).toBe(EXPECTED_MESSAGE);
  });

  it('is enabled as an error in the published default Effect config', (): void => {
    expect(theThracianOxlint().rules).toHaveProperty(`thethracian/${RULE_NAME}`, 'error');
  });

  it('reports every official v3 and v4 supported composition shape', (): void => {
    const source = readFileSync(join(fixturesDirectory, 'invalid.ts'), 'utf8');
    const reports = reportsForRule(source);

    expect(reports).toHaveLength(10);
    expect(reports.every((report) => report.message.includes('Effect.map'))).toBe(true);
  });

  it('reports the flatMap callee as the diagnostic location', (): void => {
    const source =
      'import { Effect } from "effect"; Effect.flatMap((value) => Effect.succeed(value));';
    const [report] = reportsForRule(source);
    const node = report?.node as
      | {
          end?: number;
          property?: { name?: string };
          start?: number;
          type?: string;
        }
      | undefined;

    expect(node).toMatchObject({
      property: { name: 'flatMap' },
      type: 'MemberExpression',
    });
    expect(source.slice(node?.start, node?.end)).toBe('Effect.flatMap');
  });

  it('preserves effectful callbacks, callback logic, unrelated lookalikes, and shadowed imports', (): void => {
    const source = readFileSync(join(fixturesDirectory, 'valid.ts'), 'utf8');

    expect(reportsForRule(source)).toHaveLength(0);
  });

  it.each(noReportCases)('does not report %s', (_caseName, source): void => {
    expect(reportsForRule(source)).toHaveLength(0);
  });

  it.each(scopeBoundaryCases)('%s', (_caseName, source, expectedReports): void => {
    expect(reportsForRule(source)).toHaveLength(expectedReports);
  });

  it.each(parsedCoverageCases)('%s', (_caseName, source, expectedReports): void => {
    expect(reportsForRule(source)).toHaveLength(expectedReports);
  });

  it('treats the right side of a dotted namespace as its runtime binding', (): void => {
    const source =
      'import { Effect } from "effect"; namespace Local.Effect { export const result = Effect.flatMap(program, value => Effect.succeed(value)); }';

    expect(reportsForRule(source)).toHaveLength(0);
  });

  it('recognizes Effect through the root package namespace chain', (): void => {
    const source =
      'import * as EffectPackage from "effect"; EffectPackage.Effect.flatMap(program, (value) => EffectPackage.Effect.succeed(value));';

    expect(reportsForRule(source)).toHaveLength(1);
  });

  it('exits before deep traversal when the program has no recognized Effect imports', (): void => {
    const visitor = preferMapOverFlatMapSucceedRule.create({
      report(): void {
        throw new Error('unexpected report');
      },
    });
    const program = {
      body: [],
      get unrelated(): never {
        throw new Error('deep traversal should not run');
      },
      type: 'Program',
    };

    expect(() => visitor.Program(program)).not.toThrow();
  });

  it.each([
    ['a missing body', { type: 'Program' }],
    ['a non-array body', { body: {}, type: 'Program' }],
  ])('handles Program with %s', (_caseName, program): void => {
    expect(syntheticReportCount(program)).toBe(0);
  });

  it('ignores non-node entries in AST arrays', (): void => {
    const program = {
      body: [syntheticEffectImport(), null, 1, {}, 'value', syntheticViolation()],
      type: 'Program',
    };

    expect(syntheticReportCount(program)).toBe(1);
  });

  it('ignores imports with missing and non-string sources', (): void => {
    const program = {
      body: [
        { specifiers: [], type: 'ImportDeclaration' },
        {
          source: { type: 'Literal', value: 42 },
          specifiers: [],
          type: 'ImportDeclaration',
        },
        syntheticEffectImport(),
        syntheticViolation(),
      ],
      type: 'Program',
    };

    expect(syntheticReportCount(program)).toBe(1);
  });

  it('ignores an Effect import specifier without a local binding', (): void => {
    const missingLocal = {
      imported: syntheticIdentifier('Effect'),
      type: 'ImportSpecifier',
    };
    const program = {
      body: [syntheticEffectImport([missingLocal]), syntheticEffectImport(), syntheticViolation()],
      type: 'Program',
    };

    expect(syntheticReportCount(program)).toBe(1);
  });

  it('visits a shared AST node only once', (): void => {
    const violation = syntheticViolation();
    const program = {
      body: [syntheticEffectImport(), violation, violation],
      type: 'Program',
    };

    expect(syntheticReportCount(program)).toBe(1);
  });

  it('ignores an enumerable circular parent edge', (): void => {
    const violation = syntheticViolation();
    const program: SyntheticNode = {
      body: [syntheticEffectImport(), violation],
      type: 'Program',
    };
    violation.parent = program;

    expect(syntheticReportCount(program)).toBe(1);
  });

  it.each([undefined, null, 42, {}, { type: 42 }])(
    'ignores invalid Program input %#',
    (program): void => {
      expect(syntheticReportCount(program)).toBe(0);
    },
  );

  it('reports each nested violation exactly once', (): void => {
    const source =
      'import { Effect } from "effect"; Effect.flatMap(program, (outer) => Effect.succeed(Effect.flatMap(other, (inner) => Effect.succeed([outer, inner]))));';

    expect(reportsForRule(source)).toHaveLength(2);
  });

  it('coexists with broader nested sequencing guidance', (): void => {
    const nested = strictRuleNames(
      'import { Effect } from "effect"; const result = program.pipe(Effect.flatMap((value) => other.pipe(Effect.flatMap((inner) => Effect.succeed(inner + value)))));',
    );

    expect(nested).toContain('effect-prefer-gen-for-nested-flatmap');
    expect(nested).toContain(RULE_NAME);
  });

  it('coexists with strict void cleanup guidance', (): void => {
    const voidSuccess = strictRuleNames(
      'import { Effect } from "effect"; const result = program.pipe(Effect.flatMap(() => Effect.succeed(undefined)));',
    );

    expect(voidSuccess).toContain('effect-prefer-effect-void');
    expect(voidSuccess).toContain(RULE_NAME);
  });
});
