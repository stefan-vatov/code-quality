import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { describe, expect, it } from 'vitest';

const codemodFiles = [
  'ts/src/codemods/arrow-body-style.ts',
  'ts/src/codemods/explicit-return-types.ts',
  'ts/src/codemods/function-declarations.ts',
  'ts/src/codemods/inline-export-lists.ts',
  'ts/src/codemods/internal-export-docs.ts',
  'ts/src/codemods/no-ternary-branch-initializers.ts',
  'ts/src/codemods/no-ternary.ts',
  'ts/src/codemods/no-ternary-variable-initializers.ts',
  'ts/src/codemods/rename-acronyms.ts',
  'ts/src/codemods/sort-imports.ts',
] as const;

describe('jscodeshift codemod architecture', () => {
  it.each(codemodFiles)('%s uses jscodeshift instead of the TypeScript compiler API', (path) => {
    const source = readFileSync(path, 'utf8');

    expect(source, basename(path)).toContain("from 'jscodeshift'");
    expect(source, basename(path)).not.toContain("from 'typescript'");
    expect(source, basename(path)).not.toContain('ts.createSourceFile');
    expect(source, basename(path)).not.toContain('ts.forEachChild');
  });

  it('publishes jscodeshift as a runtime dependency for consumer CLI execution', () => {
    const packageJson = JSON.parse(readFileSync('ts/package.json', 'utf8')) as {
      dependencies?: Record<string, string>;
    };

    expect(packageJson.dependencies).toHaveProperty('jscodeshift');
  });
});
