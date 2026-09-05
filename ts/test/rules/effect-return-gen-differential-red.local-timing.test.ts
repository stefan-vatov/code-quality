import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const repositoryRoot = fileURLToPath(new URL('../../..', import.meta.url));
const helperURL = new URL('../../src/rules/effect-default-workflow-helpers.ts', import.meta.url)
  .href;
const SMALL_DEPTH = 2_048;
const LARGE_DEPTH = 6_000;
const CHILD_TIMEOUT_MS = 2_000;

const probeSource = `
  import { hasReturnEffectInGen } from ${JSON.stringify(helperURL)};

  const makeSource = (depth) => {
    let source = "import { Effect } from 'effect';\\n";
    for (let index = 0; index < depth; index += 1) {
      source += "Effect.gen(function* () { const nested" + String(index) + " = ";
    }
    source += 'return Effect.succeed(1);';
    for (let index = depth - 1; index >= 0; index -= 1) {
      source += "; return nested" + String(index) + "; });";
    }
    return source;
  };

  const measure = (depth) => {
    const source = makeSource(depth);
    const startedAt = process.hrtime.bigint();
    const value = hasReturnEffectInGen(source);
    return { depth, elapsedMs: Number(process.hrtime.bigint() - startedAt) / 1e6, value };
  };

  process.stdout.write(JSON.stringify([measure(${SMALL_DEPTH}), measure(${LARGE_DEPTH})]));
`;

describe('Effect return-in-gen differential local timing', (): void => {
  it(
    'keeps late matches bounded across practical nested sources',
    (): void => {
      const result = spawnSync(
        process.execPath,
        ['--import', 'tsx', '--input-type=module', '--eval', probeSource],
        { cwd: repositoryRoot, encoding: 'utf8', timeout: CHILD_TIMEOUT_MS },
      );

      expect(result.error).toBeUndefined();
      expect(result.status).toBe(0);

      const measurements = JSON.parse(result.stdout) as Array<{
        depth: number;
        elapsedMs: number;
        value: boolean;
      }>;
      const small = measurements[0];
      const large = measurements[1];
      expect(small?.value).toBe(true);
      expect(large?.value).toBe(true);
      expect(large?.elapsedMs).toBeLessThan(CHILD_TIMEOUT_MS);
      expect(large?.elapsedMs).toBeLessThan((small?.elapsedMs ?? 0) * 8 + 100);
    },
    CHILD_TIMEOUT_MS + 2_000,
  );
});
