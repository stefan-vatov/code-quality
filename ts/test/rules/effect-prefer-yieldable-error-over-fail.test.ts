import { describe, expect, it } from 'vitest';
import type { SourceRule } from '../../src/rules/effect-rule-core';
import { parseSync } from 'oxc-parser';
import plugin from '../../src/rules/plugin';
import { runRule } from './effect-rule-test-utils';
import theThracianOxlint from '../../src/index';

const RULE_NAME = 'effect-prefer-yieldable-error-over-fail';
const EXPECTED_MESSAGE =
  'Yield recognized Cause.YieldableError instances directly instead of wrapping them in Effect.fail.\n' +
  'Fix: Remove Effect.fail and yield the recognized Cause.YieldableError instance directly.\n' +
  'Example:\n```ts\nimport { Data, Effect } from "effect"\n\n' +
  'class NotFound extends Data.TaggedError("NotFound")<{ id: string }> {}\n\n' +
  'const program = Effect.gen(function* () {\n' +
  '  return yield* new NotFound({ id })\n' +
  '})\n```';
type ReportDescriptor = { message: string; node: object };
type VisitorMap = Record<string, ((node: object) => void) | undefined>;
const classDeclaration = 'class NotFound extends Data.TaggedError("NotFound")<{ id: string }> {}';
const root = (statement: string, declaration = classDeclaration): string =>
  `import { Data, Effect } from "effect"; ${declaration} ${statement}`;
const rootYield = (
  expression = 'Effect.fail(new NotFound({ id }))',
  declaration = classDeclaration,
): string => root(`Effect.gen(function* () { return yield* ${expression}; });`, declaration);
const isNode = (value: unknown): value is { type: string } =>
  Boolean(
    value && typeof value === 'object' && typeof (value as { type?: unknown }).type === 'string',
  );
const registeredRule = (): SourceRule => {
  const rule: unknown = Reflect.get(plugin.rules, RULE_NAME);
  expect(rule, `${RULE_NAME} must be registered`).toBeDefined();
  return rule as SourceRule;
};
const reportsForRule = (source: string) => {
  registeredRule();
  return runRule(RULE_NAME, source);
};

const visitorKeysFor = (source: string): string[] =>
  Object.keys(
    registeredRule().create({
      report(): void {},
      sourceCode: { text: source },
    }),
  ).sort();

const traverse = (node: unknown, visitors: VisitorMap): void => {
  if (!isNode(node)) {
    return;
  }
  if (node.type !== 'Program') {
    visitors[node.type]?.(node);
  }
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) {
      for (const child of value) {
        traverse(child, visitors);
      }
    } else {
      traverse(value, visitors);
    }
  }
};

const reportDescriptorsForRule = (source: string): ReportDescriptor[] => {
  const reports: ReportDescriptor[] = [];
  const visitors = registeredRule().create({
    report(descriptor): void {
      reports.push(descriptor);
    },
    sourceCode: { text: source },
  });
  const program = parseSync('src/domain/error.ts', source, { sourceType: 'module' }).program;

  visitors.Program(program as object);
  traverse(program, visitors);
  return reports;
};

const positiveCases = [
  ['a v3 root Effect.gen callback', rootYield()],
  [
    'a v3 root Effect.gen self callback',
    root(
      'Effect.gen({ self: Service }, function* () { return yield* Effect.fail(new NotFound({ id })); });',
    ),
  ],
  [
    'a v4 root Effect.fn callback',
    root(
      'const load = Effect.fn(function* () { return yield* Effect.fail(new NotFound({ id })); });',
    ),
  ],
  [
    'a v4 root Effect.fnUntraced callback',
    root(
      'const load = Effect.fnUntraced(function* () { return yield* Effect.fail(new NotFound({ id })); });',
    ),
  ],
  [
    'effect subpath namespace imports',
    'import * as Fx from "effect/Effect"; import * as D from "effect/Data"; class NotFound extends D.TaggedError("NotFound")<{ id: string }> {} Fx.gen(function* () { return yield* Fx.fail(new NotFound({ id })); });',
  ],
  [
    'aliased named subpath imports',
    'import { fail as raise, fn as makeFn } from "effect/Effect"; import { TaggedError as Tagged } from "effect/Data"; class NotFound extends Tagged("NotFound")<{ id: string }> {} makeFn(function* () { return yield* raise(new NotFound({ id })); });',
  ],
  [
    'a root package namespace chain',
    'import * as Root from "effect"; class NotFound extends Root.Data.TaggedError("NotFound")<{ id: string }> {} Root.Effect.fnUntraced(function* () { return yield* Root.Effect.fail(new NotFound({ id })); });',
  ],
  [
    'root named aliases',
    'import { Data as D, Effect as Fx } from "effect"; class NotFound extends D.TaggedError("NotFound")<{ id: string }> {} Fx.gen(function* () { return yield* Fx.fail(new NotFound(payload())); });',
  ],
  [
    'an arbitrary object constructor payload',
    rootYield('Effect.fail(new NotFound({ id, cause }))'),
  ],
  [
    'an arbitrary member constructor payload',
    rootYield('Effect.fail(new NotFound(request.error))'),
  ],
  [
    'an exported top-level tagged class',
    rootYield(
      'Effect.fail(new NotFound({ id }))',
      'export class NotFound extends Data.TaggedError("NotFound")<{ id: string }> {}',
    ),
  ],
  [
    'a zero-argument VoidIfEmpty tagged class',
    rootYield(
      'Effect.fail(new NotFound())',
      'class NotFound extends Data.TaggedError("NotFound")<{}> {}',
    ),
  ],
  [
    'a tagged class with a differing tag',
    rootYield(
      'Effect.fail(new NotFound({ id }))',
      'class NotFound extends Data.TaggedError("MissingResource")<{ id: string }> {}',
    ),
  ],
  [
    'a Data.Error class',
    rootYield('Effect.fail(new NotFound({ id }))', 'class NotFound extends Data.Error {}'),
  ],
  [
    'an aliased effect/Data Error class',
    'import { Effect } from "effect"; import { Error as DataError } from "effect/Data"; class NotFound extends DataError {} Effect.gen(function* () { return yield* Effect.fail(new NotFound({ id })); });',
  ],
  [
    'a root Schema.TaggedError class',
    'import { Effect, Schema } from "effect"; class NotFound extends Schema.TaggedError<NotFound>("NotFound")("NotFound", { id: Schema.String }) {} Effect.gen(function* () { return yield* Effect.fail(new NotFound({ id })); });',
  ],
  [
    'an aliased effect/Schema TaggedError class',
    'import { Effect } from "effect"; import { TaggedError as SchemaTaggedError, String } from "effect/Schema"; class NotFound extends SchemaTaggedError<NotFound>("NotFound")("NotFound", { id: String }) {} Effect.gen(function* () { return yield* Effect.fail(new NotFound({ id })); });',
  ],
] as const;

const negativeCases = [
  [
    'no imports',
    `${classDeclaration} Effect.gen(function* () { return yield* Effect.fail(new NotFound({})); });`,
  ],
  [
    'a foreign root import',
    `import { Data, Effect } from "local-effect"; ${classDeclaration} Effect.gen(function* () { return yield* Effect.fail(new NotFound({})); });`,
  ],
  [
    'a foreign Effect subpath import',
    `import * as Effect from "local-effect/Effect"; import { Data } from "effect"; ${classDeclaration} Effect.gen(function* () { return yield* Effect.fail(new NotFound({})); });`,
  ],
  [
    'a foreign Data subpath import',
    'import { Effect } from "effect"; import * as Data from "local-effect/Data"; class NotFound extends Data.TaggedError("NotFound")<{}> {} Effect.gen(function* () { return yield* Effect.fail(new NotFound({})); });',
  ],
  [
    'a type-only Effect import',
    `import { Data } from "effect"; import type { Effect } from "effect"; ${classDeclaration} Effect.gen(function* () { return yield* Effect.fail(new NotFound({})); });`,
  ],
  [
    'a type-only Data import',
    'import { Effect } from "effect"; import type { Data } from "effect"; class NotFound extends Data.TaggedError("NotFound")<{}> {} Effect.gen(function* () { return yield* Effect.fail(new NotFound({})); });',
  ],
  [
    'a local barrel import',
    `import { Data, Effect } from "./effect"; ${classDeclaration} Effect.gen(function* () { return yield* Effect.fail(new NotFound({})); });`,
  ],
  [
    'a CommonJS lookalike',
    `const { Data, Effect } = require("effect"); ${classDeclaration} Effect.gen(function* () { return yield* Effect.fail(new NotFound({})); });`,
  ],
  [
    'a dynamic import lookalike',
    `const { Data, Effect } = await import("effect"); ${classDeclaration} Effect.gen(function* () { return yield* Effect.fail(new NotFound({})); });`,
  ],
  [
    'a direct Root.fail lookalike',
    'import * as Root from "effect"; class NotFound extends Root.Data.TaggedError("NotFound")<{}> {} Root.Effect.gen(function* () { return yield* Root.fail(new NotFound({})); });',
  ],
  [
    'a direct Root.gen lookalike',
    'import * as Root from "effect"; class NotFound extends Root.Data.TaggedError("NotFound")<{}> {} Root.gen(function* () { return yield* Root.Effect.fail(new NotFound({})); });',
  ],
  [
    'a direct Root.fn lookalike',
    'import * as Root from "effect"; class NotFound extends Root.Data.TaggedError("NotFound")<{}> {} Root.fn(function* () { return yield* Root.Effect.fail(new NotFound({})); });',
  ],
  [
    'a direct Root.TaggedError lookalike',
    'import * as Root from "effect"; class NotFound extends Root.TaggedError("NotFound")<{}> {} Root.Effect.gen(function* () { return yield* Root.Effect.fail(new NotFound({})); });',
  ],
  [
    'a parameter shadowing Effect',
    root(
      'const local = (Effect) => Effect.gen(function* () { return yield* Effect.fail(new NotFound({})); });',
    ),
  ],
  [
    'a parameter shadowing a named fail import',
    'import { gen, fail } from "effect/Effect"; import { TaggedError } from "effect/Data"; class NotFound extends TaggedError("NotFound")<{}> {} const local = (fail) => gen(function* () { return yield* fail(new NotFound({})); });',
  ],
  [
    'a parameter shadowing a root package namespace',
    'import * as Root from "effect"; class NotFound extends Root.Data.TaggedError("NotFound")<{}> {} const local = (Root) => Root.Effect.gen(function* () { return yield* Root.Effect.fail(new NotFound({})); });',
  ],
  [
    'an explicit constructor',
    rootYield(
      'Effect.fail(new NotFound({}))',
      'class NotFound extends Data.TaggedError("NotFound")<{}> { constructor() { super({}); } }',
    ),
  ],
  [
    'a decorated class',
    rootYield(
      'Effect.fail(new NotFound({}))',
      '@sealed class NotFound extends Data.TaggedError("NotFound")<{}> {}',
    ),
  ],
  [
    'a class without an extends clause',
    rootYield('Effect.fail(new NotFound({}))', 'class NotFound {}'),
  ],
  [
    'a computed TaggedError callee',
    rootYield(
      'Effect.fail(new NotFound({}))',
      'class NotFound extends Data["TaggedError"]("NotFound")<{}> {}',
    ),
  ],
  [
    'a generic TaggedError call',
    rootYield(
      'Effect.fail(new NotFound({}))',
      'class NotFound extends Data.TaggedError<NotFound>("NotFound")<{}> {}',
    ),
  ],
  [
    'a two-argument TaggedError call',
    rootYield(
      'Effect.fail(new NotFound({}))',
      'class NotFound extends Data.TaggedError("NotFound", options)<{}> {}',
    ),
  ],
  [
    'an incomplete Schema.TaggedError factory',
    rootYield(
      'Effect.fail(new NotFound({}))',
      'class NotFound extends Schema.TaggedError("NotFound")<{}> {}',
    ),
  ],
  ['ordinary Error', rootYield('Effect.fail(new NotFound({}))', 'class NotFound extends Error {}')],
  [
    'a class expression',
    'import { Data, Effect } from "effect"; const NotFound = class extends Data.TaggedError("NotFound")<{}> {}; Effect.gen(function* () { return yield* Effect.fail(new NotFound({})); });',
  ],
  [
    'a const class alias',
    'import { Data, Effect } from "effect"; class NotFound extends Data.TaggedError("NotFound")<{}> {} const LocalError = NotFound; Effect.gen(function* () { return yield* Effect.fail(new LocalError({})); });',
  ],
  [
    'an imported error class',
    'import { Data, Effect } from "effect"; import { NotFound } from "./errors"; Effect.gen(function* () { return yield* Effect.fail(new NotFound({})); });',
  ],
  [
    'a parameter shadowing the class binding',
    root(
      'const local = (NotFound) => Effect.gen(function* () { return yield* Effect.fail(new NotFound({})); });',
    ),
  ],
  [
    'a class binding declared inside the generator host',
    root(
      'Effect.gen(function* () { class NotFound extends Data.TaggedError("NotFound")<{}> {} return yield* Effect.fail(new NotFound({})); });',
    ),
  ],
  [
    'an obvious class reassignment',
    root(
      'NotFound = OtherError; Effect.gen(function* () { return yield* Effect.fail(new NotFound({})); });',
    ),
  ],
  [
    'an obvious class update',
    root('NotFound++; Effect.gen(function* () { return yield* Effect.fail(new NotFound({})); });'),
  ],
  [
    'an obvious class prototype mutation',
    root(
      'NotFound.prototype.code = "not-found"; Effect.gen(function* () { return yield* Effect.fail(new NotFound({})); });',
    ),
  ],
  [
    'outside an Effect host',
    root('function* local() { return yield* Effect.fail(new NotFound({})); }'),
  ],
  [
    'a referenced gen callback',
    root(
      'const callback = function* () { return yield* Effect.fail(new NotFound({})); }; Effect.gen(callback);',
    ),
  ],
  ['an arrow gen callback', root('Effect.gen(() => Effect.fail(new NotFound({})));')],
  [
    'a gen callback with the wrong first argument',
    root('Effect.gen(service, function* () { return yield* Effect.fail(new NotFound({})); });'),
  ],
  [
    'malformed gen self options',
    root(
      'Effect.gen({ get self() { return Service; } }, function* () { yield* Effect.fail(new NotFound({})); });' +
        'Effect.gen({ [self]: Service }, function* () { yield* Effect.fail(new NotFound({})); });' +
        'Effect.gen({ self() {} }, function* () { yield* Effect.fail(new NotFound({})); });' +
        'Effect.gen({ self }, function* () { yield* Effect.fail(new NotFound({})); });' +
        'Effect.gen({ service: Service }, function* () { yield* Effect.fail(new NotFound({})); });' +
        'Effect.gen({ self: Service, extra: true }, function* () { yield* Effect.fail(new NotFound({})); });',
    ),
  ],
  [
    'a generic gen call',
    root('Effect.gen<void>(function* () { return yield* Effect.fail(new NotFound({})); });'),
  ],
  [
    'an optional gen call',
    root('Effect.gen?.(function* () { return yield* Effect.fail(new NotFound({})); });'),
  ],
  [
    'a computed gen callee',
    root('Effect["gen"](function* () { return yield* Effect.fail(new NotFound({})); });'),
  ],
  [
    'a wrapped gen callee',
    root('(Effect.gen)(function* () { return yield* Effect.fail(new NotFound({})); });'),
  ],
  [
    'a spread gen callback',
    root('Effect.gen(...[function* () { return yield* Effect.fail(new NotFound({})); }]);'),
  ],
  [
    'named and curried fn forms',
    root(
      'Effect.fn("load")(function* () { return yield* Effect.fail(new NotFound({})); });' +
        'Effect.fn()(function* () { return yield* Effect.fail(new NotFound({})); });',
    ),
  ],
  [
    'generic and optional fn calls',
    root(
      'Effect.fn<void>(function* () { return yield* Effect.fail(new NotFound({})); });' +
        'Effect.fn?.(function* () { return yield* Effect.fail(new NotFound({})); });',
    ),
  ],
  [
    'nested ordinary functions',
    root(
      'Effect.gen(function* () { function* nested() { return yield* Effect.fail(new NotFound({})); } return nested; });' +
        'Effect.gen(function* () { function nested() { return Effect.fail(new NotFound({})); } return nested(); });',
    ),
  ],
  [
    'a non-delegated yield',
    root('Effect.gen(function* () { yield Effect.fail(new NotFound({})); });'),
  ],
  [
    'a returned fail expression',
    root('Effect.gen(function* () { return Effect.fail(new NotFound({})); });'),
  ],
  [
    'a parenthesized fail expression',
    root('Effect.gen(function* () { return yield* (Effect.fail(new NotFound({}))); });'),
  ],
  ['a zero-argument fail call', root('Effect.gen(function* () { return yield* Effect.fail(); });')],
  [
    'a two-argument fail call',
    root('Effect.gen(function* () { return yield* Effect.fail(new NotFound({}), options); });'),
  ],
  [
    'a spread fail argument',
    root('Effect.gen(function* () { return yield* Effect.fail(...errors); });'),
  ],
  [
    'an optional fail call',
    root('Effect.gen(function* () { return yield* Effect.fail?.(new NotFound({})); });'),
  ],
  [
    'a computed fail callee',
    root('Effect.gen(function* () { return yield* Effect["fail"](new NotFound({})); });'),
  ],
  [
    'a generic fail call',
    root('Effect.gen(function* () { return yield* Effect.fail<NotFound>(new NotFound({})); });'),
  ],
  [
    'an asserted fail callee',
    root(
      'Effect.gen(function* () { return yield* (Effect.fail as typeof Effect.fail)(new NotFound({})); });',
    ),
  ],
  [
    'a non-null fail callee',
    root('Effect.gen(function* () { return yield* Effect.fail!(new NotFound({})); });'),
  ],
  [
    'a fail argument without new',
    root('Effect.gen(function* () { return yield* Effect.fail(NotFound); });'),
  ],
  [
    'an ineligible different new class',
    root(
      'class OtherError extends Error {} Effect.gen(function* () { return yield* Effect.fail(new OtherError({})); });',
    ),
  ],
  [
    'a wrapped new target',
    root(
      'Effect.gen(function* () { return yield* Effect.fail(new (NotFound as typeof NotFound)({})); });',
    ),
  ],
  ['a generic new target', rootYield('Effect.fail(new NotFound<{}>({}))')],
] as const;

describe('effect-prefer-yieldable-error-over-fail', (): void => {
  it('is registered as a report-only problem and enabled as a default error', (): void => {
    const rule = registeredRule();

    expect(rule.meta?.type).toBe('problem');
    expect(theThracianOxlint().rules).toHaveProperty(`thethracian/${RULE_NAME}`, 'error');
  });

  it.each([
    ['effect', 'yield fail Error new'],
    ['yield', 'effect fail Error new'],
    ['fail', 'effect yield Error new'],
    ['Error', 'effect yield fail new'],
    ['new', 'effect yield fail Error'],
  ])('keeps only Program when the source is missing %s', (_token, source): void => {
    expect(visitorKeysFor(source)).toStrictEqual(['Program']);
  });

  it('enables delegated-yield analysis when every candidate token starts at offset zero', (): void => {
    expect(visitorKeysFor('effect yield fail Error new')).toStrictEqual([
      'Program',
      'YieldExpression',
    ]);
  });

  it.each(positiveCases)('reports %s', (_name, source): void => {
    expect(reportsForRule(source)).toHaveLength(1);
  });

  it('reports every independent delegated failure', (): void => {
    expect(
      reportsForRule(
        root(
          'Effect.gen(function* () { yield* Effect.fail(new NotFound(first)); return yield* Effect.fail(new NotFound(second)); });',
        ),
      ),
    ).toHaveLength(2);
  });

  it('publishes the frozen diagnostic without a fix or suggestions', (): void => {
    const [report] = reportDescriptorsForRule(rootYield());

    expect(report?.message).toBe(EXPECTED_MESSAGE);
    expect(Reflect.get(report ?? {}, 'fix')).toBeUndefined();
    expect(Reflect.get(report ?? {}, 'suggest')).toBeUndefined();
    expect(Reflect.get(report ?? {}, 'suggestions')).toBeUndefined();
  });

  it.each([
    ['a namespace fail member', rootYield(), 'Effect.fail'],
    [
      'a named fail alias',
      'import { fail as raise, gen } from "effect/Effect"; import { TaggedError } from "effect/Data"; class NotFound extends TaggedError("NotFound")<{}> {} gen(function* () { return yield* raise(new NotFound({})); });',
      'raise',
    ],
  ])('reports the exact fail callee for %s', (_name, source, expected): void => {
    const [report] = reportsForRule(source);
    const node = report?.node as { end?: number; start?: number } | undefined;

    expect(source.slice(node?.start, node?.end)).toBe(expected);
  });

  it.each(negativeCases)('does not report %s', (_name, source): void => {
    expect(reportsForRule(source)).toHaveLength(0);
  });
});
