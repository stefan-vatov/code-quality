import { execFileSync, spawnSync } from 'node:child_process';
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const repoRoot = join(import.meta.dirname, '..', '..');
const packageRoot = join(repoRoot, 'ts');
const testTimeoutMs = 60_000;
const lintRuntimePackages = ['effect', '@oxlint/plugins', 'oxlint'] as const;

type PackageManifest = {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
};

const readManifest = (): PackageManifest =>
  JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as PackageManifest;

const linkPackage = (consumerRoot: string, name: string): void => {
  const target = join(consumerRoot, 'node_modules', name);
  mkdirSync(join(target, '..'), { recursive: true });
  symlinkSync(realpathSync(join(packageRoot, 'node_modules', name)), target, 'dir');
};

const createConsumer = (extraPackages: readonly string[]): string => {
  const consumerRoot = mkdtempSync(join(tmpdir(), 'thx-codemod-peer-'));
  const installedPackage = join(consumerRoot, 'node_modules', '@thethracian', 'oxlint-config');
  mkdirSync(installedPackage, { recursive: true });
  cpSync(join(packageRoot, 'dist'), join(installedPackage, 'dist'), { recursive: true });
  cpSync(join(packageRoot, 'package.json'), join(installedPackage, 'package.json'));
  for (const name of [...lintRuntimePackages, ...extraPackages]) {
    linkPackage(consumerRoot, name);
  }
  mkdirSync(join(consumerRoot, 'src'));
  writeFileSync(join(consumerRoot, 'src', 'clean.ts'), 'export const value = 1;\n');
  return consumerRoot;
};

const cliPath = (consumerRoot: string): string =>
  join(
    consumerRoot,
    'node_modules',
    '@thethracian',
    'oxlint-config',
    'dist',
    'codemod-fix',
    'cli.js',
  );

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

describe('consumer install without jscodeshift', (): void => {
  let consumerRoot = '';

  beforeAll((): void => {
    execFileSync('pnpm', ['--dir', 'ts', 'build'], { cwd: repoRoot, stdio: 'pipe' });
    consumerRoot = createConsumer([]);
  }, testTimeoutMs);

  afterAll((): void => {
    rmSync(consumerRoot, { force: true, recursive: true });
  });

  it(
    'imports the lint config factory',
    (): void => {
      const consumerPath = join(consumerRoot, 'consumer.mjs');
      writeFileSync(
        consumerPath,
        `import factory from '@thethracian/oxlint-config';
const config = factory({ effect: true });
process.stdout.write(String(Object.keys(config.rules ?? {}).length) + '\\n');
`,
      );
      const output = execFileSync('node', [consumerPath], { cwd: consumerRoot, encoding: 'utf8' });
      expect(output).toMatch(/^[1-9][0-9]*\n$/u);
    },
    testTimeoutMs,
  );

  it(
    'fails thx-codemod-fix with an install hint instead of a module resolution crash',
    (): void => {
      const result = spawnSync('node', [cliPath(consumerRoot), 'src'], {
        cwd: consumerRoot,
        encoding: 'utf8',
        env: { ...process.env, NODE_PATH: '' },
      });
      expect(result.status).toBe(1);
      expect(result.stdout).toBe('');
      expect(result.stderr).toBe(
        'thx-codemod-fix requires the optional peer dependency jscodeshift.\n' +
          'Install it with: npm install --save-dev jscodeshift@^17.4.0\n',
      );
    },
    testTimeoutMs,
  );

  it(
    'ignores CommonJS-only NODE_PATH copies that ESM imports cannot load',
    (): void => {
      const result = spawnSync('node', [cliPath(consumerRoot), 'src'], {
        cwd: consumerRoot,
        encoding: 'utf8',
        env: { ...process.env, NODE_PATH: join(packageRoot, 'node_modules') },
      });
      expect(result.status).toBe(1);
      expect(result.stderr).toBe(
        'thx-codemod-fix requires the optional peer dependency jscodeshift.\n' +
          'Install it with: npm install --save-dev jscodeshift@^17.4.0\n',
      );
    },
    testTimeoutMs,
  );

  it(
    'leaves source files untouched when jscodeshift is missing',
    (): void => {
      spawnSync('node', [cliPath(consumerRoot), 'src'], { cwd: consumerRoot, encoding: 'utf8' });
      expect(readFileSync(join(consumerRoot, 'src', 'clean.ts'), 'utf8')).toBe(
        'export const value = 1;\n',
      );
    },
    testTimeoutMs,
  );
});

describe('consumer install with jscodeshift', (): void => {
  let consumerRoot = '';

  beforeAll((): void => {
    execFileSync('pnpm', ['--dir', 'ts', 'build'], { cwd: repoRoot, stdio: 'pipe' });
    consumerRoot = createConsumer(['jscodeshift']);
  }, testTimeoutMs);

  afterAll((): void => {
    rmSync(consumerRoot, { force: true, recursive: true });
  });

  it(
    'runs thx-codemod-fix in dry-run mode',
    (): void => {
      const result = spawnSync('node', [cliPath(consumerRoot), '--dry-run', 'src'], {
        cwd: consumerRoot,
        encoding: 'utf8',
      });
      expect(result.stderr).toBe('');
      expect(result.status).toBe(0);
      expect(result.stdout).toBe(
        'Would apply The Thracian codemod fixes to 0 file(s); scanned 1 file(s).\n',
      );
    },
    testTimeoutMs,
  );
});
