import { describe, expect, it } from 'vitest';
import { applyReleasePlan, planPackageRelease } from '../scripts/release-plan.mjs';

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
});
