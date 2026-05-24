import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = join(import.meta.dirname, '..', '..');

describe('Effect benchmark harness', () => {
  it('runs against the current Effect rule name exports', () => {
    const root = mkdtempSync(join(tmpdir(), 'thx-effect-bench-'));
    const outputPath = join(root, 'bench.json');

    try {
      execFileSync(
        'pnpm',
        ['exec', 'tsx', 'ts/bench/effect-rules.ts', '--iterations', '1', '--json', outputPath],
        {
          cwd: repoRoot,
          stdio: 'pipe',
        },
      );
    } finally {
      rmSync(root, { force: true, recursive: true });
    }

    expect(true).toBe(true);
  });
});
