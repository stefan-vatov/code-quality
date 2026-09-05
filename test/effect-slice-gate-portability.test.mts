import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const rootPath = (path: string) => new URL(`../${path}`, import.meta.url);
const rootJSON = (path: string): { scripts: Record<string, string> } =>
  JSON.parse(readFileSync(rootPath(path), 'utf8')) as { scripts: Record<string, string> };
const rootText = (path: string) => readFileSync(rootPath(path), 'utf8');
const rootTextOrEmpty = (path: string) => (existsSync(rootPath(path)) ? rootText(path) : '');

const minimumPeerRuleIDs = [
  'thethracian/effect-no-floating-effect',
  'thethracian/effect-require-yield-star',
  'thethracian/effect-no-global-fetch',
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

      const git = (...arguments_: string[]) =>
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

  it('defines every repository quality gate used by CI', () => {
    const packageJSON = rootJSON('package.json');

    expect(packageJSON.scripts).toMatchObject({
      build: 'nx run-many -t build',
      check: 'nx run-many -t check',
      'knip:ci': 'knip --cache --strict',
      'lint:ci': 'pnpm run lint:local:type-aware && pnpm run format:check',
      'lint:policy': 'pnpm --dir ts build && node scripts/check-effective-oxlint-policy.mjs',
      'test:oxlint-min-peer': 'pnpm --dir ts build && node ts/test/oxlint-min-peer/verify.mts',
      'test:projects': 'nx run-many -t test',
    });
  });

  it('runs every repository quality gate in persistent CI', () => {
    const workflow = rootText('.github/workflows/ci.yml');

    for (const job of ['lint', 'oxlint-min-peer', 'knip', 'check', 'test', 'build', 'pack']) {
      expect(workflow).toMatch(new RegExp(`^  ${job}:$`, 'mu'));
    }

    for (const command of [
      'run: pnpm run lint:policy',
      'run: pnpm run lint:ci',
      'run: pnpm run test:oxlint-min-peer',
      'run: pnpm run knip:ci',
      'run: pnpm run check',
      'run: pnpm run test:projects',
      'run: pnpm run build',
      'run: pnpm nx run-many -t pack',
    ]) {
      expect(workflow).toContain(command);
    }
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
      'pnpm --dir ts build && node ts/test/oxlint-min-peer/verify.mts',
    );
  });

  it('asserts exact diagnostics and the complete preset at the declared minimum peer', () => {
    const verifier = rootTextOrEmpty('ts/test/oxlint-min-peer/verify.mts');

    expect(verifier).toContain('minimumPeerVersion');
    expect(verifier).toContain('`oxlint@${minimumPeerVersion}`');
    expect(verifier).toContain("await import('./full.config.mjs')");
    expect(verifier).toContain('full minimum-peer config must expose 193 rules');
    expect(verifier).toMatch(/--format(?:=|['",\s]+)json/u);
    expect(verifier).toContain('Schema.parseJson');
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
    const verifier = rootTextOrEmpty('ts/test/oxlint-min-peer/verify.mts');

    expect(verifier).toContain('safe.ts');
    expect(verifier).toContain('--fix');
    expect(verifier).toContain('readFileSync');
    expect(verifier).toContain('beforeFix');
    expect(verifier).toContain('afterFix');
    expect(verifier).toMatch(/assert\.(?:equal|strictEqual)\s*\(\s*afterFix\s*,\s*beforeFix/u);
  });
});
