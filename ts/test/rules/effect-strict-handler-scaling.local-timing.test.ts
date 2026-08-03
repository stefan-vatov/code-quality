import { describe, expect, it } from 'vitest';
import { LARGE_SOURCE_LINE_COUNT } from '../../bench/effect-strict-handler-fixtures';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const strictSourcePredicateURL = new URL(
  '../../src/rules/effect-strict-source-predicates.ts',
  import.meta.url,
).href;
const strictHandlerFixtureURL = new URL(
  '../../bench/effect-strict-handler-fixtures.ts',
  import.meta.url,
).href;
const largeProbeCases = [
  { density: 'sparse', hasLastLineViolation: false },
  { density: 'sparse', hasLastLineViolation: true },
  { density: 'dense', hasLastLineViolation: false },
  { density: 'dense', hasLastLineViolation: true },
] as const;
const LARGE_SCAN_TIMEOUT_MS = 5_000;

describe('runSync server-handler fallback regression coverage', (): void => {
  it('completes every 3,000-line fallback case inside a bounded child process', (): void => {
    const probeSource = `
      import { hasRunSyncInServerRequestHandler } from ${JSON.stringify(strictSourcePredicateURL)};
      import { createStrictHandlerSource } from ${JSON.stringify(strictHandlerFixtureURL)};
      const cases = ${JSON.stringify(largeProbeCases)};
      const results = cases.map(({ density, hasLastLineViolation }) =>
        String(hasRunSyncInServerRequestHandler(createStrictHandlerSource(${LARGE_SOURCE_LINE_COUNT}, {
          density,
          hasLastLineViolation,
        }))),
      );
      process.stdout.write(results.join(','));
    `;
    const result = spawnSync(
      process.execPath,
      ['--import', 'tsx', '--input-type=module', '--eval', probeSource],
      {
        cwd: fileURLToPath(new URL('../../..', import.meta.url)),
        encoding: 'utf8',
        maxBuffer: 10_000,
        timeout: LARGE_SCAN_TIMEOUT_MS,
      },
    );

    if (result.error !== undefined) {
      throw new Error(`large fallback probe failed: ${result.error.message}`);
    }
    if (result.status !== 0) {
      throw new Error(`large fallback probe exited with status ${String(result.status)}`);
    }
    expect(result.stdout.trim()).toBe('false,true,false,true');
  });
});
