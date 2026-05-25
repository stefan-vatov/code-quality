import { describe, expect, it } from 'vitest';
import { formatFileHeaderComment } from '../../src/codemods/format-file-header';

describe('formatFileHeaderComment', () => {
  it('formats the first file JSDoc as a divider module header', () => {
    const source = `/**
 * Conservative codemod for safe func-style declaration rewrites.
 *
 * @internal
 */
import ts from 'typescript';
`;

    expect(formatFileHeaderComment(source))
      .toBe(`/* -------------------------------------------------------------------------- */
/*       Conservative codemod for safe func-style declaration rewrites.       */
/* -------------------------------------------------------------------------- */
import ts from 'typescript';
`);
  });

  it('rewraps existing divider headers that have overlong text lines', () => {
    const source = `/* -------------------------------------------------------------------------- */
/* Detection heuristic for commented-out source code. Checks whether a comment text content looks like code rather than natural language. */
/* -------------------------------------------------------------------------- */
const value = 1;
`;

    expect(formatFileHeaderComment(source))
      .toBe(`/* -------------------------------------------------------------------------- */
/*    Detection heuristic for commented-out source code. Checks whether a     */
/*     Comment text content looks like code rather than natural language.     */
/* -------------------------------------------------------------------------- */
const value = 1;
`);
  });

  it('rewraps multi-line divider headers as one normalized module purpose', () => {
    const source = `/* -------------------------------------------------------------------------- */
/*    Detection heuristic for commented-out source code. Checks whether a     */
/* comment's text content looks like code rather than natural language. Uses  */
/* -------------------------------------------------------------------------- */
const value = 1;
`;

    expect(formatFileHeaderComment(source))
      .toBe(`/* -------------------------------------------------------------------------- */
/*    Detection heuristic for commented-out source code. Checks whether a     */
/* Comment's text content looks like code rather than natural language. Uses  */
/* -------------------------------------------------------------------------- */
const value = 1;
`);
  });

  it('keeps declaration JSDoc after imports unchanged', () => {
    const source = `import ts from 'typescript';

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const value = 1;
`;

    expect(formatFileHeaderComment(source)).toBe(source);
  });

  it('does not convert top-level declaration JSDoc for a default export', () => {
    const source = `/**
 * Count leading parent segments in an import path.
 */
export default function countImportDepth(path: string): number {
  return 0;
}
`;

    expect(formatFileHeaderComment(source)).toBe(source);
  });

  it('inserts a generated module header before top-level declaration JSDoc', () => {
    const source = `/**
 * Count leading parent segments in an import path.
 */
export default function countImportDepth(path: string): number {
  return 0;
}
`;

    expect(formatFileHeaderComment(source, 'Import-depth helper for parent path climbs.'))
      .toBe(`/* -------------------------------------------------------------------------- */
/*                Import-depth helper for parent path climbs.                 */
/* -------------------------------------------------------------------------- */
/**
 * Count leading parent segments in an import path.
 */
export default function countImportDepth(path: string): number {
  return 0;
}
`);
  });

  it('inserts a generated module header when no file header exists', () => {
    const source = `const value = 1;
`;

    expect(formatFileHeaderComment(source, 'Private-underscore rule helpers.'))
      .toBe(`/* -------------------------------------------------------------------------- */
/*                      Private-underscore rule helpers.                      */
/* -------------------------------------------------------------------------- */
const value = 1;
`);
  });

  it('preserves shebangs before module headers', () => {
    const source = `#!/usr/bin/env node
/**
 * CLI entry point for running The Thracian codemod fixes.
 *
 * @internal
 */
import { codemodFix } from './index';
`;

    expect(formatFileHeaderComment(source)).toBe(`#!/usr/bin/env node
/* -------------------------------------------------------------------------- */
/*          CLI entry point for running The Thracian codemod fixes.           */
/* -------------------------------------------------------------------------- */
import { codemodFix } from './index';
`);
  });
});
