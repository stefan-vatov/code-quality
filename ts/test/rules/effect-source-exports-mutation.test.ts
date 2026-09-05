import { describe, expect, it } from 'vitest';
import { exportedDeclarationTexts } from '../../src/rules/effect-exported-declarations';
import {
  findBalancedCallEnd,
  findMatchingBrace,
  stripCommentsAndStrings,
} from '../../src/rules/effect-source-scan';
import { hasPromiseReturningPublicAPI } from '../../src/rules/effect-strict-internals';
import { runRule } from './effect-rule-test-utils';

const sourceLines = (...lines: string[]): string => lines.join('\n');

const expectSingleExportProjection = (source: string): void => {
  expect(exportedDeclarationTexts(source)).toEqual([source]);
};

describe('Effect source scanner contracts', (): void => {
  it('finds the exact outer call boundary through nested and non-code delimiters', (): void => {
    const source = sourceLines(
      'Effect.flatMap(program, (value) => combine(',
      '  nested(value, { text: ")" }),',
      '  `raw ) ${ignored(")")}`,',
      '  /[)]/g, /* ) */ value // )',
      ')) + tail',
    );

    expect(findBalancedCallEnd(source, source.indexOf('('))).toBe(source.lastIndexOf(')'));
  });

  it('returns the final source index when a call is unmatched', (): void => {
    const source = 'Effect.flatMap(program, Effect.succeed(value) + tail';

    expect(findBalancedCallEnd(source, source.indexOf('('))).toBe(source.length - 1);
  });

  it('finds the exact outer brace through nested and non-code delimiters', (): void => {
    const source = sourceLines(
      'const value = {',
      '  nested: { value: "}" },',
      '  template: `raw } ${ignored({ close: "}" })}`,',
      '  pattern: /[}]/g, /* } */',
      '  method() { return { ok: true }; } // }',
      '};',
      'const tail = true;',
    );

    expect(findMatchingBrace(source, source.indexOf('{'))).toBe(source.lastIndexOf('};'));
  });

  it('returns minus one when a brace is unmatched', (): void => {
    const source = 'const value = { nested: { ok: true }';

    expect(findMatchingBrace(source, source.indexOf('{'))).toBe(-1);
  });

  it('strips comments, strings, templates, and regex while preserving source coordinates', (): void => {
    const source = sourceLines(
      'const one = "hidden"; // line secret',
      'const two = `raw ${visible({ nested: 1 })} tail`;',
      'const pattern = /brace\\}\\/paren\\)/g; /* block',
      'secret */',
      'export const result = visible;',
    );
    const expected = sourceLines(
      'const·one·=·"······";···············',
      'const·two·=·`······visible({·nested:·1·})······`;',
      'const·pattern·=····················;·········',
      '·········',
      'export·const·result·=·visible;',
    ).replaceAll('·', ' ');
    const stripped = stripCommentsAndStrings(source);

    expect(stripped).toBe(expected);
    expect(stripped).toHaveLength(173);
    expect(Array.from(stripped.matchAll(/\n/g), (match) => match.index)).toEqual([
      36, 86, 132, 142,
    ]);
  });
});

const registerExportDeclarationTests = (): void => {
  it('extracts direct functions, values, types, interfaces, and classes exactly once', (): void => {
    const source = sourceLines(
      'export const direct = wrap({ semi: ";" });',
      'export async function load(value: string) {',
      '  return Effect.succeed({ value });',
      '}',
      'export abstract class Base {',
      '  abstract run(): void;',
      '}',
      'export interface Contract {',
      '  run(): void;',
      '}',
      'export type Result = { readonly value: string };',
    );

    expect(exportedDeclarationTexts(source)).toEqual([
      sourceLines(
        'export async function load(value: string) {',
        '  return Effect.succeed({ value });',
        '}',
      ),
      'export const direct = wrap({ semi: ";" });',
      'export type Result = { readonly value: string };',
      sourceLines('export interface Contract {', '  run(): void;', '}'),
      sourceLines('export abstract class Base {', '  abstract run(): void;', '}'),
    ]);
  });

  it('extracts a default async arrow once and exposes only its callable value', (): void => {
    const source = 'export default async (value: number) => Effect.succeed(value);';

    expect(exportedDeclarationTexts(source)).toEqual([source]);
  });

  it('projects a default async function to the same body boundary as a named function', (): void => {
    const source = sourceLines(
      'export default async function load() {',
      '  return Effect.succeed(1);',
      '}',
    );
    expect(exportedDeclarationTexts(source)).toEqual([source]);
  });

  it('projects a default class body but does not classify it as callable', (): void => {
    const source = sourceLines(
      'export default class Worker {',
      '  run() { return Effect.succeed(1); }',
      '}',
    );

    expect(exportedDeclarationTexts(source)).toEqual([source]);
  });

  it('keeps a default non-callable expression out of callable segments', (): void => {
    const source = 'export default Effect.succeed(1);';

    expect(exportedDeclarationTexts(source)).toEqual([source]);
  });

  it('resolves local export aliases and type-only export lists to their declarations', (): void => {
    const source = sourceLines(
      'const internal = (input: string) => Effect.succeed(input);',
      'async function load() { return Effect.succeed(1); }',
      'class Service { run() { return 1; } }',
      'interface Shape { readonly value: string; }',
      'type Alias = { readonly id: string };',
      'const value = 42;',
      'export { internal as handler, load, Service, value };',
      'export type { Shape as PublicShape, Alias };',
    );

    expect(exportedDeclarationTexts(source)).toEqual([
      'const internal = (input: string) => Effect.succeed(input);',
      'async function load() { return Effect.succeed(1); }',
      'class Service { run() { return 1; } }',
      'const value = 42;',
      'interface Shape { readonly value: string; }',
      'type Alias = { readonly id: string };',
    ]);
  });

  it('does not treat re-exports as declarations from the current module', (): void => {
    const source = sourceLines(
      'export { remote as alias } from "./remote";',
      'export type { Remote } from "./remote";',
      'export * from "./remote";',
    );

    expect(exportedDeclarationTexts(source)).toEqual([]);
  });
};

const registerCallableBoundaryTests = (): void => {
  it('isolates arrow and function bodies while excluding non-callable initializers', (): void => {
    const source = sourceLines(
      'export const block = (input: string) => {',
      '  return Effect.succeed(input);',
      '};',
      'export const expression = async (input: string) => Effect.succeed(input);',
      'export function declared(input: string) {',
      '  return Effect.succeed(input);',
      '}',
      'export const completed = Effect.succeed(1);',
      'export class Worker { run() { return Effect.succeed(1); } }',
    );

    expect(exportedDeclarationTexts(source)).toEqual([
      sourceLines(
        'export function declared(input: string) {',
        '  return Effect.succeed(input);',
        '}',
      ),
      sourceLines(
        'export const block = (input: string) => {',
        '  return Effect.succeed(input);',
        '};',
      ),
      'export const expression = async (input: string) => Effect.succeed(input);',
      'export const completed = Effect.succeed(1);',
      'export class Worker { run() { return Effect.succeed(1); } }',
    ]);
  });

  it('locates a function body after an object-shaped return type', (): void => {
    const source = sourceLines(
      'export function load(): Effect.Effect<{ readonly value: number }> {',
      '  return Effect.succeed({ value: 1 });',
      '}',
    );
    expectSingleExportProjection(source);
  });

  it.each([
    {
      name: 'Schema.Class',
      source: sourceLines(
        'export class User extends Schema.Class<User>("User")({',
        '  id: Schema.String,',
        '}) {',
        '  run() { return Effect.runPromise(program); }',
        '}',
      ),
    },
    {
      name: 'mixin',
      source: sourceLines(
        'export class Service extends mixin(Base, {',
        '  tag: "service",',
        '}) {',
        '  run() { return Effect.runPromise(program); }',
        '}',
      ),
    },
  ])('locates the class declaration after a $name heritage object', ({ source }): void => {
    expectSingleExportProjection(source);
  });

  it('extracts a default abstract class exactly once', (): void => {
    const source = sourceLines(
      'export default abstract class Service {',
      '  abstract run(): Effect.Effect<void>;',
      '}',
    );
    expectSingleExportProjection(source);
  });

  it.each([
    {
      name: 'named generic',
      source:
        'export const load = <Value extends ReadonlyArray<Result<Option<number>>>>(value: Value) => Effect.succeed(value);',
    },
    {
      name: 'default generic',
      source:
        'export default <Value extends ReadonlyArray<Result<Option<number>>>>(value: Value) => Effect.succeed(value);',
    },
    {
      name: 'async generic',
      source:
        'export const load = async <Value extends ReadonlyArray<Result<Option<number>>>>(value: Value) => Effect.succeed(value);',
    },
  ])('projects a $name arrow declaration', ({ source }): void => {
    expectSingleExportProjection(source);
  });

  it('ignores nested arrows inside a default parameter when locating the outer arrow', (): void => {
    const source =
      'export const load = (transform = (value: number) => (nested: number) => value + nested) => Effect.succeed(transform);';

    expectSingleExportProjection(source);
  });

  it.each([
    {
      source:
        'export const load = ({ id, meta: { active } }: User) => Effect.succeed({ id, active });',
    },
    {
      source: 'export default ([first, ...rest]: readonly number[]) => Effect.succeed(first);',
    },
  ])('supports destructured and typed arrow parameters', ({ source }): void => {
    expectSingleExportProjection(source);
  });
};

describe('Effect exported declaration contracts', (): void => {
  registerExportDeclarationTests();
  registerCallableBoundaryTests();
});

describe('Effect exported declaration downstream diagnostics', (): void => {
  it('keeps Promise-returning API diagnostics visible after an object return type', (): void => {
    const runPromiseSource = sourceLines(
      'export function execute(): Promise<{ readonly value: number }> {',
      '  return Effect.runPromise(Effect.succeed({ value: 1 }));',
      '}',
    );

    expect(hasPromiseReturningPublicAPI(runPromiseSource)).toBe(true);
    expect(runRule('effect-no-promise-returning-public-api', runPromiseSource)).toHaveLength(1);
  });

  it('keeps class Promise diagnostics visible after Schema.Class fields', (): void => {
    const source = sourceLines(
      'export class User extends Schema.Class<User>("User")({',
      '  id: Schema.String,',
      '}) {',
      '  async save(): Promise<void> {',
      '    return Effect.runPromise(program);',
      '  }',
      '}',
    );

    expect(hasPromiseReturningPublicAPI(source)).toBe(true);
    expect(runRule('effect-no-promise-returning-public-api', source)).toHaveLength(1);
  });
});
