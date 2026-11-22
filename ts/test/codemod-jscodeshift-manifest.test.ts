import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const packageRoot = join(import.meta.dirname, '..');
const repoRoot = join(packageRoot, '..');

type PackageManifest = {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
};

const readManifest = (root: string): PackageManifest =>
  JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as PackageManifest;

describe('published manifest keeps jscodeshift out of dependency scans', (): void => {
  it('keeps jscodeshift out of runtime dependencies', (): void => {
    expect(readManifest(packageRoot).dependencies).not.toHaveProperty('jscodeshift');
  });

  it('does not declare jscodeshift as a peer dependency', (): void => {
    const manifest = readManifest(packageRoot);
    expect(manifest.peerDependencies).not.toHaveProperty('jscodeshift');
    expect(manifest).not.toHaveProperty('peerDependenciesMeta');
  });

  it('publishes no devDependencies', (): void => {
    expect(readManifest(packageRoot)).not.toHaveProperty('devDependencies');
  });

  it('keeps jscodeshift available to the workspace for local codemod development', (): void => {
    expect(readManifest(repoRoot).devDependencies?.['jscodeshift']).toBe('^17.4.0');
  });
});
