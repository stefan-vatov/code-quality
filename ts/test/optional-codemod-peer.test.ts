import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const packageRoot = join(import.meta.dirname, '..');

type PackageManifest = {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
};

const readManifest = (): PackageManifest =>
  JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as PackageManifest;

describe('jscodeshift optional peer manifest', (): void => {
  it('keeps jscodeshift out of runtime dependencies', (): void => {
    expect(readManifest().dependencies).not.toHaveProperty('jscodeshift');
  });

  it('declares jscodeshift as an optional peer dependency', (): void => {
    const manifest = readManifest();
    expect(manifest.peerDependencies?.['jscodeshift']).toBe('^17.4.0');
    expect(manifest.peerDependenciesMeta?.['jscodeshift']?.optional).toBe(true);
  });

  it('keeps jscodeshift available for local codemod development', (): void => {
    expect(readManifest().devDependencies?.['jscodeshift']).toBe('^17.4.0');
  });
});
