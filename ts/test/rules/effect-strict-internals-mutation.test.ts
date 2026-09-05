import {
  arrayValue,
  effectCallPredicate,
  effectWrapperStatement,
  hasDirectPlatformAccess,
  hasEffectSucceedWithVoid,
  hasExportedRunPromiseAPI,
  hasGlobalFetch,
  hasLayerEffectWithScope,
  hasMapFlatten,
  hasMapToVoid,
  hasMultipleProvideChain,
  hasNodeBuiltinImport,
  hasNonDeterministicServiceKey,
  hasPromiseReturningPublicAPI,
  hasRunSyncInServerRequestHandler,
  hasSchemaInstanceof,
  hasSchemaStructWithTag,
  hasSchemaUnionOfLiterals,
  identifierName,
  isMember,
  isSchemaMember,
  isVoidZero,
  literalValue,
  nodeType,
  objectValue,
  publicAPIDeclarationSignature,
  serviceKeyFromClass,
} from '../../src/rules/effect-strict-internals';
import { describe, expect, it } from 'vitest';
import type { ASTNode, ASTObject, ASTValue } from '../../src/rules/effect-ast';
import type { Context } from '../../src/rules/effect-rule-core';

type IndexedCheck = (source: string) => false | number;

type IndexedCase = readonly [
  name: string,
  check: IndexedCheck,
  violations: readonly { needle: string; source: string }[],
  safe: readonly string[],
  concealed: readonly string[],
  nearMatches: readonly string[],
];

const identifier = (name: string) => ({ name, type: 'Identifier' });
const literal = (value: boolean | null | number | string) => ({
  type: 'Literal',
  value,
});
const member = (objectName: string, propertyName: string) => ({
  object: identifier(objectName),
  property: identifier(propertyName),
  type: 'MemberExpression',
});
const call = (callee: ASTNode, arguments_: readonly ASTNode[] = []) => ({
  arguments: arguments_,
  callee,
  type: 'CallExpression',
});
const serviceClass = (
  className: string,
  objectName: string,
  propertyName: string,
  innerArguments: readonly ASTNode[],
  outerArguments: readonly ASTNode[],
) => ({
  id: identifier(className),
  superClass: call(call(member(objectName, propertyName), innerArguments), outerArguments),
  type: 'ClassDeclaration',
});
const context = (
  filename = 'src/domain/user.ts',
  options?: { adapterLayers: readonly string[] },
): Context => ({
  filename,
  options: options ? [options] : undefined,
  report: (): void => undefined,
});

describe('strict AST value contracts', (): void => {
  it('preserves only supported AST values and exact object properties', (): void => {
    const node = {
      enabled: true,
      handler: (): void => undefined,
      missing: undefined,
      nested: { type: 'Identifier' },
      nothing: null,
      total: 3,
    };

    const input = node as typeof node & ASTObject;

    expect(objectValue(input, 'enabled')).toBe(true);
    expect(objectValue(input, 'handler')).toBeUndefined();
    expect(objectValue(input, 'nested')).toStrictEqual({ type: 'Identifier' });
    expect(objectValue(input, 'nothing')).toBeNull();
    expect(objectValue(input, 'absent')).toBeUndefined();
    expect(objectValue('node', 'length')).toBeUndefined();
  });

  it('filters arrays and rejects non-array containers exactly', (): void => {
    const functionValue = (): void => undefined;

    const values = arrayValue([0, 'value', null, undefined, {}, functionValue] as ASTValue[]);
    expect(values).toStrictEqual([0, 'value', null, undefined, {}]);
    expect(arrayValue({ 0: 'value', length: 1 })).toStrictEqual([]);
  });

  it('requires exact node kinds and value types', (): void => {
    expect(nodeType({ type: 'Identifier' })).toBe('Identifier');
    expect(nodeType({ type: 1 })).toBeUndefined();
    expect(identifierName(identifier('UserRepo'))).toBe('UserRepo');
    expect(identifierName({ name: 'UserRepo', type: 'Literal' })).toBeUndefined();
    expect(identifierName({ name: 1, type: 'Identifier' })).toBeUndefined();
    expect(literalValue(literal('UserRepo'))).toBe('UserRepo');
    expect(literalValue(literal(0))).toBe(0);
    expect(literalValue({ type: 'Identifier', value: 'UserRepo' })).toBeUndefined();
  });

  it('matches exact unary and member-expression shapes', (): void => {
    const voidZero = {
      argument: literal(0),
      operator: 'void',
      type: 'UnaryExpression',
    };
    expect(isVoidZero(voidZero)).toBe(true);
    expect(isVoidZero({ ...voidZero, operator: 'typeof' })).toBe(false);
    expect(isVoidZero({ ...voidZero, argument: literal(1) })).toBe(false);
    expect(isVoidZero(literal(0))).toBe(false);
    expect(isMember(member('Effect', 'succeed'), 'Effect', 'succeed')).toBe(true);
    expect(isMember(member('Effect', 'succeed'), 'Effect', 'fail')).toBe(false);
    const computed = {
      ...member('Effect', 'succeed'),
      computed: true,
      property: literal('succeed'),
    };
    expect(isMember(computed, 'Effect', 'succeed')).toBe(false);
  });

  it('matches Schema members through canonical and aliased imports only', (): void => {
    expect(isSchemaMember(member('Schema', 'Struct'), '', 'Struct')).toBe(true);
    expect(
      isSchemaMember(member('S', 'Struct'), 'import { Schema as S } from "effect";', 'Struct'),
    ).toBe(true);
    expect(
      isSchemaMember(member('S', 'Struct'), 'import * as S from "effect/Schema";', 'Struct'),
    ).toBe(true);
    expect(isSchemaMember(member('S', 'Union'), 'const S = localSchema;', 'Union')).toBe(false);
    expect(isSchemaMember(member('Schema', 'Literal'), '', 'Struct')).toBe(false);
  });
});

describe('effectCallPredicate import boundaries', (): void => {
  const cases = [
    ['Effect.succeed(value);', member('Effect', 'succeed'), true],
    ['import { Effect as Fx } from "effect";', member('Fx', 'succeed'), true],
    ['import * as Fx from "effect/Effect";', member('Fx', 'succeed'), true],
    ['import { succeed as ok } from "effect/Effect";', identifier('ok'), true],
    ['const Effect = localEffect;', member('Effect', 'succeed'), false],
    ['import type { succeed as ok } from "effect/Effect";', identifier('ok'), false],
    ['import { succeed as ok } from "./local-effect";', identifier('ok'), false],
    ['import * as Fx from "effect/Effect";', member('Fx', 'success'), false],
  ] as const;

  it.each(cases)('returns $2 for %s', (source, callee, expected): void => {
    expect(effectCallPredicate(source, ['succeed'])(callee)).toBe(expected);
  });
});

describe('service class key extraction', (): void => {
  it('extracts exact Context tag and aliased Effect service keys', (): void => {
    const contextTag = serviceClass('UserRepo', 'Context', 'Tag', [literal('app/UserRepo')], []);
    const genericTag = serviceClass(
      'AuditRepo',
      'Context',
      'GenericTag',
      [literal('AuditRepo')],
      [],
    );
    const effectService = serviceClass('Mailer', 'Fx', 'Service', [], [literal('services/Mailer')]);

    expect(serviceKeyFromClass(contextTag, '')).toStrictEqual({
      className: 'UserRepo',
      key: 'app/UserRepo',
    });
    expect(serviceKeyFromClass(genericTag, '')).toStrictEqual({
      className: 'AuditRepo',
      key: 'AuditRepo',
    });
    expect(
      serviceKeyFromClass(effectService, 'import { Effect as Fx } from "effect";'),
    ).toStrictEqual({
      className: 'Mailer',
      key: 'services/Mailer',
    });
  });

  it('returns only the class name for malformed, non-literal, and unrelated bases', (): void => {
    expect(serviceKeyFromClass({ id: identifier('UserRepo') }, '')).toStrictEqual({
      className: 'UserRepo',
    });
    expect(
      serviceKeyFromClass(serviceClass('UserRepo', 'Context', 'Tag', [identifier('key')], []), ''),
    ).toStrictEqual({ className: 'UserRepo' });
    expect(
      serviceKeyFromClass(
        serviceClass('UserRepo', 'Effect', 'Service', [], [literal('UserRepo')]),
        'const Effect = localEffect;',
      ),
    ).toStrictEqual({ className: 'UserRepo' });
  });
});

describe('public Effect API boundaries', (): void => {
  it('returns exact declaration signatures without implementation bodies', (): void => {
    expect(
      publicAPIDeclarationSignature('export async function load(): Promise<User> { return user; }'),
    ).toBe('export async function load(): Promise<User> ');
    expect(
      publicAPIDeclarationSignature(
        'export const load = (): Effect.Effect<User> => { return program; }',
      ),
    ).toBe('export const load = (): Effect.Effect<User> => ');
    expect(publicAPIDeclarationSignature('export type Loader = () => Promise<User>;')).toBe(
      'export type Loader = () => Promise<User>;',
    );
  });

  const booleanCases = [
    [
      'Promise public API',
      hasPromiseReturningPublicAPI,
      'export async function load(): Promise<User> { return user; }',
      'export const load: Effect.Effect<User> = program;',
      'const docs = "export async function load() {}";',
      'export const promiseLabel = "Promise<User>";',
    ],
    [
      'exported runPromise',
      hasExportedRunPromiseAPI,
      'export const run = () => Effect.runPromise(program);',
      'const run = () => Effect.runPromise(program);',
      'const docs = "export const run = () => Effect.runPromise(program)";',
      'export const run = () => Fx.runPromise(program);',
    ],
    [
      'server runSync',
      hasRunSyncInServerRequestHandler,
      'const handler = () => Effect.runSync(program);',
      'const handler = () => Effect.runPromise(program);',
      'const docs = "handler = () => Effect.runSync(program)";',
      'const handlerFactory = () => Effect.runSync(program);',
    ],
  ] as const;

  it.each(booleanCases)(
    '%s distinguishes code from boundaries',
    (_, check, violation, safe, concealed, near): void => {
      expect(check(violation)).toBe(true);
      expect(check(safe)).toBe(false);
      expect(check(concealed)).toBe(false);
      expect(check(`// ${violation}`)).toBe(false);
      expect(check(near)).toBe(false);
    },
  );

  it('detects public class Promise members but excludes private members', (): void => {
    expect(
      hasPromiseReturningPublicAPI(
        'export class Users { async load(): Promise<User> { return user; } }',
      ),
    ).toBe(true);
    expect(
      hasPromiseReturningPublicAPI(
        'export class Users { private async load(): Promise<User> { return user; } }',
      ),
    ).toBe(false);
  });

  it('detects both assignment and function server handler forms', (): void => {
    expect(hasRunSyncInServerRequestHandler('route = () => Effect.runSync(program);')).toBe(true);
    expect(
      hasRunSyncInServerRequestHandler(
        'function loader(request) { return Effect.runSync(program); }',
      ),
    ).toBe(true);
  });
});

const indexedCases: readonly IndexedCase[] = [
  [
    'Schema instanceof',
    hasSchemaInstanceof,
    [{ needle: 'instanceof', source: 'const valid = value instanceof UserSchema;' }],
    ['Schema.is(UserSchema)(value);'],
    ['const docs = "value instanceof UserSchema";', '// value instanceof UserSchema'],
    ['value instanceof userSchema;', 'value instanceof UserShape;'],
  ],
  [
    'tagged Schema.Struct',
    hasSchemaStructWithTag,
    [
      {
        needle: 'Schema.Struct',
        source: 'const User = Schema.Struct({ _tag: Schema.Literal("User") });',
      },
    ],
    ['Schema.TaggedStruct("User", { id: Schema.String });'],
    [
      'const docs = "Schema.Struct({ _tag: Schema.Literal(User) })";',
      '// Schema.Struct({ _tag: Schema.Literal("User") });',
    ],
    ['Schema.Struct({ kind: Schema.Literal("User") });'],
  ],
  [
    'Schema union of literals',
    hasSchemaUnionOfLiterals,
    [
      {
        needle: 'Schema.Union',
        source: 'const Status = Schema.Union(Schema.Literal("a"), Schema.Literal("b"));',
      },
    ],
    ['Schema.Literal("a", "b");'],
    [
      'const docs = "Schema.Union(Schema.Literal(a), Schema.Literal(b))";',
      '// Schema.Union(Schema.Literal("a"), Schema.Literal("b"));',
    ],
    ['Schema.Union(Schema.Literal("a"), Schema.String);'],
  ],
  [
    'deterministic legacy and generic service keys',
    hasNonDeterministicServiceKey,
    [
      { needle: 'class UserRepo', source: 'class UserRepo extends Context.Tag("random") {}' },
      {
        needle: 'class Mailer',
        source: 'const x = 1; class Mailer extends Effect.Service<Mailer>()("random", {}) {}',
      },
    ],
    [
      'class UserRepo extends Context.Tag("UserRepo") {}',
      'class UserRepo extends Context.Tag("app/UserRepo") {}',
      'class UserRepo extends Effect.Service<UserRepo>()("UserRepo", {}) {}',
    ],
    [
      `const docs = 'class UserRepo extends Context.Tag("random")';`,
      '// class UserRepo extends Context.Tag("random")',
    ],
    ['class userRepo extends Context.Tag("random") {}'],
  ],
  [
    'multiple Effect.provide chain',
    hasMultipleProvideChain,
    [
      {
        needle: '.pipe',
        source: 'const result = program.pipe(Effect.provide(A), Effect.provide(B));',
      },
    ],
    ['program.pipe(Effect.provide(Layer.merge(A, B)));'],
    [
      'const docs = "program.pipe(Effect.provide(A), Effect.provide(B))";',
      '// program.pipe(Effect.provide(A), Effect.provide(B));',
    ],
    ['program.provide(Effect.provide(A));'],
  ],
  [
    'Layer effect requiring Scope',
    hasLayerEffectWithScope,
    [
      {
        needle: 'Layer.effect',
        source: 'const layer = Layer.effect(Service, Effect.service(Scope.Scope));',
      },
    ],
    ['Layer.scoped(Service, acquire);'],
    [
      'const docs = "Layer.effect(Service, Scope.Scope)";',
      '// Layer.effect(Service, Scope.Scope);',
    ],
    ['Layer.effectful(Service, Scope.Scope);'],
  ],
  [
    'Node builtin import',
    hasNodeBuiltinImport,
    [
      { needle: 'from', source: 'import fs from "node:fs";' },
      { needle: 'from', source: 'const x = 1; import path from "node:path";' },
    ],
    ['import { FileSystem } from "@effect/platform";'],
    [`const docs = "from 'node:fs'";`, '// import fs from "node:fs";'],
    ['import value from "node:util";', 'import value from "node:path-extra";'],
  ],
  [
    'Effect.succeed void value',
    hasEffectSucceedWithVoid,
    [
      { needle: 'Effect.succeed', source: 'const result = Effect.succeed(undefined);' },
      { needle: 'Effect.succeed', source: 'const result = Effect.succeed(void 0);' },
      { needle: 'Effect.succeed', source: 'const result = Effect.succeed();' },
    ],
    ['Effect.void;'],
    ['const docs = "Effect.succeed(undefined)";', '// Effect.succeed();'],
    ['Effect.succeeded(undefined);'],
  ],
  [
    'Effect.map to void',
    hasMapToVoid,
    [
      { needle: 'Effect.map', source: 'const result = Effect.map(() => undefined);' },
      { needle: 'Effect.map', source: 'const result = Effect.map(() => void 0);' },
      { needle: 'Effect.map', source: 'const result = Effect.map(() => {});' },
    ],
    ['program.pipe(Effect.asVoid);'],
    ['const docs = "Effect.map(() => undefined)";', '// Effect.map(() => void 0);'],
    ['Effect.mapValue(() => undefined);'],
  ],
  [
    'Effect.map followed by flatten',
    hasMapFlatten,
    [
      { needle: 'Effect.map', source: 'const result = Effect.map(program, next), Effect.flatten;' },
      {
        needle: 'Effect.map',
        source: 'const result = Effect.map(program, next).pipe(Effect.flatten);',
      },
    ],
    ['Effect.flatMap(program, next);'],
    [
      'const docs = "Effect.map(program, next), Effect.flatten";',
      '// Effect.map(program, next).pipe(Effect.flatten);',
    ],
    ['Effect.map(program, next).pipe(Effect.flattenValue);'],
  ],
];

describe.each(indexedCases)(
  '%s indexed scanner',
  (_, check, violations, safe, concealed, nearMatches): void => {
    it('returns every canonical violation index exactly', (): void => {
      for (const violation of violations) {
        expect(check(violation.source)).toBe(violation.source.indexOf(violation.needle));
      }
    });

    it('returns false for idiomatic forms, concealed text, and API boundaries', (): void => {
      for (const source of [...safe, ...concealed, ...nearMatches]) {
        expect(check(source)).toBe(false);
      }
    });
  },
);

describe('path-sensitive platform boundaries', (): void => {
  it('returns the exact wrapped fetch index outside adapters', (): void => {
    const source = 'const request = Effect.tryPromise(() => fetch(url));';
    expect(hasGlobalFetch(source, context())).toBe(source.indexOf('fetch'));
    expect(hasGlobalFetch('const request = fetch(url);', context())).toBe(false);
    expect(
      hasGlobalFetch(source, context('custom/io/client.ts', { adapterLayers: ['custom/io/**'] })),
    ).toBe(false);
    expect(hasGlobalFetch('const docs = "Effect.promise(() => fetch(url))";', context())).toBe(
      false,
    );
    expect(hasGlobalFetch('// Effect.promise(() => fetch(url));', context())).toBe(false);
    expect(hasGlobalFetch('Effect.promise(() => refetch(url));', context())).toBe(false);
  });

  it('returns exact wrapper statements only for Effect promise APIs', (): void => {
    const source = [
      'const before = 1;',
      'const request = Effect.tryPromise(() => fetch(url));',
      'const after = 2;',
    ].join('\n');
    const targetIndex = source.indexOf('fetch');
    expect(effectWrapperStatement(source, targetIndex)).toBe(
      'const request = Effect.tryPromise(() => fetch(url));',
    );
    expect(effectWrapperStatement('const request = fetch(url);', 16)).toBeUndefined();
    expect(effectWrapperStatement('const request = Effect.promise(() => refetch(url));', 43)).toBe(
      'const request = Effect.promise(() => refetch(url));',
    );
  });

  it('distinguishes direct platform calls, Effect wrappers, and adapter paths', (): void => {
    const domain = context();
    const adapter = context('src/adapters/http.ts');
    expect(hasDirectPlatformAccess('const response = fetch(url);', domain)).toBe(true);
    expect(hasDirectPlatformAccess('const data = readFileSync(path);', domain)).toBe(true);
    expect(
      hasDirectPlatformAccess('const response = Effect.promise(() => fetch(url));', domain),
    ).toBe(false);
    expect(hasDirectPlatformAccess('const response = fetch(url);', adapter)).toBe(false);
    expect(hasDirectPlatformAccess('const docs = "fetch(url)";', domain)).toBe(false);
    expect(hasDirectPlatformAccess('// readFileSync(path);', domain)).toBe(false);
    expect(hasDirectPlatformAccess('const response = refetch(url);', domain)).toBe(false);
  });
});
