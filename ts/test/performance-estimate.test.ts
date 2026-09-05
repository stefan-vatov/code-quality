import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Schema } from 'effect';

const repoRoot = new URL('../..', import.meta.url);
const parsePackage = Schema.decodeUnknownSync(
  Schema.parseJson(
    Schema.Struct({ scripts: Schema.Record({ key: Schema.String, value: Schema.String }) }),
  ),
);

describe('performance estimate calculator', () => {
  it('is wired as a package script for large-codebase runtime estimates', () => {
    const packageJSON = parsePackage(
      readFileSync(new URL('../../package.json', import.meta.url), 'utf-8'),
    );

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
