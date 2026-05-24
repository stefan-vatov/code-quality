import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const pluginPath = fileURLToPath(new URL('../../src/rules/plugin.ts', import.meta.url));
const packagePath = fileURLToPath(new URL('../../package.json', import.meta.url));

describe('Oxlint JS plugin performance API', () => {
  it('wraps the published plugin with Oxlint eslintCompatPlugin', () => {
    const source = readFileSync(pluginPath, 'utf-8');

    expect(source).toContain("from '@oxlint/plugins'");
    expect(source).toContain('eslintCompatPlugin');
  });

  it('uses createOnce for first-party non-Effect rules in the plugin module', () => {
    const source = readFileSync(pluginPath, 'utf-8');

    expect(source).toContain('createOnce(context: Context)');
    expect(source).not.toContain('create(context: Context)');
  });

  it('ships Oxlint plugin utilities as a runtime dependency', () => {
    const packageJson = JSON.parse(readFileSync(packagePath, 'utf-8')) as {
      dependencies?: Record<string, string>;
    };

    expect(packageJson.dependencies?.['@oxlint/plugins']).toBeDefined();
  });

  it('ships the type-aware Oxlint runner as a runtime dependency', () => {
    const packageJson = JSON.parse(readFileSync(packagePath, 'utf-8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
      peerDependenciesMeta?: Record<string, { optional?: boolean }>;
    };

    expect(packageJson.dependencies?.['oxlint-tsgolint']).toBeDefined();
    expect(packageJson.devDependencies?.oxlint).toBeDefined();
    expect(packageJson.peerDependencies?.oxlint).toBeDefined();
    expect(packageJson.peerDependenciesMeta?.['oxlint-tsgolint']?.optional).not.toBe(true);
  });

  it('does not ship a JavaScript complexity plugin when Oxlint has a native complexity rule', () => {
    const packageJson = JSON.parse(readFileSync(packagePath, 'utf-8')) as {
      dependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
    };

    expect(packageJson.dependencies?.['oxlint-plugin-complexity']).toBeUndefined();
    expect(packageJson.peerDependencies?.['oxlint-plugin-complexity']).toBeUndefined();
  });
});
