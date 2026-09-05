import { describe, expect, it } from 'vitest';
import type { SourceRule } from '../../src/rules/effect-rule-core';
import { getEffectRule, runRule } from './effect-rule-test-utils';
import theThracianOxlint from '../../src/index';

const RULE_NAME = 'effect-schema-no-redundant-tag-identifier';
const EXPECTED_MESSAGE =
  'Remove the redundant Schema tag identifier when it equals the _tag value.\n' +
  'Fix: Call the Schema tagged-class factory without the duplicate identifier.\n' +
  'Example:\n```ts\nimport { Schema } from "effect"\n\n' +
  'class NotFound extends Schema.TaggedErrorClass<NotFound>()("NotFound", { id: Schema.String }) {}\n```';

const root = (statement: string): string => `import { Schema } from "effect"; ${statement}`;
const rootAlias = (statement: string): string =>
  `import { Schema as S } from "effect"; ${statement}`;
const subpath = (statement: string): string => `import * as S from "effect/Schema"; ${statement}`;
const rootNamespace = (statement: string): string => `import * as Root from "effect"; ${statement}`;
const taggedClass = (
  api: 'TaggedClass' | 'TaggedError' | 'TaggedErrorClass' | 'TaggedRequest',
  name: string,
  inner = `"${name}"`,
  outer = `"${name}"`,
  tail = '{ id: Schema.String }',
): string => `class ${name} extends Schema.${api}<${name}>(${inner})(${outer}, ${tail}) {}`;

const registeredRule = (): SourceRule => getEffectRule(RULE_NAME);

const reportsFor = (source: string) => {
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

const positiveCases = [
  ['v3 Schema.TaggedClass', root(taggedClass('TaggedClass', 'User'))],
  ['v3 Schema.TaggedError', root(taggedClass('TaggedError', 'NotFound'))],
  ['v3 Schema.TaggedRequest', root(taggedClass('TaggedRequest', 'Lookup'))],
  ['v4 Schema.TaggedErrorClass', root(taggedClass('TaggedErrorClass', 'NotFound'))],
  [
    'an aliased root Schema import',
    rootAlias('class User extends S.TaggedClass<User>("User")("User", { id: S.String }) {}'),
  ],
  [
    'an effect/Schema namespace import',
    subpath('class User extends S.TaggedClass<User>("User")("User", { id: S.String }) {}'),
  ],
  [
    'a named effect/Schema TaggedClass alias',
    'import { TaggedClass as Model } from "effect/Schema"; class User extends Model<User>("User")("User", {}) {}',
  ],
  [
    'an unaliased named effect/Schema factory',
    'import { TaggedClass } from "effect/Schema"; class User extends TaggedClass<User>("User")("User", {}) {}',
  ],
  [
    'a named effect/Schema TaggedError alias',
    'import { TaggedError as Failure } from "effect/Schema"; class Missing extends Failure<Missing>("Missing")("Missing", {}) {}',
  ],
  [
    'a named effect/Schema TaggedRequest alias',
    'import { TaggedRequest as Request } from "effect/Schema"; class Lookup extends Request<Lookup>("Lookup")("Lookup", {}) {}',
  ],
  [
    'a named effect/Schema TaggedErrorClass alias',
    'import { TaggedErrorClass as Failure } from "effect/Schema"; class Missing extends Failure<Missing>("Missing")("Missing", {}) {}',
  ],
  [
    'Schema through the root package namespace',
    rootNamespace(
      'class User extends Root.Schema.TaggedClass<User>("User")("User", { id: Root.Schema.String }) {}',
    ),
  ],
  [
    'a factory call without a Self generic',
    root('class User extends Schema.TaggedClass("User")("User", { id: Schema.String }) {}'),
  ],
  [
    'an outer annotations argument',
    root(
      'class User extends Schema.TaggedClass<User>("User")("User", { id: Schema.String }, { title: "User" }) {}',
    ),
  ],
  [
    'different quote spellings',
    root('class User extends Schema.TaggedClass<User>(\'User\')("User", {}) {}'),
  ],
  [
    'an escaped inner identifier with the same decoded value',
    root('class User extends Schema.TaggedClass<User>("\\x55ser")("User", {}) {}'),
  ],
  [
    'an escaped outer tag with the same decoded value',
    root('class User extends Schema.TaggedClass<User>("User")("\\u0055ser", {}) {}'),
  ],
  [
    'an exported class declaration',
    root('export class User extends Schema.TaggedClass<User>("User")("User", {}) {}'),
  ],
  [
    'a default-exported class declaration',
    root('export default class User extends Schema.TaggedClass<User>("User")("User", {}) {}'),
  ],
  [
    'a nested class declaration',
    root(
      'function make() { class User extends Schema.TaggedClass<User>("User")("User", {}) {} return User; }',
    ),
  ],
  [
    'a class after an unrelated shadowing scope ends',
    root(
      'function local(Schema) { return Schema; } class User extends Schema.TaggedClass<User>("User")("User", {}) {}',
    ),
  ],
] as const;

const provenanceCases = [
  ['no import', 'class User extends Schema.TaggedClass<User>("User")("User", {}) {}'],
  [
    'no import when every source token passes the hot-path gate',
    'const effect = true; class User extends Schema.TaggedClass<User>("User")("User", {}) {}',
  ],
  [
    'a foreign root import',
    'import { Schema } from "other"; class User extends Schema.TaggedClass<User>("User")("User", {}) {}',
  ],
  [
    'a foreign subpath namespace',
    'import * as Schema from "other/Schema"; class User extends Schema.TaggedClass<User>("User")("User", {}) {}',
  ],
  [
    'a foreign named factory',
    'import { TaggedClass } from "other/Schema"; class User extends TaggedClass<User>("User")("User", {}) {}',
  ],
  [
    'a type-only root import',
    'import type { Schema } from "effect"; class User extends Schema.TaggedClass<User>("User")("User", {}) {}',
  ],
  [
    'a type-only root specifier',
    'import { type Schema } from "effect"; class User extends Schema.TaggedClass<User>("User")("User", {}) {}',
  ],
  [
    'a type-only subpath namespace',
    'import type * as Schema from "effect/Schema"; class User extends Schema.TaggedClass<User>("User")("User", {}) {}',
  ],
  [
    'a type-only named subpath factory',
    'import type { TaggedClass } from "effect/Schema"; class User extends TaggedClass<User>("User")("User", {}) {}',
  ],
  [
    'a type-only named subpath specifier',
    'import { type TaggedClass } from "effect/Schema"; class User extends TaggedClass<User>("User")("User", {}) {}',
  ],
  [
    'a default root import',
    'import Schema from "effect"; class User extends Schema.TaggedClass<User>("User")("User", {}) {}',
  ],
  [
    'a default subpath import',
    'import Schema from "effect/Schema"; class User extends Schema.TaggedClass<User>("User")("User", {}) {}',
  ],
  [
    'another root export aliased as Schema',
    'import { Effect as Schema } from "effect"; class User extends Schema.TaggedClass<User>("User")("User", {}) {}',
  ],
  [
    'another subpath export aliased as TaggedClass',
    'import { Struct as TaggedClass } from "effect/Schema"; class User extends TaggedClass<User>("User")("User", {}) {}',
  ],
  [
    'an effect barrel path',
    'import { Schema } from "effect/index"; class User extends Schema.TaggedClass<User>("User")("User", {}) {}',
  ],
  [
    'a Schema barrel path',
    'import * as Schema from "effect/Schema/index"; class User extends Schema.TaggedClass<User>("User")("User", {}) {}',
  ],
  [
    'a CommonJS require',
    'const { Schema } = require("effect"); class User extends Schema.TaggedClass<User>("User")("User", {}) {}',
  ],
  [
    'a dynamic import',
    'const Schema = await import("effect/Schema"); class User extends Schema.TaggedClass<User>("User")("User", {}) {}',
  ],
  [
    'TaggedClass directly on the root namespace',
    'import * as Root from "effect"; class User extends Root.TaggedClass<User>("User")("User", {}) {}',
  ],
] as const;

const shadowingCases = [
  [
    'a parameter shadowing root Schema',
    root(
      'function local(Schema) { class User extends Schema.TaggedClass<User>("User")("User", {}) {} }',
    ),
  ],
  [
    'a parameter shadowing a subpath namespace',
    subpath('function local(S) { class User extends S.TaggedClass<User>("User")("User", {}) {} }'),
  ],
  [
    'a parameter shadowing a named factory',
    'import { TaggedClass as Model } from "effect/Schema"; function local(Model) { class User extends Model<User>("User")("User", {}) {} }',
  ],
  [
    'a parameter shadowing a root package namespace',
    rootNamespace(
      'function local(Root) { class User extends Root.Schema.TaggedClass<User>("User")("User", {}) {} }',
    ),
  ],
  [
    'a block binding shadowing root Schema',
    root(
      '{ const Schema = LocalSchema; class User extends Schema.TaggedClass<User>("User")("User", {}) {} }',
    ),
  ],
  [
    'a catch binding shadowing root Schema',
    root(
      'try {} catch (Schema) { class User extends Schema.TaggedClass<User>("User")("User", {}) {} }',
    ),
  ],
  [
    'a hoisted var shadowing root Schema',
    root(
      'function local() { class User extends Schema.TaggedClass<User>("User")("User", {}) {} var Schema = LocalSchema; }',
    ),
  ],
] as const;

const grammarCases = [
  ['a different identifier value', root(taggedClass('TaggedClass', 'User', '"Entity"'))],
  [
    'a canonical zero-identifier TaggedClass call',
    root('class User extends Schema.TaggedClass<User>()("User", {}) {}'),
  ],
  [
    'a canonical zero-identifier TaggedError call',
    root('class Missing extends Schema.TaggedError<Missing>()("Missing", {}) {}'),
  ],
  [
    'a canonical zero-identifier TaggedRequest call',
    root('class Lookup extends Schema.TaggedRequest<Lookup>()("Lookup", {}) {}'),
  ],
  [
    'the canonical v4 TaggedErrorClass call',
    root(
      'class NotFound extends Schema.TaggedErrorClass<NotFound>()("NotFound", { id: Schema.String }) {}',
    ),
  ],
  [
    'an inner identifier binding',
    root('class User extends Schema.TaggedClass<User>(identifier)("User", {}) {}'),
  ],
  ['an outer tag binding', root('class User extends Schema.TaggedClass<User>("User")(tag, {}) {}')],
  [
    'an inner template literal',
    root('class User extends Schema.TaggedClass<User>(`User`)("User", {}) {}'),
  ],
  [
    'an outer template literal',
    root('class User extends Schema.TaggedClass<User>("User")(`User`, {}) {}'),
  ],
  [
    'equal template literals',
    root('class User extends Schema.TaggedClass<User>(`User`)(`User`, {}) {}'),
  ],
  [
    'a numeric inner identifier',
    root('class User extends Schema.TaggedClass<User>(1)("User", {}) {}'),
  ],
  ['a numeric outer tag', root('class User extends Schema.TaggedClass<User>("User")(1, {}) {}')],
  ['equal numeric literals', root('class User extends Schema.TaggedClass<User>(1)(1, {}) {}')],
  ['an inner call with two arguments', root(taggedClass('TaggedClass', 'User', '"User", options'))],
  [
    'an inner spread argument',
    root('class User extends Schema.TaggedClass<User>(...identifiers)("User", {}) {}'),
  ],
  [
    'an outer call with no arguments',
    root('class User extends Schema.TaggedClass<User>("User")() {}'),
  ],
  [
    'an outer call with one argument',
    root('class User extends Schema.TaggedClass<User>("User")("User") {}'),
  ],
  [
    'an outer call with four arguments',
    root('class User extends Schema.TaggedClass<User>("User")("User", {}, annotations, extra) {}'),
  ],
  [
    'an outer spread argument',
    root('class User extends Schema.TaggedClass<User>("User")("User", ...definition) {}'),
  ],
  [
    'an outer explicit call generic',
    root('class User extends Schema.TaggedClass<User>("User")<Fields>("User", {}) {}'),
  ],
  [
    'an optional imported factory member',
    root('class User extends Schema?.TaggedClass<User>("User")("User", {}) {}'),
  ],
  [
    'an optional inner call',
    root('class User extends Schema.TaggedClass?.<User>("User")("User", {}) {}'),
  ],
  [
    'a computed imported factory member',
    root('class User extends Schema["TaggedClass"]<User>("User")("User", {}) {}'),
  ],
  [
    'a parenthesized imported factory',
    root('class User extends (Schema.TaggedClass)<User>("User")("User", {}) {}'),
  ],
  [
    'an asserted imported factory',
    root(
      'class User extends (Schema.TaggedClass as typeof Schema.TaggedClass)<User>("User")("User", {}) {}',
    ),
  ],
  [
    'a non-null imported factory',
    root('class User extends Schema.TaggedClass!<User>("User")("User", {}) {}'),
  ],
  [
    'an optional outer call',
    root('class User extends Schema.TaggedClass<User>("User")?.("User", {}) {}'),
  ],
  [
    'a parenthesized inner factory call',
    root('class User extends (Schema.TaggedClass<User>("User"))("User", {}) {}'),
  ],
  [
    'an asserted inner factory call',
    root('class User extends (Schema.TaggedClass<User>("User") as Factory)("User", {}) {}'),
  ],
  [
    'a non-null inner factory call',
    root('class User extends Schema.TaggedClass<User>("User")!("User", {}) {}'),
  ],
  [
    'a stored intermediate factory',
    root(
      'const UserFactory = Schema.TaggedClass<User>("User"); class User extends UserFactory("User", {}) {}',
    ),
  ],
  [
    'an unrelated Schema.Struct call',
    root('class User extends Schema.Struct({ _tag: Schema.Literal("User") }) {}'),
  ],
  [
    'an unrelated Schema.TaggedStruct call',
    root('class User extends Schema.TaggedStruct("User", { id: Schema.String }) {}'),
  ],
  [
    'a class expression',
    root('const User = class extends Schema.TaggedClass("User")("User", {}) {};'),
  ],
  [
    'an ordinary factory call outside class heritage',
    root('const User = Schema.TaggedClass<User>("User")("User", {});'),
  ],
  [
    'a class extending a factory binding',
    root('const Base = Schema.TaggedClass<User>("User")("User", {}); class User extends Base {}'),
  ],
] as const;

describe('effect-schema-no-redundant-tag-identifier', (): void => {
  it('is registered as a report-only problem and enabled as a default error', (): void => {
    const rule = registeredRule();

    expect(rule.meta?.type).toBe('problem');
    expect(theThracianOxlint().rules).not.toHaveProperty(`thethracian/${RULE_NAME}`);
  });

  it.each([
    ['effect', 'Schema Tagged class'],
    ['Schema', 'effect Tagged class'],
    ['Tagged', 'effect Schema class'],
    ['class', 'effect Schema Tagged'],
  ])('keeps only Program when source is missing %s', (_token, source): void => {
    expect(visitorKeysFor(source)).toStrictEqual(['Program']);
  });

  it('enables class analysis when every gate token starts at offset zero', (): void => {
    expect(visitorKeysFor('effect Schema Tagged class')).toStrictEqual([
      'ClassDeclaration',
      'Program',
    ]);
  });

  it.each(positiveCases)('reports %s across Effect v3 and v4', (_name, source): void => {
    expect(reportsFor(source)).toHaveLength(1);
  });

  it('reports every independent class declaration', (): void => {
    const source = root(
      'class User extends Schema.TaggedClass<User>("User")("User", {}) {} ' +
        'class Missing extends Schema.TaggedErrorClass<Missing>("Missing")("Missing", {}) {}',
    );

    expect(reportsFor(source)).toHaveLength(2);
  });

  it('publishes the exact diagnostic without a fix or suggestions', (): void => {
    const [report] = reportsFor(root(taggedClass('TaggedErrorClass', 'NotFound')));

    expect(report?.message).toBe(EXPECTED_MESSAGE);
    expect(report && 'fix' in report ? report.fix : undefined).toBeUndefined();
    expect(report && 'suggest' in report ? report.suggest : undefined).toBeUndefined();
    expect(report && 'suggestions' in report ? report.suggestions : undefined).toBeUndefined();
  });

  it.each([
    ['a Schema namespace call', root(taggedClass('TaggedClass', 'User')), '"User"'],
    [
      'a named factory alias',
      'import { TaggedClass as Model } from "effect/Schema"; class User extends Model<User>(\'User\')("User", {}) {}',
      "'User'",
    ],
  ])('reports the redundant inner literal for %s', (_name, source, text): void => {
    const [report] = reportsFor(source);
    // SAFETY: the rule reports the parser's inner tag literal, whose source offsets are verified below.
    const node = report?.node as { end?: number; start?: number; type?: string } | undefined;

    expect(node?.type).toBe('Literal');
    expect(source.slice(node?.start, node?.end)).toBe(text);
  });

  it.each(provenanceCases)('does not report %s', (_name, source): void => {
    expect(reportsFor(source)).toHaveLength(0);
  });

  it.each(shadowingCases)('respects %s', (_name, source): void => {
    expect(reportsFor(source)).toHaveLength(0);
  });

  it.each(grammarCases)('does not report %s', (_name, source): void => {
    expect(reportsFor(source)).toHaveLength(0);
  });
});
