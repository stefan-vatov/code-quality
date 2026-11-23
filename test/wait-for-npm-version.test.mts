import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const script = join(import.meta.dirname, '..', 'scripts', 'wait-for-npm-version.sh');
const workspaces: string[] = [];

afterEach((): void => {
  for (const workspace of workspaces.splice(0)) {
    rmSync(workspace, { force: true, recursive: true });
  }
});

const fakeNpm = (failuresBeforeSuccess: number): { bin: string; calls: () => number } => {
  const workspace = mkdtempSync(join(tmpdir(), 'thx-wait-npm-'));
  workspaces.push(workspace);
  const counter = join(workspace, 'calls');
  writeFileSync(counter, '0');
  writeFileSync(
    join(workspace, 'npm'),
    [
      '#!/usr/bin/env bash',
      `count=$(( $(cat "${counter}") + 1 ))`,
      `echo "$count" > "${counter}"`,
      `if [ "$1" != "view" ] || [ "$count" -le ${failuresBeforeSuccess} ]; then`,
      '  echo "npm error code E404" >&2',
      '  exit 1',
      'fi',
      'echo "${2##*@}"',
      '',
    ].join('\n'),
  );
  chmodSync(join(workspace, 'npm'), 0o755);
  return { bin: workspace, calls: () => Number(readFileSync(counter, 'utf8')) };
};

const run = (bin: string, args: readonly string[]) =>
  spawnSync('bash', [script, ...args], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ''}` },
  });

describe('wait-for-npm-version', (): void => {
  it('keeps polling through npm 404s until the version is served', (): void => {
    const npm = fakeNpm(3);
    const result = run(npm.bin, ['@scope/pkg', '1.2.3', '60', '0']);

    expect(result.status, result.stderr).toBe(0);
    expect(npm.calls()).toBe(4);
    expect(result.stdout).toContain('@scope/pkg@1.2.3 is available on npm');
  });

  it('fails with a clear message when the version never appears before the timeout', (): void => {
    const npm = fakeNpm(Number.MAX_SAFE_INTEGER);
    const result = run(npm.bin, ['@scope/pkg', '1.2.3', '0', '0']);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('@scope/pkg@1.2.3 was not available on npm after 0s');
  });

  it('rejects missing arguments', (): void => {
    const npm = fakeNpm(0);
    const result = run(npm.bin, ['@scope/pkg']);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('usage: wait-for-npm-version.sh');
  });
});
