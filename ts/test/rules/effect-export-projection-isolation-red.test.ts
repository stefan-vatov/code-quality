import { describe, expect, it } from 'vitest';
import {
  exportedCallableDeclarationSegments,
  exportedDeclarationSegments,
  exportedDeclarationTexts,
} from '../../src/rules/effect-exported-declarations';
import {
  hasExportedRunPromiseAPI,
  hasPromiseReturningPublicAPI,
} from '../../src/rules/effect-strict-internals';
import { runRule } from './effect-rule-test-utils';

const sourceLines = (...lines: string[]): string => lines.join('\n');

interface DownstreamCounts {
  readonly effectFn: number;
  readonly promise: number;
  readonly runPromise: number;
}

const expectProjection = (
  source: string,
  declarations: readonly string[],
  segments: readonly string[],
  callableSegments: readonly string[],
): void => {
  expect.soft(exportedDeclarationTexts(source)).toEqual(declarations);
  expect.soft(exportedDeclarationSegments(source)).toEqual(segments);
  expect.soft(exportedCallableDeclarationSegments(source)).toEqual(callableSegments);
};

const expectDownstreamCounts = (source: string, expected: DownstreamCounts): void => {
  expect.soft(hasPromiseReturningPublicAPI(source)).toBe(expected.promise > 0);
  expect.soft(hasExportedRunPromiseAPI(source)).toBe(expected.runPromise > 0);
  expect
    .soft(runRule('effect-no-promise-returning-public-api', source))
    .toHaveLength(expected.promise);
  expect
    .soft(runRule('effect-no-runpromise-in-exported-api', source))
    .toHaveLength(expected.runPromise);
  expect
    .soft(runRule('effect-prefer-effect-fn-for-exported-effects', source))
    .toHaveLength(expected.effectFn);
};

const privateSiblingCounts = {
  effectFn: 1,
  promise: 0,
  runPromise: 0,
} as const;

describe('Effect export-list declarator isolation', (): void => {
  it('does not project a private Promise arrow after the exported declarator', (): void => {
    const declaration = 'const publicLoad = () => Effect.succeed(publicProgram);';
    const source = sourceLines(
      'const publicLoad = () => Effect.succeed(publicProgram), privateLoad = async (): Promise<void> => Effect.runPromise(privateProgram);',
      'export { publicLoad };',
    );

    expectProjection(
      source,
      [declaration],
      [' Effect.succeed(publicProgram);'],
      [' Effect.succeed(publicProgram);'],
    );
    expectDownstreamCounts(source, privateSiblingCounts);
  });

  it('does not project a private Promise arrow before the exported declarator', (): void => {
    const declaration = 'const publicLoad = () => Effect.succeed(publicProgram);';
    const source = sourceLines(
      'const privateLoad = async (): Promise<void> => Effect.runPromise(privateProgram), publicLoad = () => Effect.succeed(publicProgram);',
      'export { publicLoad };',
    );

    expectProjection(
      source,
      [declaration],
      [' Effect.succeed(publicProgram);'],
      [' Effect.succeed(publicProgram);'],
    );
    expectDownstreamCounts(source, privateSiblingCounts);
  });

  it('retains a later exported Promise arrow as a positive control', (): void => {
    const declaration =
      'const publicLoad = async (): Promise<void> => Effect.runPromise(publicProgram);';
    const source = sourceLines(
      'const privateLoad = () => Effect.succeed(privateProgram), publicLoad = async (): Promise<void> => Effect.runPromise(publicProgram);',
      'export { publicLoad };',
    );

    expectProjection(
      source,
      [declaration],
      [' Effect.runPromise(publicProgram);'],
      [' Effect.runPromise(publicProgram);'],
    );
    expectDownstreamCounts(source, { effectFn: 0, promise: 1, runPromise: 1 });
  });
});

describe('Effect export-list binding identity', (): void => {
  it('does not invent a value binding from a comma inside generic arguments', (): void => {
    const declaration = 'type PublicLoad = { readonly value: number };';
    const source = sourceLines(
      declaration,
      'const privateValue = factory<Failure, PublicLoad>(() => Effect.runPromise(privateProgram));',
      'export type { PublicLoad };',
    );

    expectProjection(source, [declaration], ['{ readonly value: number };'], []);
    expectDownstreamCounts(source, { effectFn: 0, promise: 0, runPromise: 0 });
  });

  it('keeps an aliased object-destructured export as a positive control', (): void => {
    const declaration = 'const { load: publicLoad } = api;';
    const source = sourceLines(declaration, 'export { publicLoad as load };');

    expectProjection(source, [declaration], [' api;'], []);
    expectDownstreamCounts(source, { effectFn: 0, promise: 0, runPromise: 0 });
  });

  it('keeps an array-destructured export as a positive control', (): void => {
    const declaration = 'const [publicLoad] = api;';
    const source = sourceLines(declaration, 'export { publicLoad };');

    expectProjection(source, [declaration], [' api;'], []);
    expectDownstreamCounts(source, { effectFn: 0, promise: 0, runPromise: 0 });
  });
});

describe('Effect export-list overload and generator resolution', (): void => {
  it('resolves a local overload group through its implementation', (): void => {
    const firstSignature = 'function load(value: string): Promise<void>;';
    const secondSignature = 'function load(value: number): Promise<void>;';
    const implementation = sourceLines(
      'function load(value: string | number): Promise<void> {',
      '  return Effect.runPromise(program);',
      '}',
    );
    const body = sourceLines('{', '  return Effect.runPromise(program);', '}');
    const source = sourceLines(firstSignature, secondSignature, implementation, 'export { load };');

    expectProjection(
      source,
      [firstSignature, secondSignature, implementation],
      [firstSignature, secondSignature, body],
      [body],
    );
    expectDownstreamCounts(source, { effectFn: 0, promise: 1, runPromise: 1 });
  });

  it('resolves a local generator declaration through an export list', (): void => {
    const declaration = sourceLines(
      'function* load() {',
      '  yield Effect.runPromise(program);',
      '}',
    );
    const body = sourceLines('{', '  yield Effect.runPromise(program);', '}');
    const source = sourceLines(declaration, 'export { load };');

    expectProjection(source, [declaration], [body], [body]);
    expectDownstreamCounts(source, { effectFn: 0, promise: 0, runPromise: 1 });
  });
});

describe('Effect default identifier wrappers', (): void => {
  it.each([
    ['a parenthesized identifier', '(publicLoad)'],
    ['a satisfies expression', 'publicLoad satisfies PublicLoader'],
    ['a parenthesized satisfies expression', '(publicLoad satisfies PublicLoader)'],
  ])('resolves %s to its module binding', (_name, exportedExpression): void => {
    const declaration =
      'const publicLoad = async (): Promise<void> => Effect.runPromise(publicProgram);';
    const source = sourceLines(declaration, `export default ${exportedExpression};`);

    expectProjection(
      source,
      [declaration],
      [' Effect.runPromise(publicProgram);'],
      [' Effect.runPromise(publicProgram);'],
    );
    expectDownstreamCounts(source, { effectFn: 0, promise: 1, runPromise: 1 });
  });
});
