import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const repoRoot = new URL('../..', import.meta.url);
const rootJSON = (path: string): unknown =>
  JSON.parse(readFileSync(new URL(`../../${path}`, import.meta.url), 'utf-8'));

describe('performance estimate calculator', () => {
  it('is wired as a package script for large-codebase runtime estimates', () => {
    const packageJSON = rootJSON('package.json') as { scripts?: Record<string, string> };

    expect(packageJSON.scripts?.['performance:estimate']).toBe(
      'tsx ts/bench/performance-estimate.ts',
    );
  });

  it('calculates an estimate for a one-million-line TypeScript codebase', () => {
    const output = execFileSync(
      'pnpm',
      ['run', 'performance:estimate', '--', '--loc', '1000000', '--lines-per-file', '250'],
      {
        cwd: repoRoot,
        encoding: 'utf-8',
        stdio: 'pipe',
      },
    );

    expect(output).toContain('Estimated files: 4,000');
    expect(output).toContain('Custom rule total');
    expect(output).toContain('Codemod total');
    expect(output).toContain('Combined total');
  });
});
