import { describe, expect, it } from 'vitest';
import type { SourceRule } from '../../src/rules/effect-rule-core';
import plugin from '../../src/rules/plugin';
import { runRule } from './effect-rule-test-utils';
import theThracianOxlint from '../../src/index';

const RULE_NAME = 'effect-prefer-option-getOrElse';
const EXPECTED_MESSAGE =
  'Option.getOrElse expresses an Option.match whose onSome branch returns its argument more directly.\n' +
  'Fix: Replace Option.match with Option.getOrElse and keep the onNone fallback.\n' +
  'Example:\n```ts\nimport { Option } from "effect"\n\n' +
  'const value = Option.getOrElse(decoded, () => fallback)\n```';

const imported = (statement: string): string => `import { Option } from "effect"; ${statement}`;
const handlers = (onNone = '() => fallback', onSome = 'value => value'): string =>
  `{ onNone: ${onNone}, onSome: ${onSome} }`;
const candidate = (option = 'decoded', cases = handlers()): string =>
  imported(`const value = Option.match(${option}, ${cases});`);
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

describe('effect-prefer-option-getOrElse', (): void => {
  it('is registered as a problem and enabled as an error in the default config', (): void => {
    const rule = registeredRule();

    expect(rule.meta?.type).toBe('problem');
    expect(theThracianOxlint().rules).toHaveProperty(`thethracian/${RULE_NAME}`, 'error');
  });

  it.each([
    'match onNone onSome',
    'effect onNone onSome',
    'effect match onSome',
    'effect match onNone',
    'Effect match onNone onSome',
  ])('keeps only the cheap Program visitor when source %j lacks a gate token', (source): void => {
    expect(visitorKeysFor(source)).toStrictEqual(['Program']);
  });

  it.each(['effect match onNone onSome', 'onSome onNone match effect'])(
    'enables call analysis when every gate token occurs from offset zero in %j',
    (source): void => {
      expect(visitorKeysFor(source)).toStrictEqual(['CallExpression', 'Program']);
    },
  );

  it.each([
    ['the data-first form', candidate()],
    ['a call-producing fallback', candidate(undefined, handlers('() => makeFallback()'))],
    ['an object-producing fallback', candidate(undefined, handlers('() => ({ fallback })'))],
    ['a conditional fallback', candidate(undefined, handlers('() => ready ? primary : secondary'))],
    [
      'an Effect-producing fallback',
      candidate(undefined, handlers('() => Effect.succeed(fallback)')),
    ],
    [
      'reversed handler order',
      candidate(undefined, '{ onSome: value => value, onNone: () => fallback }'),
    ],
    [
      'a differently named identity',
      candidate(undefined, handlers('() => fallback', 'item => item')),
    ],
  ])('reports the exact diagnostic for %s', (_name, source): void => {
    const reports = reportsFor(source);

    expect(reports).toHaveLength(1);
    expect(reports[0]?.message).toBe(EXPECTED_MESSAGE);
  });

  it.each([
    [
      'a root named Option import',
      `import { Option } from "effect"; Option.match(decoded, ${handlers()});`,
    ],
    [
      'an aliased root named Option import',
      `import { Option as Maybe } from "effect"; Maybe.match(decoded, ${handlers()});`,
    ],
    [
      'an effect/Option namespace import',
      `import * as Maybe from "effect/Option"; Maybe.match(decoded, ${handlers()});`,
    ],
    [
      'an aliased named effect/Option match import',
      `import { match as fold } from "effect/Option"; fold(decoded, ${handlers()});`,
    ],
    [
      'an unaliased named effect/Option match import',
      `import { match } from "effect/Option"; match(decoded, ${handlers()});`,
    ],
    [
      'the Option export through a root package namespace',
      `import * as Root from "effect"; Root.Option.match(decoded, ${handlers()});`,
    ],
  ])('recognizes the shared Effect v3/v4 import idiom %s', (_name, source): void => {
    expect(reportsFor(source)).toHaveLength(1);
  });

  it('reports every independent exact match specialization', (): void => {
    const source = imported(
      `const first = Option.match(one, ${handlers()}); ` +
        `const second = Option.match(two, ${handlers('() => other')});`,
    );

    expect(reportsFor(source)).toHaveLength(2);
  });

  it('publishes the exact diagnostic without a fix or suggestions', (): void => {
    const [report] = reportsFor(candidate());

    expect(report?.message).toBe(EXPECTED_MESSAGE);
    expect(Reflect.get(report ?? {}, 'fix')).toBeUndefined();
    expect(Reflect.get(report ?? {}, 'suggest')).toBeUndefined();
    expect(Reflect.get(report ?? {}, 'suggestions')).toBeUndefined();
  });

  it('reports the Option.match callee as the diagnostic location', (): void => {
    const source = candidate();
    const [report] = reportsFor(source);
    const node = report?.node as { end?: number; start?: number; type?: string } | undefined;

    expect(node?.type).toBe('MemberExpression');
    expect(source.slice(node?.start, node?.end)).toBe('Option.match');
  });

  it.each([
    ['no import', `Option.match(decoded, ${handlers()});`],
    [
      'a foreign root import',
      `import { Option } from "local-effect"; Option.match(decoded, ${handlers()});`,
    ],
    [
      'a foreign subpath namespace import',
      `import * as Option from "local-effect/Option"; Option.match(decoded, ${handlers()});`,
    ],
    [
      'a foreign named match import',
      `import { match } from "local-option"; match(decoded, ${handlers()});`,
    ],
    [
      'a type-only root import',
      `import type { Option } from "effect"; Option.match(decoded, ${handlers()});`,
    ],
    [
      'a type-only root specifier',
      `import { type Option } from "effect"; Option.match(decoded, ${handlers()});`,
    ],
    [
      'a type-only effect/Option namespace',
      `import type * as Option from "effect/Option"; Option.match(decoded, ${handlers()});`,
    ],
    [
      'a type-only named effect/Option import',
      `import { type match } from "effect/Option"; match(decoded, ${handlers()});`,
    ],
    [
      'another root export aliased as Option',
      `import { Effect as Option } from "effect"; Option.match(decoded, ${handlers()});`,
    ],
    [
      'another effect/Option export aliased as match',
      `import { map as match } from "effect/Option"; match(decoded, ${handlers()});`,
    ],
    [
      'a default effect/Option import',
      `import Option from "effect/Option"; Option.match(decoded, ${handlers()});`,
    ],
  ])('ignores %s because it lacks authentic Effect Option provenance', (_name, source): void => {
    expect(reportsFor(source)).toHaveLength(0);
  });

  it.each([
    [
      'the root Option binding',
      imported(
        `function read(Option: LocalOption) { return Option.match(decoded, ${handlers()}); }`,
      ),
    ],
    [
      'the effect/Option namespace binding',
      `import * as Maybe from "effect/Option"; function read(Maybe: LocalOption) { return Maybe.match(decoded, ${handlers()}); }`,
    ],
    [
      'the named match binding',
      `import { match as fold } from "effect/Option"; function read(fold: LocalMatch) { return fold(decoded, ${handlers()}); }`,
    ],
    [
      'the root package namespace binding',
      `import * as Root from "effect"; function read(Root: LocalRoot) { return Root.Option.match(decoded, ${handlers()}); }`,
    ],
    [
      'a function-hoisted Option binding',
      imported(
        `function read() { const value = Option.match(decoded, ${handlers()}); var Option = local; return value; }`,
      ),
    ],
    [
      'a function-hoisted named match binding',
      `import { match as fold } from "effect/Option"; ` +
        `function read() { const value = fold(decoded, ${handlers()}); var fold = local; return value; }`,
    ],
  ])('respects lexical shadowing of %s', (_name, source): void => {
    expect(reportsFor(source)).toHaveLength(0);
  });

  it.each([
    [
      'a direct match call on the root package namespace',
      `import * as Root from "effect"; Root.match(decoded, ${handlers()});`,
    ],
    [
      'a direct named match import from the root package',
      `import { match } from "effect"; match(decoded, ${handlers()});`,
    ],
    [
      'an Option-like property below the root namespace',
      `import * as Root from "effect"; Root.Local.Option.match(decoded, ${handlers()});`,
    ],
  ])('rejects the invalid root package shape %s', (_name, source): void => {
    expect(reportsFor(source)).toHaveLength(0);
  });

  it.each([
    ['a zero-argument match call', imported('Option.match();')],
    ['an option-only match call', imported('Option.match(decoded);')],
    ['a standalone curried matcher', imported(`Option.match(${handlers()});`)],
    ['a directly applied curried matcher', imported(`Option.match(${handlers()})(decoded);`)],
    ['a pipeable curried matcher', imported(`decoded.pipe(Option.match(${handlers()}));`)],
    [
      'a named subpath pipeable matcher',
      `import { match as fold } from "effect/Option"; decoded.pipe(fold(${handlers()}));`,
    ],
    ['an extra data-first argument', imported(`Option.match(decoded, ${handlers()}, extra);`)],
    ['a spread-only match call', imported('Option.match(...args);')],
    ['a spread data-first handler', imported('Option.match(decoded, ...handlers);')],
    ['explicit match type arguments', imported(`Option.match<Value>(decoded, ${handlers()});`)],
    ['a computed match member', imported(`Option["match"](decoded, ${handlers()});`)],
    ['an optional Option member', imported(`Option?.match(decoded, ${handlers()});`)],
    ['an optional match call', imported(`Option.match?.(decoded, ${handlers()});`)],
    ['a parenthesized match callee', imported(`(Option.match)(decoded, ${handlers()});`)],
    [
      'an asserted match callee',
      imported(`(Option.match as typeof Option.match)(decoded, ${handlers()});`),
    ],
    ['a non-null match callee', imported(`Option.match!(decoded, ${handlers()});`)],
    ['a wrapped handlers object', imported(`Option.match(decoded, ${handlers()} as const);`)],
    ['a named handlers object', imported('Option.match(decoded, cases);')],
    ['a call-produced handlers object', imported('Option.match(decoded, makeCases());')],
    ['a reversed curried application', imported(`Option.match(${handlers()}, decoded)(other);`)],
  ])('rejects unsupported match call grammar: %s', (_name, source): void => {
    expect(reportsFor(source)).toHaveLength(0);
  });

  it.each([
    [
      'an additional trailing property',
      '{ onNone: () => fallback, onSome: value => value, trace: true }',
    ],
    [
      'an additional leading property',
      '{ trace: true, onNone: () => fallback, onSome: value => value }',
    ],
    [
      'duplicate onNone properties',
      '{ onNone: () => first, onNone: () => second, onSome: value => value }',
    ],
    [
      'duplicate onSome properties',
      '{ onNone: () => fallback, onSome: value => value, onSome: item => item }',
    ],
    ['a spread property', '{ onNone: () => fallback, ...rest, onSome: value => value }'],
    ['a computed onNone property', '{ ["onNone"]: () => fallback, onSome: value => value }'],
    ['a computed onSome property', '{ onNone: () => fallback, ["onSome"]: value => value }'],
    [
      'an identifier-computed onNone property',
      '{ [onNone]: () => fallback, onSome: value => value }',
    ],
    [
      'an identifier-computed onSome property',
      '{ onNone: () => fallback, [onSome]: value => value }',
    ],
    ['an onNone method', '{ onNone() { return fallback; }, onSome: value => value }'],
    ['an onSome method', '{ onNone: () => fallback, onSome(value) { return value; } }'],
    ['an onNone getter', '{ get onNone() { return () => fallback; }, onSome: value => value }'],
    ['an onSome setter', '{ onNone: () => fallback, set onSome(value) { observe(value); } }'],
    ['shorthand handlers', '{ onNone, onSome }'],
    ['only onNone', '{ onNone: () => fallback }'],
    ['only onSome', '{ onSome: value => value }'],
    ['an empty object', '{}'],
  ])('rejects handler object shape %s', (_name, cases): void => {
    expect(reportsFor(candidate(undefined, cases))).toHaveLength(0);
  });

  it.each([
    ['one parameter', 'unused => fallback'],
    ['a destructured parameter', '({ reason }) => reason'],
    ['a default parameter', '(unused = fallback) => unused'],
    ['a rest parameter', '(...unused) => unused[0]'],
    ['a typed parameter', '(unused: unknown) => fallback'],
    ['an explicit return type', '(): Value => fallback'],
    ['a generic arrow', '<T>() => fallback'],
    ['an async arrow', 'async () => fallback'],
    ['a block-bodied arrow', '() => { return fallback; }'],
    ['an ordinary function', 'function () { return fallback; }'],
    ['a generator function', 'function* () { return fallback; }'],
    ['an async function', 'async function () { return fallback; }'],
    ['an async generator function', 'async function* () { return fallback; }'],
    ['a referenced function', 'onNone'],
    ['a call-produced function', 'makeOnNone()'],
    ['an asserted arrow', '(() => fallback) as () => Value'],
  ])('rejects onNone handler shape %s', (_name, onNone): void => {
    expect(reportsFor(candidate(undefined, handlers(onNone)))).toHaveLength(0);
  });

  it.each([
    ['zero parameters', '() => value'],
    ['two parameters', '(value, index) => value'],
    ['an object-destructured parameter', '({ value }) => value'],
    ['an array-destructured parameter', '([value]) => value'],
    ['a default parameter', '(value = fallback) => value'],
    ['a rest parameter', '(...value) => value'],
    ['a typed parameter', '(value: Value) => value'],
    ['an optional parameter', '(value?: Value) => value'],
    ['an untyped optional parameter', '(value?) => value'],
    ['an explicit return type', '(value): Value => value'],
    ['a generic arrow', '<T>(value) => value'],
    ['an async arrow', 'async value => value'],
    ['a block-bodied arrow', 'value => { return value; }'],
    ['an ordinary function', 'function (value) { return value; }'],
    ['a generator function', 'function* (value) { return value; }'],
    ['an async function', 'async function (value) { return value; }'],
    ['an async generator function', 'async function* (value) { return value; }'],
    ['a referenced function', 'onSome'],
    ['a call-produced function', 'makeOnSome()'],
  ])('rejects onSome handler grammar %s', (_name, onSome): void => {
    expect(reportsFor(candidate(undefined, handlers(undefined, onSome)))).toHaveLength(0);
  });

  it.each([
    ['another identifier', 'value => other'],
    ['a property access', 'value => value.current'],
    ['an optional property access', 'value => value?.current'],
    ['a computed property access', 'value => value["current"]'],
    ['a function call', 'value => normalize(value)'],
    ['a binary expression', 'value => value + 1'],
    ['an object wrapper', 'value => ({ value })'],
    ['an array wrapper', 'value => [value]'],
    ['a conditional expression', 'value => ready ? value : fallback'],
    ['a sequence expression', 'value => (observe(value), value)'],
    ['a type assertion', 'value => value as Value'],
    ['a non-null assertion', 'value => value!'],
    ['a satisfies expression', 'value => value satisfies Value'],
    ['an inner closure', 'value => () => value'],
  ])('preserves Option.match for transformed onSome result %s', (_name, onSome): void => {
    expect(reportsFor(candidate(undefined, handlers(undefined, onSome)))).toHaveLength(0);
  });

  it.each([
    ['data-first Option.getOrElse', imported('Option.getOrElse(decoded, () => fallback);')],
    ['pipeable Option.getOrElse', imported('decoded.pipe(Option.getOrElse(() => fallback));')],
    [
      'named effect/Option getOrElse',
      'import { getOrElse } from "effect/Option"; getOrElse(decoded, () => fallback);',
    ],
    [
      'an effectful onSome handler',
      candidate(undefined, handlers(undefined, 'value => Effect.succeed(value)')),
    ],
    ['a nonidentity match', candidate(undefined, handlers(undefined, 'value => transform(value)'))],
  ])('accepts canonical or unrelated form %s', (_name, source): void => {
    expect(reportsFor(source)).toHaveLength(0);
  });
});
