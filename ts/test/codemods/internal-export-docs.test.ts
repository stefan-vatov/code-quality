import { describe, expect, it } from 'vitest';
import { addInternalExportDocs } from '../../src/codemods/internal-export-docs';

describe('addInternalExportDocs', () => {
  it('adds internal JSDoc to exported declarations in internal files', () => {
    const source = `/** @internal Helper module. */
export const value = 1;

export function run(): void {}
`;

    expect(addInternalExportDocs(source)).toBe(`/** @internal Helper module. */
/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const value = 1;

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export function run(): void {}
`);
  });

  it('keeps existing exported declaration docs unchanged', () => {
    const source = `/** @internal Helper module. */
/** Existing purpose.
 *
 * @internal
 */
export const value = 1;
`;

    expect(addInternalExportDocs(source)).toBe(source);
  });

  it('does not add internal docs to public files', () => {
    const source = `/** Public API. */
export const value = 1;
`;

    expect(addInternalExportDocs(source)).toBe(source);
  });
});
