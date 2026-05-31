import { describe, expect, it } from 'vitest';
import { inlineLocalExportLists } from '../../src/codemods/inline-export-lists';

describe('inlineLocalExportLists', (): void => {
  it('moves simple local export lists onto declarations', (): void => {
    const source = `const alpha = 1;
function beta() {
  return alpha;
}

export { alpha, beta };
`;

    expect(inlineLocalExportLists(source)).toBe(`export const alpha = 1;
export function beta() {
  return alpha;
}

`);
  });

  it('keeps re-export lists unchanged', (): void => {
    const source = "export { alpha } from './alpha';\n";

    expect(inlineLocalExportLists(source)).toBe(source);
  });

  it('moves local type export lists onto type declarations', (): void => {
    const source = `interface Options {
  readonly enabled: boolean;
}
type Result = string;

export type { Options, Result };
`;

    expect(inlineLocalExportLists(source)).toBe(`export interface Options {
  readonly enabled: boolean;
}
export type Result = string;

`);
  });

  it('removes mixed local export lists after declarations are already exported', (): void => {
    const source = `export interface Options {
  readonly enabled: boolean;
}
export const run = (): void => {};

export {
  run,
  type Options,
};
`;

    expect(inlineLocalExportLists(source)).toBe(`export interface Options {
  readonly enabled: boolean;
}
export const run = (): void => {};

`);
  });

  it('leaves aliased local export lists unchanged because they need human API intent', (): void => {
    const source = 'const internalName = 1;\nexport { internalName as publicName };\n';

    expect(inlineLocalExportLists(source)).toBe(source);
  });

  it('leaves partial multi-declarator exports unchanged because inlining would export extra names', (): void => {
    const source = `const alpha = 1, beta = 2;

export { alpha };
`;

    expect(inlineLocalExportLists(source)).toBe(source);
  });
});
