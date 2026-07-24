import { describe, expect, it } from 'vitest';
import {
  exportedCallableDeclarationSegments,
  exportedDeclarationSegments,
  exportedDeclarationTexts,
} from '../../src/rules/effect-exported-declarations';
import {
  findBalancedCallEnd,
  findMatchingBrace,
  stripCommentsAndStrings,
} from '../../src/rules/effect-source-scan';
import {
  hasExportedRunPromiseAPI,
  hasPromiseReturningPublicAPI,
} from '../../src/rules/effect-strict-internals';
import { runRule } from './effect-rule-test-utils';

const sourceLines = (...lines: string[]): string => lines.join('\n');

const expectSingleExportProjection = (
  source: string,
  segment: string,
  isCallable: boolean,
): void => {
  expect(exportedDeclarationTexts(source)).toEqual([source]);
  expect(exportedDeclarationSegments(source)).toEqual([segment]);
  expect(exportedCallableDeclarationSegments(source)).toEqual(isCallable ? [segment] : []);
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

describe('Effect exported declaration contracts', (): void => {
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
    expect(exportedDeclarationSegments(source)).toEqual([
      sourceLines('{', '  return Effect.succeed({ value });', '}'),
      ' wrap({ semi: ";" });',
      '{ readonly value: string };',
      sourceLines('{', '  run(): void;', '}'),
      sourceLines('{', '  abstract run(): void;', '}'),
    ]);
    expect(exportedCallableDeclarationSegments(source)).toEqual([
      sourceLines('{', '  return Effect.succeed({ value });', '}'),
    ]);
  });

  it('extracts a default async arrow once and exposes only its callable value', (): void => {
    const source = 'export default async (value: number) => Effect.succeed(value);';

    expect(exportedDeclarationTexts(source)).toEqual([source]);
    expect(exportedDeclarationSegments(source)).toEqual([' Effect.succeed(value);']);
    expect(exportedCallableDeclarationSegments(source)).toEqual([' Effect.succeed(value);']);
  });

  it('projects a default async function to the same body boundary as a named function', (): void => {
    const source = sourceLines(
      'export default async function load() {',
      '  return Effect.succeed(1);',
      '}',
    );
    const body = sourceLines('{', '  return Effect.succeed(1);', '}');

    expect(exportedDeclarationTexts(source)).toEqual([source]);
    expect(exportedDeclarationSegments(source)).toEqual([body]);
    expect(exportedCallableDeclarationSegments(source)).toEqual([body]);
  });

  it('projects a default class body but does not classify it as callable', (): void => {
    const source = sourceLines(
      'export default class Worker {',
      '  run() { return Effect.succeed(1); }',
      '}',
    );

    expect(exportedDeclarationTexts(source)).toEqual([source]);
    expect(exportedDeclarationSegments(source)).toEqual([
      sourceLines('{', '  run() { return Effect.succeed(1); }', '}'),
    ]);
    expect(exportedCallableDeclarationSegments(source)).toEqual([]);
  });

  it('keeps a default non-callable expression out of callable segments', (): void => {
    const source = 'export default Effect.succeed(1);';

    expect(exportedDeclarationTexts(source)).toEqual([source]);
    expect(exportedDeclarationSegments(source)).toEqual(['Effect.succeed(1);']);
    expect(exportedCallableDeclarationSegments(source)).toEqual([]);
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
    expect(exportedDeclarationSegments(source)).toEqual([
      ' Effect.succeed(input);',
      '{ return Effect.succeed(1); }',
      '{ run() { return 1; } }',
      ' 42;',
      '{ readonly value: string; }',
      '{ readonly id: string };',
    ]);
    expect(exportedCallableDeclarationSegments(source)).toEqual([
      ' Effect.succeed(input);',
      '{ return Effect.succeed(1); }',
    ]);
  });

  it('does not treat re-exports as declarations from the current module', (): void => {
    const source = sourceLines(
      'export { remote as alias } from "./remote";',
      'export type { Remote } from "./remote";',
      'export * from "./remote";',
    );

    expect(exportedDeclarationTexts(source)).toEqual([]);
    expect(exportedDeclarationSegments(source)).toEqual([]);
    expect(exportedCallableDeclarationSegments(source)).toEqual([]);
  });

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
    expect(exportedDeclarationSegments(source)).toEqual([
      sourceLines('{', '  return Effect.succeed(input);', '}'),
      sourceLines(' {', '  return Effect.succeed(input);', '};'),
      ' Effect.succeed(input);',
      ' Effect.succeed(1);',
      '{ run() { return Effect.succeed(1); } }',
    ]);
    expect(exportedCallableDeclarationSegments(source)).toEqual([
      sourceLines('{', '  return Effect.succeed(input);', '}'),
      sourceLines(' {', '  return Effect.succeed(input);', '};'),
      ' Effect.succeed(input);',
    ]);
  });

  it('locates a function body after an object-shaped return type', (): void => {
    const source = sourceLines(
      'export function load(): Effect.Effect<{ readonly value: number }> {',
      '  return Effect.succeed({ value: 1 });',
      '}',
    );
    const body = sourceLines('{', '  return Effect.succeed({ value: 1 });', '}');

    expectSingleExportProjection(source, body, true);
  });

  it.each([
    {
      body: sourceLines('{', '  run() { return Effect.runPromise(program); }', '}'),
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
      body: sourceLines('{', '  run() { return Effect.runPromise(program); }', '}'),
      name: 'mixin',
      source: sourceLines(
        'export class Service extends mixin(Base, {',
        '  tag: "service",',
        '}) {',
        '  run() { return Effect.runPromise(program); }',
        '}',
      ),
    },
  ])('locates the class body after a $name heritage object', ({ body, source }): void => {
    expectSingleExportProjection(source, body, false);
  });

  it('extracts a default abstract class exactly once', (): void => {
    const source = sourceLines(
      'export default abstract class Service {',
      '  abstract run(): Effect.Effect<void>;',
      '}',
    );
    const body = sourceLines('{', '  abstract run(): Effect.Effect<void>;', '}');

    expectSingleExportProjection(source, body, false);
  });

  it.each([
    {
      name: 'named generic',
      segment: ' Effect.succeed(value);',
      source:
        'export const load = <Value extends ReadonlyArray<Result<Option<number>>>>(value: Value) => Effect.succeed(value);',
    },
    {
      name: 'default generic',
      segment: ' Effect.succeed(value);',
      source:
        'export default <Value extends ReadonlyArray<Result<Option<number>>>>(value: Value) => Effect.succeed(value);',
    },
    {
      name: 'async generic',
      segment: ' Effect.succeed(value);',
      source:
        'export const load = async <Value extends ReadonlyArray<Result<Option<number>>>>(value: Value) => Effect.succeed(value);',
    },
  ])('projects a $name arrow after its outer arrow token', ({ segment, source }): void => {
    expectSingleExportProjection(source, segment, true);
  });

  it('ignores nested arrows inside a default parameter when locating the outer arrow', (): void => {
    const source =
      'export const load = (transform = (value: number) => (nested: number) => value + nested) => Effect.succeed(transform);';

    expectSingleExportProjection(source, ' Effect.succeed(transform);', true);
  });

  it.each([
    {
      segment: ' Effect.succeed({ id, active });',
      source:
        'export const load = ({ id, meta: { active } }: User) => Effect.succeed({ id, active });',
    },
    {
      segment: ' Effect.succeed(first);',
      source: 'export default ([first, ...rest]: readonly number[]) => Effect.succeed(first);',
    },
  ])('supports destructured and typed arrow parameters', ({ segment, source }): void => {
    expectSingleExportProjection(source, segment, true);
  });
});

describe('Effect exported declaration downstream diagnostics', (): void => {
  it('keeps runPromise and Effect.fn diagnostics visible after an object return type', (): void => {
    const runPromiseSource = sourceLines(
      'export function execute(): Promise<{ readonly value: number }> {',
      '  return Effect.runPromise(Effect.succeed({ value: 1 }));',
      '}',
    );
    const effectSource = sourceLines(
      'export function load(): Effect.Effect<{ readonly value: number }> {',
      '  return Effect.succeed({ value: 1 });',
      '}',
    );

    expect(hasPromiseReturningPublicAPI(runPromiseSource)).toBe(true);
    expect(hasExportedRunPromiseAPI(runPromiseSource)).toBe(true);
    expect(runRule('effect-no-runpromise-in-exported-api', runPromiseSource)).toHaveLength(1);
    expect(runRule('effect-prefer-effect-fn-for-exported-effects', effectSource)).toHaveLength(1);
  });

  it('keeps class Promise and runPromise diagnostics visible after Schema.Class fields', (): void => {
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
    expect(hasExportedRunPromiseAPI(source)).toBe(true);
    expect(runRule('effect-no-runpromise-in-exported-api', source)).toHaveLength(1);
  });
});
