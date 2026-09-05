import { describe, expect, it } from 'vitest';
import { exportedDeclarationTexts } from '../../src/rules/effect-exported-declarations';

const sourceLines = (...lines: string[]): string => lines.join('\n');

describe('Effect module export-list binding resolution', (): void => {
  it('resolves an export alias to its module binding after an earlier nested homonym', (): void => {
    const expectedDeclaration = 'const load = () => Effect.succeed(publicProgram);';
    const source = sourceLines(
      'function setup() {',
      '  const load = async () => Effect.runPromise(privateProgram);',
      '  return load;',
      '}',
      expectedDeclaration,
      'export { load as publicLoad };',
    );

    expect(exportedDeclarationTexts(source)).toEqual([expectedDeclaration]);
  });

  it('retains a module export when an earlier nested homonym is harmless', (): void => {
    const expectedDeclaration =
      'const load = async (): Promise<void> => Effect.runPromise(publicProgram);';
    const source = sourceLines(
      'function setup() {',
      '  const load = () => Effect.succeed(privateProgram);',
      '  return load;',
      '}',
      expectedDeclaration,
      'export { load };',
    );

    expect(exportedDeclarationTexts(source)).toEqual([expectedDeclaration]);
  });

  it('resolves through a nested block declaration with the same local name', (): void => {
    const expectedDeclaration =
      'function execute(): Promise<void> { return Effect.runPromise(program); }';
    const source = sourceLines(
      '{',
      '  function execute() { return Effect.succeed(privateProgram); }',
      '  void execute;',
      '}',
      expectedDeclaration,
      'export { execute as run };',
    );

    expect(exportedDeclarationTexts(source)).toEqual([expectedDeclaration]);
  });
});

describe('Effect namespace export boundaries', (): void => {
  it.each(['namespace', 'module'])(
    'ignores exports inside an unexported %s declaration',
    (declarationKind): void => {
      const source = sourceLines(
        `${declarationKind} Internal {`,
        '  export const load = async (): Promise<void> => Effect.runPromise(program);',
        '}',
      );

      expect(exportedDeclarationTexts(source)).toEqual([]);
    },
  );

  it('continues to diagnose a direct module export after an unexported namespace', (): void => {
    const expectedDeclaration =
      'export const load = async (): Promise<void> => Effect.runPromise(publicProgram);';
    const source = sourceLines(
      'namespace Internal {',
      '  export const load = () => Effect.succeed(privateProgram);',
      '}',
      expectedDeclaration,
    );

    expect(exportedDeclarationTexts(source)).toContain(expectedDeclaration);
  });
});

describe('Effect semicolonless exported declaration boundaries', (): void => {
  it('stops a direct exported const before following internal declarations', (): void => {
    const expectedDeclaration = 'export const version = 1';
    const source = sourceLines(
      expectedDeclaration,
      'const internalEffect = () => Effect.succeed(1)',
      'async function runInternal(): Promise<void> {',
      '  await Effect.runPromise(program)',
      '}',
    );

    expect(exportedDeclarationTexts(source)).toEqual([expectedDeclaration]);
  });

  it('stops an exported function at its closing brace before internal work', (): void => {
    const expectedDeclaration = sourceLines('export function version() {', '  return 1', '}');
    const source = sourceLines(
      expectedDeclaration,
      'async function runInternal(): Promise<void> {',
      '  await Effect.runPromise(program)',
      '}',
    );

    expect(exportedDeclarationTexts(source)).toEqual([expectedDeclaration]);
  });

  it('stops a semicolonless local binding selected by an export list', (): void => {
    const expectedDeclaration = 'const version = 1';
    const source = sourceLines(
      expectedDeclaration,
      'const internalEffect = () => Effect.succeed(1)',
      'async function runInternal(): Promise<void> {',
      '  await Effect.runPromise(program)',
      '}',
      'export { version }',
    );

    expect(exportedDeclarationTexts(source)).toEqual([expectedDeclaration]);
  });
});
