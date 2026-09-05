import { describe, expect, it } from 'vitest';
import { exportedDeclarationTexts } from '../../src/rules/effect-exported-declarations';

const sourceLines = (...lines: string[]): string => lines.join('\n');

const expectProjection = (source: string, declarations: readonly string[]): void => {
  expect.soft(exportedDeclarationTexts(source)).toEqual(declarations);
};

describe('Effect export-list declarator isolation', (): void => {
  it('does not project a private Promise arrow after the exported declarator', (): void => {
    const declaration = 'const publicLoad = () => Effect.succeed(publicProgram);';
    const source = sourceLines(
      'const publicLoad = () => Effect.succeed(publicProgram), privateLoad = async (): Promise<void> => Effect.runPromise(privateProgram);',
      'export { publicLoad };',
    );

    expectProjection(source, [declaration]);
  });

  it('does not project a private Promise arrow before the exported declarator', (): void => {
    const declaration = 'const publicLoad = () => Effect.succeed(publicProgram);';
    const source = sourceLines(
      'const privateLoad = async (): Promise<void> => Effect.runPromise(privateProgram), publicLoad = () => Effect.succeed(publicProgram);',
      'export { publicLoad };',
    );

    expectProjection(source, [declaration]);
  });

  it('retains a later exported Promise arrow as a positive control', (): void => {
    const declaration =
      'const publicLoad = async (): Promise<void> => Effect.runPromise(publicProgram);';
    const source = sourceLines(
      'const privateLoad = () => Effect.succeed(privateProgram), publicLoad = async (): Promise<void> => Effect.runPromise(publicProgram);',
      'export { publicLoad };',
    );

    expectProjection(source, [declaration]);
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

    expectProjection(source, [declaration]);
  });

  it('keeps an aliased object-destructured export as a positive control', (): void => {
    const declaration = 'const { load: publicLoad } = api;';
    const source = sourceLines(declaration, 'export { publicLoad as load };');

    expectProjection(source, [declaration]);
  });

  it('keeps an array-destructured export as a positive control', (): void => {
    const declaration = 'const [publicLoad] = api;';
    const source = sourceLines(declaration, 'export { publicLoad };');

    expectProjection(source, [declaration]);
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
    const source = sourceLines(firstSignature, secondSignature, implementation, 'export { load };');

    expectProjection(source, [firstSignature, secondSignature, implementation]);
  });

  it('resolves a local generator declaration through an export list', (): void => {
    const declaration = sourceLines(
      'function* load() {',
      '  yield Effect.runPromise(program);',
      '}',
    );
    const source = sourceLines(declaration, 'export { load };');

    expectProjection(source, [declaration]);
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

    expectProjection(source, [declaration]);
  });
});
