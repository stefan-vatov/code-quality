import { describe, expect, it } from 'vitest';
import { inlineLocalExportLists } from '../../src/codemods/inline-export-lists';

describe('inlineLocalExportLists', () => {
  it('moves simple local export lists onto declarations', () => {
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

  it('keeps re-export lists unchanged', () => {
    const source = "export { alpha } from './alpha';\n";

    expect(inlineLocalExportLists(source)).toBe(source);
  });

  it('moves local type export lists onto type declarations', () => {
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

  it('removes mixed local export lists after declarations are already exported', () => {
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

  it('leaves aliased local export lists unchanged because they need human API intent', () => {
    const source = 'const internalName = 1;\nexport { internalName as publicName };\n';

    expect(inlineLocalExportLists(source)).toBe(source);
  });
});
