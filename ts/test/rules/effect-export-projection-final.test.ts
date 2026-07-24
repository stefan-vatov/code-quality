import { describe, expect, it } from 'vitest';
import {
  exportedCallableDeclarationSegments,
  exportedDeclarationTexts,
} from '../../src/rules/effect-exported-declarations';
import {
  hasExportedRunPromiseAPI,
  hasPromiseReturningPublicAPI,
} from '../../src/rules/effect-strict-internals';
import { runRule } from './effect-rule-test-utils';

const sourceLines = (...lines: string[]): string => lines.join('\n');

const expectPublicPromiseDiagnostics = (
  source: string,
  expectedRunPromiseDiagnostics: number,
): void => {
  expect(hasPromiseReturningPublicAPI(source)).toBe(true);
  expect(hasExportedRunPromiseAPI(source)).toBe(expectedRunPromiseDiagnostics > 0);
  expect(runRule('effect-no-promise-returning-public-api', source)).toHaveLength(1);
  expect(runRule('effect-no-runpromise-in-exported-api', source)).toHaveLength(
    expectedRunPromiseDiagnostics,
  );
};

const expectNoPublicEffectDiagnostics = (source: string): void => {
  expect(hasPromiseReturningPublicAPI(source)).toBe(false);
  expect(hasExportedRunPromiseAPI(source)).toBe(false);
  expect(runRule('effect-no-promise-returning-public-api', source)).toHaveLength(0);
  expect(runRule('effect-no-runpromise-in-exported-api', source)).toHaveLength(0);
  expect(runRule('effect-prefer-effect-fn-for-exported-effects', source)).toHaveLength(0);
};

describe('Effect default-export binding projection', (): void => {
  it('resolves a default-exported identifier to its module binding', (): void => {
    const declaration = 'const load=async (): Promise<void> => Effect.runPromise(program);';
    const source = sourceLines(declaration, 'export default load;');

    expect(exportedDeclarationTexts(source)).toEqual([declaration]);
    expect(exportedCallableDeclarationSegments(source)).toEqual([' Effect.runPromise(program);']);
    expectPublicPromiseDiagnostics(source, 1);
  });

  it('keeps a harmless default-exported identifier non-callable', (): void => {
    const declaration = 'const version = 1;';
    const source = sourceLines(
      declaration,
      'const internal = () => Effect.runPromise(program);',
      'export default version;',
    );

    expect(exportedDeclarationTexts(source)).toEqual([declaration]);
    expect(exportedCallableDeclarationSegments(source)).toEqual([]);
    expectNoPublicEffectDiagnostics(source);
  });

  it('preserves the Effect.fn diagnostic for a default-exported Effect function', (): void => {
    const declaration = 'const load = () => Effect.succeed(program);';
    const source = sourceLines(declaration, 'export default load;');

    expect(exportedDeclarationTexts(source)).toEqual([declaration]);
    expect(exportedCallableDeclarationSegments(source)).toEqual([' Effect.succeed(program);']);
    expect(runRule('effect-prefer-effect-fn-for-exported-effects', source)).toHaveLength(1);
  });
});

describe('Effect export-list variable binding projection', (): void => {
  it('discovers a later declarator in one variable statement', (): void => {
    const declaration = 'const harmless=1, load=(): Promise<void> => Effect.runPromise(program);';
    const source = sourceLines(declaration, 'export { load };');

    expect(exportedDeclarationTexts(source)).toEqual([declaration]);
    expect(exportedCallableDeclarationSegments(source)).toEqual([' Effect.runPromise(program);']);
    expectPublicPromiseDiagnostics(source, 1);
  });

  it('discovers every requested later declarator without duplicating its statement', (): void => {
    const declaration =
      'const harmless=1, load=(): Promise<void> => Effect.runPromise(program), save=(): Effect.Effect<void> => Effect.void;';
    const source = sourceLines(declaration, 'export { load, save };');

    expect(exportedDeclarationTexts(source)).toEqual([declaration]);
    expectPublicPromiseDiagnostics(source, 1);
  });

  it('resolves an object-destructured export binding', (): void => {
    const declaration = 'const { load } = api;';
    const source = sourceLines(declaration, 'export { load };');

    expect(exportedDeclarationTexts(source)).toEqual([declaration]);
    expect(exportedCallableDeclarationSegments(source)).toEqual([]);
    expectNoPublicEffectDiagnostics(source);
  });

  it('resolves an aliased object-destructured export binding', (): void => {
    const declaration = 'const { load: execute } = api;';
    const source = sourceLines(declaration, 'export { execute as load };');

    expect(exportedDeclarationTexts(source)).toEqual([declaration]);
    expect(exportedCallableDeclarationSegments(source)).toEqual([]);
  });

  it('resolves an array-destructured export binding', (): void => {
    const declaration = 'const [load] = api;';
    const source = sourceLines(declaration, 'export { load };');

    expect(exportedDeclarationTexts(source)).toEqual([declaration]);
    expect(exportedCallableDeclarationSegments(source)).toEqual([]);
    expectNoPublicEffectDiagnostics(source);
  });
});

describe('Effect semicolonless export projection', (): void => {
  it.each([
    ['a following call', 'Effect.runPromise(program)'],
    ['a following void statement', 'void Effect.runPromise(program)'],
  ])('stops before %s', (_name, followingStatement): void => {
    const declaration = 'export const version=1';
    const source = sourceLines(declaration, followingStatement);

    expect(exportedDeclarationTexts(source)).toEqual([declaration]);
    expect(exportedCallableDeclarationSegments(source)).toEqual([]);
    expectNoPublicEffectDiagnostics(source);
  });

  it('stops before a decorated internal class', (): void => {
    const declaration = 'export const version=1';
    const source = sourceLines(declaration, '@Effect.runPromise(program)', 'class Internal {}');

    expect(exportedDeclarationTexts(source)).toEqual([declaration]);
    expect(exportedCallableDeclarationSegments(source)).toEqual([]);
    expectNoPublicEffectDiagnostics(source);
  });
});

describe('Effect ambient and overload projection', (): void => {
  it('discovers a direct exported ambient function signature', (): void => {
    const declaration = 'export declare function load(): Promise<void>;';

    expect(exportedDeclarationTexts(declaration)).toEqual([declaration]);
    expect(exportedCallableDeclarationSegments(declaration)).toEqual([]);
    expectPublicPromiseDiagnostics(declaration, 0);
  });

  it('discovers a direct exported ambient const signature', (): void => {
    const declaration = 'export declare const load: () => Promise<void>;';

    expect(exportedDeclarationTexts(declaration)).toEqual([declaration]);
    expect(exportedCallableDeclarationSegments(declaration)).toEqual([]);
    expectPublicPromiseDiagnostics(declaration, 0);
  });

  it('keeps an ambient Effect declaration out of the Effect.fn implementation rule', (): void => {
    const declaration = 'export declare const load: () => Effect.Effect<void>;';

    expect(exportedDeclarationTexts(declaration)).toEqual([declaration]);
    expect(exportedCallableDeclarationSegments(declaration)).toEqual([]);
    expect(runRule('effect-prefer-effect-fn-for-exported-effects', declaration)).toHaveLength(0);
  });

  it('projects overload signatures and their implementation without following internals', (): void => {
    const firstSignature = 'export function load(value: string): Promise<void>;';
    const secondSignature = 'export function load(value: number): Promise<void>;';
    const implementation = sourceLines(
      'export function load(value: string | number): Promise<void> {',
      '  return Effect.runPromise(program);',
      '}',
    );
    const source = sourceLines(
      firstSignature,
      secondSignature,
      implementation,
      'function internal() {',
      '  return Effect.runPromise(internalProgram);',
      '}',
    );

    expect(exportedDeclarationTexts(source)).toEqual([
      firstSignature,
      secondSignature,
      implementation,
    ]);
    expect(exportedCallableDeclarationSegments(source)).toEqual([
      sourceLines('{', '  return Effect.runPromise(program);', '}'),
    ]);
    expectPublicPromiseDiagnostics(source, 1);
  });

  it('does not absorb a live internal body after an ambient signature', (): void => {
    const declaration = 'export declare function load(): Promise<void>;';
    const source = sourceLines(
      declaration,
      'function internal() {',
      '  return Effect.runPromise(program);',
      '}',
    );

    expect(exportedDeclarationTexts(source)).toEqual([declaration]);
    expect(exportedCallableDeclarationSegments(source)).toEqual([]);
    expectPublicPromiseDiagnostics(source, 0);
  });
});
