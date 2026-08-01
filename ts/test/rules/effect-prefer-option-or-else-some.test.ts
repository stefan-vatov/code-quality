import { describe, expect, it } from 'vitest';
import type { SourceRule } from '../../src/rules/effect-rule-core';
import plugin from '../../src/rules/plugin';
import { runRule } from './effect-rule-test-utils';
import theThracianOxlint from '../../src/index';

const RULE_NAME = 'effect-prefer-option-orElseSome';
const EXPECTED_MESSAGE =
  'Option.orElseSome expresses an Option.orElse fallback that always wraps a value in Option.some more directly.\n' +
  'Fix: Replace Option.orElse with Option.orElseSome and return the fallback value directly.\n' +
  'Example:\n```ts\nimport { Option } from "effect"\n\n' +
  'const value = Option.orElseSome(decoded, () => fallback)\n```';

const imported = (statement: string): string => `import { Option } from "effect"; ${statement}`;
const fallback = (value = 'fallback'): string => `() => Option.some(${value})`;
const dataFirst = (callback = fallback()): string =>
  imported(`const value = Option.orElse(decoded, ${callback});`);
const curried = (callback = fallback()): string =>
  imported(`const recover = Option.orElse(${callback});`);
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

describe('effect-prefer-option-orElseSome', (): void => {
  it('is registered as a problem and enabled as an error in the default config', (): void => {
    const rule = registeredRule();

    expect(rule.meta?.type).toBe('problem');
    expect(theThracianOxlint().rules).toHaveProperty(`thethracian/${RULE_NAME}`, 'error');
  });

  it.each([
    'orElse some',
    'effect some',
    'effect orElse',
    'Effect orElse some',
    'effect OrElse some',
    'effect orElse Some',
  ])('keeps only the cheap Program visitor when source %j lacks a gate token', (source): void => {
    expect(visitorKeysFor(source)).toStrictEqual(['Program']);
  });

  it.each(['effect orElse some', 'some orElse effect'])(
    'enables call analysis when every gate token occurs from offset zero in %j',
    (source): void => {
      expect(visitorKeysFor(source)).toStrictEqual(['CallExpression', 'Program']);
    },
  );

  it.each([
    ['the data-first form', dataFirst()],
    ['the standalone curried form', curried()],
    ['the directly applied curried form', imported(`Option.orElse(${fallback()})(decoded);`)],
    ['the pipeable curried form', imported(`decoded.pipe(Option.orElse(${fallback()}));`)],
    ['a call-producing value', dataFirst(fallback('makeFallback()'))],
    ['an object-producing value', dataFirst(fallback('({ value })'))],
    ['a conditional value', dataFirst(fallback('ready ? primary : secondary'))],
    ['an Effect-producing value', dataFirst(fallback('Effect.succeed(value)'))],
    ['an Option-producing value', dataFirst(fallback('Option.some(value)'))],
  ])('reports the exact diagnostic for %s', (_name, source): void => {
    const reports = reportsFor(source);

    expect(reports).toHaveLength(1);
    expect(reports[0]?.message).toBe(EXPECTED_MESSAGE);
  });

  it.each([
    [
      'a root named Option import',
      `import { Option } from "effect"; Option.orElse(decoded, ${fallback()});`,
    ],
    [
      'an aliased root named Option import',
      'import { Option as Maybe } from "effect"; Maybe.orElse(decoded, () => Maybe.some(value));',
    ],
    [
      'an effect/Option namespace import',
      'import * as Maybe from "effect/Option"; Maybe.orElse(decoded, () => Maybe.some(value));',
    ],
    [
      'aliased named effect/Option imports',
      'import { orElse as recover, some as present } from "effect/Option"; recover(decoded, () => present(value));',
    ],
    [
      'unaliased named effect/Option imports',
      'import { orElse, some } from "effect/Option"; orElse(() => some(value));',
    ],
    [
      'the Option export through a root package namespace',
      'import * as Root from "effect"; Root.Option.orElse(decoded, () => Root.Option.some(value));',
    ],
    [
      'a root Option outer call with a named subpath inner call',
      'import { Option } from "effect"; import { some as present } from "effect/Option"; Option.orElse(decoded, () => present(value));',
    ],
    [
      'a named subpath outer call with a root Option inner call',
      'import { Option } from "effect"; import { orElse as recover } from "effect/Option"; recover(() => Option.some(value));',
    ],
    [
      'a root namespace outer call with a subpath namespace inner call',
      'import * as Root from "effect"; import * as Maybe from "effect/Option"; Root.Option.orElse(decoded, () => Maybe.some(value));',
    ],
  ])('recognizes the shared Effect v3/v4 import idiom %s', (_name, source): void => {
    expect(reportsFor(source)).toHaveLength(1);
  });

  it('reports every independent exact specialization', (): void => {
    const source = imported(
      `const first = Option.orElse(one, ${fallback('firstFallback')}); ` +
        `const second = Option.orElse(${fallback('secondFallback')});`,
    );

    expect(reportsFor(source)).toHaveLength(2);
  });

  it('publishes the exact diagnostic without a fix or suggestions', (): void => {
    const [report] = reportsFor(dataFirst());

    expect(report?.message).toBe(EXPECTED_MESSAGE);
    expect(Reflect.get(report ?? {}, 'fix')).toBeUndefined();
    expect(Reflect.get(report ?? {}, 'suggest')).toBeUndefined();
    expect(Reflect.get(report ?? {}, 'suggestions')).toBeUndefined();
  });

  it.each([
    ['the namespace member', dataFirst(), 'Option.orElse', 'MemberExpression'],
    [
      'the named subpath alias',
      'import { orElse as recover, some } from "effect/Option"; recover(decoded, () => some(value));',
      'recover',
      'Identifier',
    ],
  ])('reports %s as the diagnostic location', (_name, source, text, type): void => {
    const [report] = reportsFor(source);
    const node = report?.node as { end?: number; start?: number; type?: string } | undefined;

    expect(node?.type).toBe(type);
    expect(source.slice(node?.start, node?.end)).toBe(text);
  });

  it.each([
    ['no imports', `Option.orElse(decoded, ${fallback()});`],
    [
      'a foreign root import',
      'import { Option } from "local-effect"; Option.orElse(decoded, () => Option.some(value));',
    ],
    [
      'a foreign subpath namespace import',
      'import * as Option from "local-effect/Option"; Option.orElse(decoded, () => Option.some(value));',
    ],
    [
      'foreign named imports',
      'import { orElse, some } from "local-option"; orElse(decoded, () => some(value));',
    ],
    [
      'a type-only root import',
      'import type { Option } from "effect"; Option.orElse(decoded, () => Option.some(value));',
    ],
    [
      'a type-only root specifier',
      'import { type Option } from "effect"; Option.orElse(decoded, () => Option.some(value));',
    ],
    [
      'a type-only subpath namespace',
      'import type * as Option from "effect/Option"; Option.orElse(decoded, () => Option.some(value));',
    ],
    [
      'type-only named subpath imports',
      'import { type orElse, type some } from "effect/Option"; orElse(decoded, () => some(value));',
    ],
    [
      'another root export aliased as Option',
      'import { Chunk as Option } from "effect"; Option.orElse(decoded, () => Option.some(value));',
    ],
    [
      'another subpath export aliased as orElse',
      'import { map as orElse, some } from "effect/Option"; orElse(decoded, () => some(value));',
    ],
    [
      'another subpath export aliased as some',
      'import { orElse, none as some } from "effect/Option"; orElse(decoded, () => some(value));',
    ],
    [
      'a default effect/Option import',
      'import Option from "effect/Option"; Option.orElse(decoded, () => Option.some(value));',
    ],
  ])('ignores %s because it lacks authentic Effect Option provenance', (_name, source): void => {
    expect(reportsFor(source)).toHaveLength(0);
  });

  it.each([
    [
      'the root Option binding',
      imported(
        'function recover(Option: LocalOption) { return Option.orElse(decoded, () => Option.some(value)); }',
      ),
    ],
    [
      'the subpath namespace binding',
      'import * as Maybe from "effect/Option"; function recover(Maybe: LocalOption) { return Maybe.orElse(decoded, () => Maybe.some(value)); }',
    ],
    [
      'the named orElse binding',
      'import { orElse as recover, some } from "effect/Option"; function read(recover: LocalOrElse) { return recover(decoded, () => some(value)); }',
    ],
    [
      'the named some binding',
      'import { orElse, some } from "effect/Option"; function read(some: LocalSome) { return orElse(decoded, () => some(value)); }',
    ],
    [
      'the root package namespace binding',
      'import * as Root from "effect"; function read(Root: LocalRoot) { return Root.Option.orElse(decoded, () => Root.Option.some(value)); }',
    ],
    [
      'a function-hoisted Option binding',
      imported(
        'function read() { const value = Option.orElse(decoded, () => Option.some(fallback)); var Option = local; return value; }',
      ),
    ],
    [
      'a function-hoisted named some binding',
      'import { orElse, some } from "effect/Option"; function read() { const value = orElse(decoded, () => some(fallback)); var some = local; return value; }',
    ],
  ])('respects lexical shadowing of %s', (_name, source): void => {
    expect(reportsFor(source)).toHaveLength(0);
  });

  it.each([
    [
      'a direct root-package orElse call',
      'import * as Root from "effect"; Root.orElse(decoded, () => Root.Option.some(value));',
    ],
    [
      'a direct root-package some call',
      'import * as Root from "effect"; Root.Option.orElse(decoded, () => Root.some(value));',
    ],
    [
      'a direct named orElse import from the root package',
      'import { orElse, Option } from "effect"; orElse(decoded, () => Option.some(value));',
    ],
    [
      'a direct named some import from the root package',
      'import { Option, some } from "effect"; Option.orElse(decoded, () => some(value));',
    ],
    [
      'an Option-like property below the root namespace',
      'import * as Root from "effect"; Root.Local.Option.orElse(decoded, () => Root.Option.some(value));',
    ],
  ])('rejects invalid root package shape %s', (_name, source): void => {
    expect(reportsFor(source)).toHaveLength(0);
  });

  it.each([
    ['a zero-argument outer call', imported('Option.orElse();')],
    ['an option-only outer call', imported('Option.orElse(decoded);')],
    ['an extra data-first argument', imported(`Option.orElse(decoded, ${fallback()}, extra);`)],
    ['an empty curried application', imported('Option.orElse() (decoded);')],
    ['an extra curried-head argument', imported(`Option.orElse(${fallback()}, extra);`)],
    ['a spread-only outer call', imported('Option.orElse(...args);')],
    ['a spread data argument', imported(`Option.orElse(...options, ${fallback()});`)],
    ['a spread fallback argument', imported('Option.orElse(decoded, ...fallbacks);')],
    ['outer type arguments', imported(`Option.orElse<Value>(decoded, ${fallback()});`)],
    ['a computed outer member', imported(`Option["orElse"](decoded, ${fallback()});`)],
    ['an optional outer member', imported(`Option?.orElse(decoded, ${fallback()});`)],
    ['an optional outer call', imported(`Option.orElse?.(decoded, ${fallback()});`)],
    ['a parenthesized outer callee', imported(`(Option.orElse)(decoded, ${fallback()});`)],
    [
      'an asserted outer callee',
      imported(`(Option.orElse as typeof Option.orElse)(decoded, ${fallback()});`),
    ],
    ['a non-null outer callee', imported(`Option.orElse!(decoded, ${fallback()});`)],
  ])('rejects unsupported Option.orElse call grammar: %s', (_name, source): void => {
    expect(reportsFor(source)).toHaveLength(0);
  });

  it.each([
    ['one parameter', 'unused => Option.some(fallback)'],
    ['a parenthesized parameter', '(unused) => Option.some(fallback)'],
    ['a destructured parameter', '({ unused }) => Option.some(fallback)'],
    ['a default parameter', '(unused = fallback) => Option.some(unused)'],
    ['a rest parameter', '(...unused) => Option.some(unused[0])'],
    ['a typed parameter', '(unused: unknown) => Option.some(fallback)'],
    ['an optional parameter', '(unused?: unknown) => Option.some(fallback)'],
    ['an explicit return type', '(): Option.Option<Value> => Option.some(fallback)'],
    ['a generic arrow', '<Value>() => Option.some(fallback)'],
    ['an async arrow', 'async () => Option.some(fallback)'],
    ['a block-bodied arrow', '() => { return Option.some(fallback); }'],
    ['an ordinary function', 'function () { return Option.some(fallback); }'],
    ['a generator function', 'function* () { return Option.some(fallback); }'],
    ['an async function', 'async function () { return Option.some(fallback); }'],
    ['an async generator', 'async function* () { return Option.some(fallback); }'],
    ['a referenced callback', 'makeFallback'],
    ['a call-produced callback', 'makeFallback()'],
    ['an asserted arrow', '(() => Option.some(fallback)) as () => Option.Option<Value>'],
    ['a non-null arrow', '(() => Option.some(fallback))!'],
  ])('rejects callback shape %s', (_name, callback): void => {
    expect(reportsFor(dataFirst(callback))).toHaveLength(0);
  });

  it.each([
    ['a zero-argument some call', '() => Option.some()'],
    ['an extra some argument', '() => Option.some(value, extra)'],
    ['a spread-only some call', '() => Option.some(...values)'],
    ['explicit some type arguments', '() => Option.some<Value>(value)'],
    ['a computed some member', '() => Option["some"](value)'],
    ['an optional Option member', '() => Option?.some(value)'],
    ['an optional some call', '() => Option.some?.(value)'],
    ['a parenthesized some callee', '() => (Option.some)(value)'],
    ['an asserted some callee', '() => (Option.some as typeof Option.some)(value)'],
    ['a non-null some callee', '() => Option.some!(value)'],
    ['a parenthesized some call', '() => (Option.some(value))'],
    ['an asserted some call', '() => Option.some(value) as Option.Option<Value>'],
    ['a satisfies-wrapped some call', '() => Option.some(value) satisfies Option.Option<Value>'],
    ['a non-null some call', '() => Option.some(value)!'],
  ])('rejects unsupported Option.some call grammar: %s', (_name, callback): void => {
    expect(reportsFor(dataFirst(callback))).toHaveLength(0);
  });

  it.each([
    [
      'canonical data-first Option.orElseSome',
      imported('Option.orElseSome(decoded, () => fallback);'),
    ],
    [
      'canonical curried Option.orElseSome',
      imported('decoded.pipe(Option.orElseSome(() => fallback));'),
    ],
    ['an Option.none fallback', dataFirst('() => Option.none()')],
    ['an Option.fromNullable fallback', dataFirst('() => Option.fromNullable(fallback)')],
    ['a bare Option.some reference', dataFirst('() => Option.some')],
    ['a non-Option expression', dataFirst('() => fallback')],
    ['a local namespace some', dataFirst('() => LocalOption.some(fallback)')],
    [
      'an imported non-Option some',
      'import { Option } from "effect"; import { some } from "local-option"; Option.orElse(decoded, () => some(fallback));',
    ],
    [
      'an official some inside a local orElse call',
      'import { Option } from "effect"; LocalOption.orElse(decoded, () => Option.some(fallback));',
    ],
    [
      'a locally aliased outer call',
      imported('const recover = Option.orElse; recover(decoded, () => Option.some(fallback));'),
    ],
    [
      'a locally aliased inner call',
      imported('const present = Option.some; Option.orElse(decoded, () => present(fallback));'),
    ],
  ])('accepts canonical or unrelated form %s', (_name, source): void => {
    expect(reportsFor(source)).toHaveLength(0);
  });
});
