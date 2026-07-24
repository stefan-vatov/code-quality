import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const rootPath = (path) => new URL(`../${path}`, import.meta.url);
const rootJSON = (path) => JSON.parse(readFileSync(rootPath(path), 'utf8'));
const rootText = (path) => readFileSync(rootPath(path), 'utf8');
const rootTextOrEmpty = (path) => (existsSync(rootPath(path)) ? rootText(path) : '');

const minimumPeerRuleIDs = [
  'thethracian/effect-no-global-fetch',
  'thethracian/effect-no-sync-for-promise',
  'thethracian/effect-prefer-map-over-flatMap-succeed',
  'thethracian/no-commented-out-code',
];

describe('Effect slice quality gate portability', () => {
  it('neutralizes inherited commit signing for every Git-backed test', () => {
    const temporaryRoot = mkdtempSync(join(tmpdir(), 'quality-gate-git-signing-'));
    const repository = join(temporaryRoot, 'repository');
    const inheritedConfig = join(temporaryRoot, 'inherited-gitconfig');

    try {
      mkdirSync(repository);
      writeFileSync(
        inheritedConfig,
        '[commit]\n\tgpgSign = true\n[gpg]\n\tprogram = /definitely/missing/gpg\n',
      );
      writeFileSync(join(repository, 'tracked.txt'), 'portable test commit\n');

      const git = (...arguments_) =>
        execFileSync('git', arguments_, {
          cwd: repository,
          encoding: 'utf8',
          env: {
            ...process.env,
            GIT_CONFIG_GLOBAL: inheritedConfig,
            GIT_CONFIG_NOSYSTEM: '1',
          },
          stdio: 'pipe',
        });

      git('init', '-b', 'main');
      git('config', 'user.name', 'Quality Gate Test');
      git('config', 'user.email', 'quality-gate@example.test');
      git('add', 'tracked.txt');

      expect(() => git('commit', '-m', 'test: verify portable git setup')).not.toThrow();
    } finally {
      rmSync(temporaryRoot, { force: true, recursive: true });
    }
  });

  it('defines one aggregate full quality gate', () => {
    const packageJSON = rootJSON('package.json');
    const qualityGate = packageJSON.scripts['quality:gate'] ?? '';

    expect(packageJSON.scripts['test:ci']).toBe(
      'vitest run --coverage --config vitest.config.mts --passWithNoTests',
    );
    for (const command of [
      'pnpm run lint:ci',
      'pnpm run lint:projects',
      'pnpm run knip:ci',
      'pnpm run check',
      'pnpm run test:projects',
      'pnpm run test:ci',
      'pnpm run build',
      'pnpm run performance:gate',
      'pnpm run test:oxlint-min-peer',
      'pnpm run test:mutation',
      'pnpm nx run-many -t pack',
    ]) {
      expect(qualityGate).toContain(command);
    }
  });

  it('keeps the aggregate quality gate running in persistent CI', () => {
    const workflow = rootText('.github/workflows/ci.yml');

    expect(workflow).toContain('quality-gate:');
    expect(workflow).toMatch(/name: ['"]?full quality gate['"]?/iu);
    expect(workflow).toContain('run: pnpm run quality:gate');
  });

  it('provides separate safe and invalid minimum-peer fixtures', () => {
    const safePath = 'ts/test/oxlint-min-peer/safe.ts';
    const invalidPath = 'ts/test/oxlint-min-peer/invalid.ts';

    expect(existsSync(rootPath(safePath))).toBe(true);
    expect(existsSync(rootPath(invalidPath))).toBe(true);
    expect(rootTextOrEmpty(safePath)).not.toBe('');
    expect(rootTextOrEmpty(invalidPath)).not.toBe('');
  });

  it('pins the minimum-peer package script to the behavioral verifier', () => {
    const packageJSON = rootJSON('package.json');

    expect(packageJSON.scripts['test:oxlint-min-peer']).toBe(
      'pnpm --dir ts build && node ts/test/oxlint-min-peer/verify.mjs',
    );
  });

  it('asserts exact JSON diagnostic rule IDs and counts at Oxlint 1.63.0', () => {
    const verifier = rootTextOrEmpty('ts/test/oxlint-min-peer/verify.mjs');

    expect(verifier).toContain('oxlint@1.63.0');
    expect(verifier).toMatch(/--format(?:=|['",\s]+)json/u);
    expect(verifier).toContain('JSON.parse');
    expect(verifier).toContain('diagnostics');
    expect(verifier).toContain('ruleId');
    expect(verifier).toContain('node:assert/strict');
    expect(verifier).toContain('deepStrictEqual');
    expect(verifier).toMatch(/diagnostics\.length/u);
    expect(verifier).toMatch(/assert\.(?:equal|strictEqual)\s*\(/u);

    for (const ruleID of minimumPeerRuleIDs) {
      expect(verifier).toContain(ruleID);
    }
  });

  it('runs safe minimum-peer fixing and asserts that it is a no-op', () => {
    const verifier = rootTextOrEmpty('ts/test/oxlint-min-peer/verify.mjs');

    expect(verifier).toContain('safe.ts');
    expect(verifier).toContain('--fix');
    expect(verifier).toContain('readFileSync');
    expect(verifier).toContain('beforeFix');
    expect(verifier).toContain('afterFix');
    expect(verifier).toMatch(/assert\.(?:equal|strictEqual)\s*\(\s*afterFix\s*,\s*beforeFix/u);
  });
});
