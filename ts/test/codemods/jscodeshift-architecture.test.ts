import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Schema } from 'effect';

const codemodFiles = [
  'ts/src/codemod-fix/internal/arrow-body-style.ts',
  'ts/src/codemod-fix/internal/explicit-return-types.ts',
  'ts/src/codemod-fix/internal/function-declarations.ts',
  'ts/src/codemod-fix/internal/inline-export-lists.ts',
  'ts/src/codemod-fix/internal/internal-export-docs.ts',
  'ts/src/codemod-fix/internal/no-ternary-branch-initializers.ts',
  'ts/src/codemod-fix/internal/no-ternary.ts',
  'ts/src/codemod-fix/internal/no-ternary-variable-initializers.ts',
  'ts/src/codemod-fix/internal/sort-imports.ts',
] as const;

describe('jscodeshift codemod architecture', () => {
  it.each(codemodFiles)('%s uses jscodeshift instead of the TypeScript compiler API', (path) => {
    const source = readFileSync(path, 'utf8');

    expect(source, basename(path)).toContain("from 'jscodeshift'");
    expect(source, basename(path)).not.toContain("from 'typescript'");
    expect(source, basename(path)).not.toContain('ts.createSourceFile');
    expect(source, basename(path)).not.toContain('ts.forEachChild');
  });

  it('leaves jscodeshift for consumers to install before running the codemod CLI', () => {
    const packageJson = Schema.decodeUnknownSync(
      Schema.parseJson(
        Schema.Struct({
          dependencies: Schema.Record({ key: Schema.String, value: Schema.String }),
          peerDependencies: Schema.Record({ key: Schema.String, value: Schema.String }),
        }),
      ),
    )(readFileSync('ts/package.json', 'utf8'));

    expect(packageJson.dependencies).not.toHaveProperty('jscodeshift');
    expect(packageJson.peerDependencies).not.toHaveProperty('jscodeshift');
  });
});
