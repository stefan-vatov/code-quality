import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const repositoryRoot = fileURLToPath(new URL('../../..', import.meta.url));
const scopeSourceURL = new URL('../../src/rules/effect-sync-promise-source.ts', import.meta.url)
  .href;
const pairAndArrow = '(0),Promise=>0,';
const pairAndArrowCount = 12_000;
const probeTimeoutMS = 1_250;
const pairPattern = /\(0\)/g;
const promiseArrowPattern = /Promise=>0/g;

const makeAdversarialSource = (count: number): string =>
  `const callbacks = [${pairAndArrow.repeat(count)}0];Effect.sync(() => Promise.resolve(1));`;

describe('Effect sync Promise parameter-scope construction scaling', (): void => {
  it(
    'completes the large pair-and-arrow source in a bounded child process',
    (): void => {
      const source = makeAdversarialSource(pairAndArrowCount);
      const pairMatches = source.match(pairPattern) ?? [];
      const promiseArrowMatches = source.match(promiseArrowPattern) ?? [];
      const probeSource = `
      import { hasSyncForPromiseSource } from ${JSON.stringify(scopeSourceURL)};
      process.stdin.setEncoding('utf8');
      const chunks = [];
      for await (const chunk of process.stdin) chunks.push(chunk);
      const source = chunks.join('');
      process.stdout.write(JSON.stringify(hasSyncForPromiseSource(source)));
    `;

      expect(pairMatches).toHaveLength(pairAndArrowCount);
      expect(promiseArrowMatches).toHaveLength(pairAndArrowCount);

      const result = spawnSync(
        process.execPath,
        ['--import', 'tsx', '--input-type=module', '--eval', probeSource],
        {
          cwd: repositoryRoot,
          encoding: 'utf8',
          input: source,
          maxBuffer: 10_000,
          timeout: probeTimeoutMS,
        },
      );

      if (result.error !== undefined) {
        throw new Error(`Promise-scope scaling probe failed: ${result.error.message}`);
      }
      if (result.status !== 0) {
        throw new Error(`Promise-scope scaling probe exited with status ${String(result.status)}`);
      }
      expect(result.stdout.trim()).toBe('true');
    },
    probeTimeoutMS + 2_000,
  );
});
