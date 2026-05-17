import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyReleasePlan, planPackageRelease } from '../scripts/release-plan.mjs';

const releaseScriptPath = new URL('../scripts/release-plan.mjs', import.meta.url).pathname;

describe('release planner', () => {
  it('plans first releases at the current manifest version', () => {
    const plan = planPackageRelease({
      commits: [],
      currentVersion: '0.1.0',
      date: '2026-05-17',
      lastTag: null,
      name: 'cargo-thx-lint',
      tagPrefix: 'cargo-thx-lint',
    });

    expect(plan).toEqual({
      bump: 'initial',
      changelogSections: {
        Added: ['Initial release.'],
      },
      date: '2026-05-17',
      name: 'cargo-thx-lint',
      nextVersion: '0.1.0',
      previousVersion: null,
      release: true,
      tag: 'cargo-thx-lint@0.1.0',
    });
  });

  it('uses conventional commits and keeps pre-1.0 breaking changes on the minor line', () => {
    const plan = planPackageRelease({
      commits: [
        {
          body: '',
          hash: '1111111111111111111111111111111111111111',
          subject: 'fix(rust): preserve owned clippy config blocks',
        },
        {
          body: '',
          hash: '2222222222222222222222222222222222222222',
          subject: 'feat(rust): install formatter defaults',
        },
        {
          body: 'BREAKING CHANGE: stricter unsafe conversion policy',
          hash: '3333333333333333333333333333333333333333',
          subject: 'feat(rust): deny lossy casts',
        },
      ],
      currentVersion: '0.1.0',
      date: '2026-05-17',
      lastTag: 'cargo-thx-lint@0.1.0',
      name: 'cargo-thx-lint',
      tagPrefix: 'cargo-thx-lint',
    });

    expect(plan.nextVersion).toBe('0.2.0');
    expect(plan.bump).toBe('minor');
    expect(plan.changelogSections).toEqual({
      'Breaking Changes': ['feat(rust): deny lossy casts (3333333)'],
      Features: ['feat(rust): install formatter defaults (2222222)'],
      Fixes: ['fix(rust): preserve owned clippy config blocks (1111111)'],
    });
  });

  it('plans a pending publish when the manifest version is newer than the latest tag', () => {
    const plan = planPackageRelease({
      commits: [],
      currentVersion: '0.2.0',
      date: '2026-05-17',
      lastTag: 'cargo-thx-lint@0.1.0',
      name: 'cargo-thx-lint',
      tagPrefix: 'cargo-thx-lint',
    });

    expect(plan).toEqual({
      bump: 'pending',
      changelogSections: {},
      date: '2026-05-17',
      name: 'cargo-thx-lint',
      nextVersion: '0.2.0',
      previousVersion: '0.1.0',
      release: true,
      tag: 'cargo-thx-lint@0.2.0',
    });
  });

  it('rejects manifests that are older than the latest package tag', () => {
    expect(() =>
      planPackageRelease({
        commits: [
          {
            body: '',
            hash: '4444444444444444444444444444444444444444',
            subject: 'fix(rust): tighten result handling',
          },
        ],
        currentVersion: '0.1.0',
        date: '2026-05-17',
        lastTag: 'cargo-thx-lint@0.2.0',
        name: 'cargo-thx-lint',
        tagPrefix: 'cargo-thx-lint',
      }),
    ).toThrow('Manifest version 0.1.0 is older than latest tag cargo-thx-lint@0.2.0');
  });

  it('updates manifests and prepends package changelogs', () => {
    const files = new Map([
      [
        'ts/package.json',
        JSON.stringify(
          {
            name: '@thethracian/oxlint-config',
            version: '0.1.0',
          },
          null,
          2,
        ) + '\n',
      ],
      ['rust/Cargo.toml', '[package]\nname = "cargo-thx-lint"\nversion = "0.1.0"\n'],
      ['rust/Cargo.lock', '# lock\n\n[[package]]\nname = "cargo-thx-lint"\nversion = "0.1.0"\n'],
      ['elixir/mix.exs', 'def project do\n  [app: :the_thracian_credo, version: "0.1.0"]\nend\n'],
    ]);

    const nextFiles = applyReleasePlan({
      files,
      plans: [
        {
          bump: 'patch',
          changelogSections: {
            Fixes: ['fix(ts): route plugin reports through Program nodes (abc1234)'],
          },
          date: '2026-05-17',
          name: '@thethracian/oxlint-config',
          nextVersion: '0.1.1',
          previousVersion: '0.1.0',
          release: true,
          tag: '@thethracian/oxlint-config@0.1.1',
        },
        {
          bump: 'minor',
          changelogSections: {
            Features: ['feat(rust): install formatter defaults (def5678)'],
          },
          date: '2026-05-17',
          name: 'cargo-thx-lint',
          nextVersion: '0.2.0',
          previousVersion: '0.1.0',
          release: true,
          tag: 'cargo-thx-lint@0.2.0',
        },
        {
          bump: 'patch',
          changelogSections: {
            Fixes: ['fix(elixir): preserve existing credo plugin lists (fed4321)'],
          },
          date: '2026-05-17',
          name: 'the_thracian_credo',
          nextVersion: '0.1.1',
          previousVersion: '0.1.0',
          release: true,
          tag: 'the_thracian_credo@0.1.1',
        },
      ],
    });

    expect(JSON.parse(nextFiles.get('ts/package.json')).version).toBe('0.1.1');
    expect(nextFiles.get('rust/Cargo.toml')).toContain('version = "0.2.0"');
    expect(nextFiles.get('rust/Cargo.lock')).toContain('version = "0.2.0"');
    expect(nextFiles.get('elixir/mix.exs')).toContain('version: "0.1.1"');
    expect(nextFiles.get('ts/CHANGELOG.md')).toContain('## 0.1.1 - 2026-05-17');
    expect(nextFiles.get('rust/CHANGELOG.md')).toContain('## 0.2.0 - 2026-05-17');
    expect(nextFiles.get('elixir/CHANGELOG.md')).toContain('## 0.1.1 - 2026-05-17');
  });

  it('does not duplicate changelogs for pending publish retries', () => {
    const files = new Map([
      ['rust/Cargo.toml', '[package]\nname = "cargo-thx-lint"\nversion = "0.2.0"\n'],
      ['rust/Cargo.lock', '# lock\n\n[[package]]\nname = "cargo-thx-lint"\nversion = "0.2.0"\n'],
      [
        'rust/CHANGELOG.md',
        '# Changelog\n\n## 0.2.0 - 2026-05-17\n\n### Features\n\n- feat(rust): install formatter defaults (def5678)\n',
      ],
    ]);

    const nextFiles = applyReleasePlan({
      files,
      plans: [
        {
          bump: 'pending',
          changelogSections: {},
          date: '2026-05-17',
          name: 'cargo-thx-lint',
          nextVersion: '0.2.0',
          previousVersion: '0.1.0',
          release: true,
          tag: 'cargo-thx-lint@0.2.0',
        },
      ],
    });

    expect(nextFiles.get('rust/CHANGELOG.md')?.match(/## 0\.2\.0/g)).toHaveLength(1);
  });

  it('writes initial changelogs without requiring same-version manifest rewrites', () => {
    const files = new Map([
      [
        'ts/package.json',
        JSON.stringify(
          {
            name: '@thethracian/oxlint-config',
            version: '0.1.0',
          },
          null,
          2,
        ) + '\n',
      ],
      ['ts/CHANGELOG.md', '# Changelog\n'],
      ['rust/Cargo.toml', '[package]\nname = "cargo-thx-lint"\nversion = "0.1.0"\n'],
      ['rust/Cargo.lock', '# lock\n\n[[package]]\nname = "cargo-thx-lint"\nversion = "0.1.0"\n'],
      ['rust/CHANGELOG.md', '# Changelog\n'],
      ['elixir/mix.exs', 'def project do\n  [app: :the_thracian_credo, version: "0.1.0"]\nend\n'],
      ['elixir/CHANGELOG.md', '# Changelog\n'],
    ]);

    const nextFiles = applyReleasePlan({
      files,
      plans: [
        initialPlan('@thethracian/oxlint-config', '@thethracian/oxlint-config@0.1.0'),
        initialPlan('cargo-thx-lint', 'cargo-thx-lint@0.1.0'),
        initialPlan('the_thracian_credo', 'the_thracian_credo@0.1.0'),
      ],
    });

    expect(JSON.parse(nextFiles.get('ts/package.json')).version).toBe('0.1.0');
    expect(nextFiles.get('rust/Cargo.toml')).toContain('version = "0.1.0"');
    expect(nextFiles.get('rust/Cargo.lock')).toContain('version = "0.1.0"');
    expect(nextFiles.get('elixir/mix.exs')).toContain('version: "0.1.0"');
    expect(nextFiles.get('ts/CHANGELOG.md')).toContain('## 0.1.0 - 2026-05-17');
    expect(nextFiles.get('rust/CHANGELOG.md')).toContain('## 0.1.0 - 2026-05-17');
    expect(nextFiles.get('elixir/CHANGELOG.md')).toContain('## 0.1.0 - 2026-05-17');
  });

  it('does not duplicate initial changelog entries on first-publish retries', () => {
    const files = new Map([
      ['rust/Cargo.toml', '[package]\nname = "cargo-thx-lint"\nversion = "0.1.0"\n'],
      ['rust/Cargo.lock', '# lock\n\n[[package]]\nname = "cargo-thx-lint"\nversion = "0.1.0"\n'],
      [
        'rust/CHANGELOG.md',
        '# Changelog\n\n## 0.1.0 - 2026-05-17\n\n### Added\n\n- Initial release.\n',
      ],
    ]);

    const once = applyReleasePlan({
      files,
      plans: [initialPlan('cargo-thx-lint', 'cargo-thx-lint@0.1.0')],
    });

    expect(once.get('rust/CHANGELOG.md')?.match(/## 0\.1\.0/g)).toHaveLength(1);
  });

  it('outputs the original release metadata commit for pending publish retries', () => {
    const repo = createReleaseRepo();
    const releaseSha = commitRustRelease(repo);
    const outputPath = join(repo, 'github-output');

    execFileSync(process.execPath, [releaseScriptPath, 'prepare', '--github-output', outputPath], {
      cwd: repo,
    });

    expect(readFile(outputPath)).toContain(`rust_sha=${releaseSha}`);
    rmSync(repo, { force: true, recursive: true });
  });

  it('rejects pending publish retries after package code changed past the release metadata commit', () => {
    const repo = createReleaseRepo();
    commitRustRelease(repo);
    writeFileSync(join(repo, 'rust/src/main.rs'), 'fn main() {\n    let _value = 1;\n}\n');
    git(repo, 'add', 'rust/src/main.rs');
    git(repo, 'commit', '-m', 'fix(rust): change package after release metadata');

    expect(() =>
      execFileSync(
        process.execPath,
        [releaseScriptPath, 'prepare', '--github-output', join(repo, 'github-output')],
        {
          cwd: repo,
          encoding: 'utf8',
          stdio: 'pipe',
        },
      ),
    ).toThrow(
      'Pending release cargo-thx-lint@0.2.0 has package changes after release metadata commit',
    );

    rmSync(repo, { force: true, recursive: true });
  });
});

function initialPlan(name, tag) {
  return {
    bump: 'initial',
    changelogSections: {
      Added: ['Initial release.'],
    },
    date: '2026-05-17',
    name,
    nextVersion: '0.1.0',
    previousVersion: null,
    release: true,
    tag,
  };
}

function createReleaseRepo() {
  const repo = mkdtempSync(join(tmpdir(), 'release-plan-test-'));
  mkdirSync(join(repo, 'ts'), { recursive: true });
  mkdirSync(join(repo, 'rust/src'), { recursive: true });
  mkdirSync(join(repo, 'elixir'), { recursive: true });
  writePackageFiles(
    repo,
    '0.1.0',
    '# Changelog\n\n## 0.1.0 - 2026-05-16\n\n### Added\n\n- Initial release.\n',
  );
  writeFileSync(join(repo, 'rust/src/main.rs'), 'fn main() {}\n');
  git(repo, 'init', '-b', 'main');
  git(repo, 'config', 'user.name', 'Release Test');
  git(repo, 'config', 'user.email', 'release-test@example.test');
  git(repo, 'add', '.');
  git(repo, 'commit', '-m', 'feat: publish native code quality packages');
  git(repo, 'tag', '@thethracian/oxlint-config@0.1.0');
  git(repo, 'tag', 'cargo-thx-lint@0.1.0');
  git(repo, 'tag', 'the_thracian_credo@0.1.0');

  return repo;
}

function commitRustRelease(repo) {
  writePackageFiles(
    repo,
    '0.2.0',
    '# Changelog\n\n## 0.2.0 - 2026-05-17\n\n### Features\n\n- feat(rust): add rule.\n',
  );
  git(repo, 'add', 'rust/Cargo.toml', 'rust/Cargo.lock', 'rust/CHANGELOG.md');
  git(repo, 'commit', '-m', 'chore(release): publish [skip ci]');

  return git(repo, 'rev-parse', 'HEAD').trim();
}

function writePackageFiles(repo, rustVersion, rustChangelog) {
  writeFileSync(
    join(repo, 'ts/package.json'),
    `${JSON.stringify({ name: '@thethracian/oxlint-config', version: '0.1.0' })}\n`,
  );
  writeFileSync(
    join(repo, 'ts/CHANGELOG.md'),
    '# Changelog\n\n## 0.1.0 - 2026-05-16\n\n### Added\n\n- Initial release.\n',
  );
  writeFileSync(
    join(repo, 'rust/Cargo.toml'),
    `[package]\nname = "cargo-thx-lint"\nversion = "${rustVersion}"\n`,
  );
  writeFileSync(
    join(repo, 'rust/Cargo.lock'),
    `# lock\n\n[[package]]\nname = "cargo-thx-lint"\nversion = "${rustVersion}"\n`,
  );
  writeFileSync(join(repo, 'rust/CHANGELOG.md'), rustChangelog);
  writeFileSync(
    join(repo, 'elixir/mix.exs'),
    'def project do\n  [app: :the_thracian_credo, version: "0.1.0"]\nend\n',
  );
  writeFileSync(
    join(repo, 'elixir/CHANGELOG.md'),
    '# Changelog\n\n## 0.1.0 - 2026-05-16\n\n### Added\n\n- Initial release.\n',
  );
}

function readFile(path) {
  return readFileSync(path, 'utf8');
}

function git(cwd, ...args) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
  });
}
