import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import plugin from '../../src/rules/plugin';

const pluginPath = fileURLToPath(new URL('../../src/rules/plugin.ts', import.meta.url));
const packagePath = fileURLToPath(new URL('../../package.json', import.meta.url));

describe('Oxlint JS plugin performance API', () => {
  it('wraps the published plugin with Oxlint eslintCompatPlugin', () => {
    const source = readFileSync(pluginPath, 'utf-8');

    expect(source).toContain("from '@oxlint/plugins'");
    expect(source).toContain('eslintCompatPlugin');
  });

  it('uses createOnce for every published generic safety rule', () => {
    const genericRules = Object.entries(plugin.rules ?? {}).filter(
      ([name]) => !name.startsWith('effect-') && name !== 'no-service-constructor-imports',
    );

    expect(genericRules).toHaveLength(15);
    for (const [name, rule] of genericRules) {
      expect(rule, name).toHaveProperty('createOnce', expect.any(Function));
    }
  });

  it('ships Oxlint plugin utilities as a runtime dependency', () => {
    // SAFETY: this repository-owned package manifest uses npm's string dependency maps;
    // optional fields preserve the missing-dependency behavior checked below.
    const packageJson = JSON.parse(readFileSync(packagePath, 'utf-8')) as {
      dependencies?: Record<string, string>;
    };

    expect(packageJson.dependencies?.['@oxlint/plugins']).toBeDefined();
  });

  it('ships the type-aware Oxlint runner as a runtime dependency', () => {
    // SAFETY: this repository-owned npm manifest has string dependency maps and
    // boolean optional-peer metadata; all inspected sections remain optional.
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
    // SAFETY: the repository-owned npm manifest declares dependency versions as
    // strings; optional fields preserve the absent-package checks below.
    const packageJson = JSON.parse(readFileSync(packagePath, 'utf-8')) as {
      dependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
    };

    expect(packageJson.dependencies?.['oxlint-plugin-complexity']).toBeUndefined();
    expect(packageJson.peerDependencies?.['oxlint-plugin-complexity']).toBeUndefined();
  });
});
