import { describe, expect, it } from 'vitest';
import type { SourceRule } from '../../src/rules/effect-rule-core';
import plugin from '../../src/rules/plugin';
import { runRule } from './effect-rule-test-utils';
import theThracianOxlint from '../../src/index';

const RULE_NAME = 'effect-prefer-option-nullish-getters';
const EXPECTED_MESSAGE =
  'Use Option.getOrNull or Option.getOrUndefined instead of manually extracting the value from Option.isSome.\n' +
  'Fix: Replace the conditional with the matching Option nullish getter.\n' +
  'Example:\n```ts\nimport { Option } from "effect"\n\n' +
  'const value = Option.getOrUndefined(decoded)\n```';

const imported = (statement: string): string => `import { Option } from "effect"; ${statement}`;
const conditional = (
  test = 'Option.isSome(decoded)',
  consequent = 'decoded.value',
  fallback = 'undefined',
): string => `${test} ? ${consequent} : ${fallback}`;
const localCandidate = (
  expression = conditional(),
  declaration = 'const decoded = decode()',
): string => imported(`${declaration}; const value = ${expression};`);
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

describe('effect-prefer-option-nullish-getters', (): void => {
  it('is registered as a problem and enabled as an error in the default config', (): void => {
    const rule = registeredRule();

    expect(rule.meta?.type).toBe('problem');
    expect(theThracianOxlint().rules).toHaveProperty(`thethracian/${RULE_NAME}`, 'error');
  });

  it.each([
    'isSome null',
    'effect null',
    'effect isSome',
    'effect undefined',
    'effect isSome void',
    'Effect isSome null',
  ])('keeps only the cheap Program visitor when source %j lacks a gate token', (source): void => {
    expect(visitorKeysFor(source)).toStrictEqual(['Program']);
  });

  it.each(['effect isSome null', 'effect isSome undefined'])(
    'enables conditional analysis when every candidate token occurs from offset zero in %j',
    (source): void => {
      expect(visitorKeysFor(source)).toStrictEqual(['ConditionalExpression', 'Program']);
    },
  );

  it.each([
    ['a null fallback', localCandidate(conditional(undefined, undefined, 'null'))],
    ['the global undefined fallback', localCandidate()],
    [
      'a function-local binding',
      imported(
        'function read() { const decoded = decode(); return Option.isSome(decoded) ? decoded.value : undefined; }',
      ),
    ],
    [
      'an enclosing const in the same function',
      imported(
        'function read() { const decoded = decode(); if (ready) { return Option.isSome(decoded) ? decoded.value : null; } return null; }',
      ),
    ],
    [
      'a preceding const in the same switch case',
      imported(
        'function read(kind: string) { switch (kind) { case "hit": const decoded = decode(); return Option.isSome(decoded) ? decoded.value : null; default: return null; } }',
      ),
    ],
  ])('reports the exact diagnostic for %s', (_name, source): void => {
    const reports = reportsFor(source);

    expect(reports).toHaveLength(1);
    expect(reports[0]?.message).toBe(EXPECTED_MESSAGE);
  });

  it.each([
    [
      'a root named Option import',
      'import { Option } from "effect"; const decoded = decode(); Option.isSome(decoded) ? decoded.value : null;',
    ],
    [
      'a root named Option alias',
      'import { Option as Maybe } from "effect"; const decoded = decode(); Maybe.isSome(decoded) ? decoded.value : undefined;',
    ],
    [
      'an effect/Option namespace',
      'import * as Maybe from "effect/Option"; const decoded = decode(); Maybe.isSome(decoded) ? decoded.value : null;',
    ],
    [
      'an aliased named effect/Option isSome import',
      'import { isSome as isPresent } from "effect/Option"; const decoded = decode(); isPresent(decoded) ? decoded.value : undefined;',
    ],
    [
      'an unaliased named effect/Option isSome import',
      'import { isSome } from "effect/Option"; const decoded = decode(); isSome(decoded) ? decoded.value : null;',
    ],
    [
      'the Option export through a root namespace',
      'import * as Root from "effect"; const decoded = decode(); Root.Option.isSome(decoded) ? decoded.value : undefined;',
    ],
  ])('recognizes the Effect v3/v4 import idiom %s', (_name, source): void => {
    expect(reportsFor(source)).toHaveLength(1);
  });

  it('reports every independent exact extraction', (): void => {
    const source = imported(
      'const first = decodeFirst(); const one = Option.isSome(first) ? first.value : null; ' +
        'const second = decodeSecond(); const two = Option.isSome(second) ? second.value : undefined;',
    );

    expect(reportsFor(source)).toHaveLength(2);
  });

  it('publishes the exact diagnostic without an automatic fix', (): void => {
    const [report] = reportsFor(localCandidate());

    expect(report?.message).toBe(EXPECTED_MESSAGE);
    expect(Reflect.get(report ?? {}, 'fix')).toBeUndefined();
  });

  it('reports the isSome callee as the diagnostic location', (): void => {
    const source = localCandidate();
    const [report] = reportsFor(source);
    const node = report?.node as { end?: number; start?: number; type?: string } | undefined;

    expect(node?.type).toBe('MemberExpression');
    expect(source.slice(node?.start, node?.end)).toBe('Option.isSome');
  });

  it.each([
    [
      'a parameter',
      imported(
        'function read(decoded: Option.Option<number>) { return Option.isSome(decoded) ? decoded.value : null; }',
      ),
    ],
    [
      'an imported binding',
      'import { Option } from "effect"; import { decoded } from "./fixture"; Option.isSome(decoded) ? decoded.value : null;',
    ],
    [
      'an ambient global',
      'import { Option } from "effect"; declare const decoded: Option.Option<number>; Option.isSome(decoded) ? decoded.value : undefined;',
    ],
    ['an unresolved global', imported('Option.isSome(decoded) ? decoded.value : null;')],
    ['an initialized let', localCandidate(undefined, 'let decoded = decode()')],
    ['an initialized var', localCandidate(undefined, 'var decoded = decode()')],
    ['an object-destructured const', localCandidate(undefined, 'const { decoded } = source')],
    ['an array-destructured const', localCandidate(undefined, 'const [decoded] = source')],
    [
      'a member expression',
      localCandidate(conditional('Option.isSome(state.decoded)', 'state.decoded.value')),
    ],
    ['a call expression', imported('Option.isSome(decode()) ? decode().value : undefined;')],
    [
      'a declaration after the conditional',
      imported(
        'const value = Option.isSome(decoded) ? decoded.value : null; const decoded = decode();',
      ),
    ],
    [
      'a later declarator in the same const statement',
      imported(
        'const value = Option.isSome(decoded) ? decoded.value : undefined, decoded = decode();',
      ),
    ],
    [
      'a const across a function boundary',
      imported(
        'const decoded = decode(); function read() { return Option.isSome(decoded) ? decoded.value : null; }',
      ),
    ],
    [
      'a const across an arrow boundary',
      imported(
        'function read() { const decoded = decode(); return () => Option.isSome(decoded) ? decoded.value : undefined; }',
      ),
    ],
    [
      'a const from another switch case',
      imported(
        'function read(kind: string) { switch (kind) { case "load": const decoded = decode(); break; case "read": return Option.isSome(decoded) ? decoded.value : null; default: return null; } }',
      ),
    ],
  ])('rejects %s as the tested Option binding', (_name, source): void => {
    expect(reportsFor(source)).toHaveLength(0);
  });

  it.each([
    ['another binding value', localCandidate(conditional(undefined, 'other.value'))],
    ['a different property', localCandidate(conditional(undefined, 'decoded.current'))],
    ['the Option object itself', localCandidate(conditional(undefined, 'decoded'))],
    [
      'a different tested identifier',
      imported(
        'const decoded = decode(); const other = decode(); Option.isSome(decoded) ? other.value : null;',
      ),
    ],
    ['a transformed value', localCandidate(conditional(undefined, 'normalize(decoded.value)'))],
    [
      'a nullish-transformed value',
      localCandidate(conditional(undefined, 'decoded.value ?? fallback')),
    ],
  ])('preserves the conditional for %s', (_name, source): void => {
    expect(reportsFor(source)).toHaveLength(0);
  });

  it.each([
    ['zero', localCandidate(conditional(undefined, undefined, '0'))],
    ['false', localCandidate(conditional(undefined, undefined, 'false'))],
    ['void zero', localCandidate(conditional(undefined, undefined, 'void 0'))],
    ['another identifier', localCandidate(conditional(undefined, undefined, 'fallback'))],
    ['a reversed null branch', localCandidate('Option.isSome(decoded) ? null : decoded.value')],
    [
      'a reversed undefined branch',
      localCandidate('Option.isSome(decoded) ? undefined : decoded.value'),
    ],
    [
      'an additionally guarded test',
      localCandidate('ready && Option.isSome(decoded) ? decoded.value : null'),
    ],
    [
      'a guarded nullish fallback',
      localCandidate('Option.isSome(decoded) ? decoded.value : ready ? null : undefined'),
    ],
  ])('rejects %s as a fallback or branch shape', (_name, source): void => {
    expect(reportsFor(source)).toHaveLength(0);
  });

  it.each([
    [
      'a preceding local undefined binding',
      imported(
        'function read() { const undefined = missing; const decoded = decode(); return Option.isSome(decoded) ? decoded.value : undefined; }',
      ),
    ],
    [
      'an undefined parameter',
      imported(
        'function read(undefined: unknown) { const decoded = decode(); return Option.isSome(decoded) ? decoded.value : undefined; }',
      ),
    ],
    [
      'an imported undefined binding',
      'import { Option } from "effect"; import { missing as undefined } from "./missing"; const decoded = decode(); Option.isSome(decoded) ? decoded.value : undefined;',
    ],
    [
      'a later undefined binding in the same execution context',
      imported(
        'function read() { const decoded = decode(); const value = Option.isSome(decoded) ? decoded.value : undefined; const undefined = missing; return value; }',
      ),
    ],
    [
      'globalThis.undefined',
      localCandidate(conditional(undefined, undefined, 'globalThis.undefined')),
    ],
  ])('does not treat %s as the global undefined value', (_name, source): void => {
    expect(reportsFor(source)).toHaveLength(0);
  });

  it.each([
    ['no import', 'const decoded = decode(); Option.isSome(decoded) ? decoded.value : null;'],
    [
      'a foreign root import',
      'import { Option } from "local-effect"; const decoded = decode(); Option.isSome(decoded) ? decoded.value : undefined;',
    ],
    [
      'a type-only root import',
      'import type { Option } from "effect"; const decoded = decode(); Option.isSome(decoded) ? decoded.value : null;',
    ],
    [
      'a type-only root specifier',
      'import { type Option } from "effect"; const decoded = decode(); Option.isSome(decoded) ? decoded.value : undefined;',
    ],
    [
      'a type-only effect/Option namespace',
      'import type * as Maybe from "effect/Option"; const decoded = decode(); Maybe.isSome(decoded) ? decoded.value : null;',
    ],
    [
      'a type-only named effect/Option import',
      'import { type isSome } from "effect/Option"; const decoded = decode(); isSome(decoded) ? decoded.value : undefined;',
    ],
    [
      'a foreign named isSome import',
      'import { isSome } from "local-option"; const decoded = decode(); isSome(decoded) ? decoded.value : null;',
    ],
    [
      'another root export aliased as Option',
      'import { Chunk as Option } from "effect"; const decoded = decode(); Option.isSome(decoded) ? decoded.value : undefined;',
    ],
    [
      'another effect/Option export aliased as isSome',
      'import { isNone as isSome } from "effect/Option"; const decoded = decode(); isSome(decoded) ? decoded.value : null;',
    ],
    [
      'a direct root isSome import',
      'import { isSome } from "effect"; const decoded = decode(); isSome(decoded) ? decoded.value : undefined;',
    ],
    [
      'Root.isSome without the Option export',
      'import * as Root from "effect"; const decoded = decode(); Root.isSome(decoded) ? decoded.value : null;',
    ],
  ])('ignores %s', (_name, source): void => {
    expect(reportsFor(source)).toHaveLength(0);
  });

  it.each([
    [
      'the root Option binding',
      imported(
        'function read(Option: LocalOption) { const decoded = decode(); return Option.isSome(decoded) ? decoded.value : null; }',
      ),
    ],
    [
      'the effect/Option namespace binding',
      'import * as Maybe from "effect/Option"; function read(Maybe: LocalOption) { const decoded = decode(); return Maybe.isSome(decoded) ? decoded.value : undefined; }',
    ],
    [
      'the named isSome binding',
      'import { isSome as present } from "effect/Option"; function read(present: LocalPredicate) { const decoded = decode(); return present(decoded) ? decoded.value : null; }',
    ],
    [
      'the root package namespace binding',
      'import * as Root from "effect"; function read(Root: LocalRoot) { const decoded = decode(); return Root.Option.isSome(decoded) ? decoded.value : undefined; }',
    ],
    [
      'a function-hoisted Option binding',
      imported(
        'function read() { const decoded = decode(); const value = Option.isSome(decoded) ? decoded.value : null; var Option = LocalOption; return value; }',
      ),
    ],
  ])('respects lexical shadowing of %s', (_name, source): void => {
    expect(reportsFor(source)).toHaveLength(0);
  });

  it.each([
    ['a parenthesized isSome callee', localCandidate(conditional('(Option.isSome)(decoded)'))],
    [
      'an asserted isSome callee',
      localCandidate(conditional('(Option.isSome as typeof Option.isSome)(decoded)')),
    ],
    ['a non-null isSome callee', localCandidate(conditional('Option.isSome!(decoded)'))],
    ['an explicit type argument', localCandidate(conditional('Option.isSome<number>(decoded)'))],
    ['a spread argument', localCandidate(conditional('Option.isSome(...[decoded])'))],
    [
      'a wrapped argument',
      localCandidate(conditional('Option.isSome(decoded as Option.Option<number>)')),
    ],
    ['a computed isSome access', localCandidate(conditional('Option["isSome"](decoded)'))],
    ['an optional Option access', localCandidate(conditional('Option?.isSome(decoded)'))],
    ['an optional isSome call', localCandidate(conditional('Option.isSome?.(decoded)'))],
    ['an optional value access', localCandidate(conditional(undefined, 'decoded?.value'))],
    ['a computed value access', localCandidate(conditional(undefined, 'decoded["value"]'))],
    ['an asserted value access', localCandidate(conditional(undefined, 'decoded.value as number'))],
    ['a zero-argument isSome call', localCandidate(conditional('Option.isSome()'))],
    ['a two-argument isSome call', localCandidate(conditional('Option.isSome(decoded, other)'))],
  ])('leaves %s outside the exact matcher', (_name, source): void => {
    expect(reportsFor(source)).toHaveLength(0);
  });

  it.each([
    [
      'Option.getOrNull',
      imported('const decoded = decode(); const value = Option.getOrNull(decoded);'),
    ],
    [
      'Option.getOrUndefined',
      imported('const decoded = decode(); const value = Option.getOrUndefined(decoded);'),
    ],
    [
      'named nullish getters',
      'import { getOrNull, getOrUndefined } from "effect/Option"; const decoded = decode(); const one = getOrNull(decoded); const two = getOrUndefined(decoded);',
    ],
  ])('accepts the canonical %s form', (_name, source): void => {
    expect(reportsFor(source)).toHaveLength(0);
  });
});
