import { describe, expect, it } from 'vitest';
import { hasReturnEffectInGen } from '../../src/rules/effect-default-workflow-helpers';
import { performance } from 'node:perf_hooks';

const SCALING_RATIO_LIMIT = 8;
const SCALING_ABSOLUTE_LIMIT_MS = 2_500;
const SCALING_OVERHEAD_MS = 50;

const nestedEffectGenSource = (depth: number): string => {
  let source = `import { Effect } from 'effect';\n`;
  for (let index = 0; index < depth; index += 1) {
    source += 'Effect.gen(function* () { const nested = ';
  }
  source += '1';
  for (let index = 0; index < depth; index += 1) {
    source += '; return nested; })';
  }
  return source;
};

interface TimingResult {
  readonly elapsedMs: number;
  readonly value: boolean;
}

const measureNestedGenScan = (depth: number): TimingResult => {
  const source = nestedEffectGenSource(depth);
  hasReturnEffectInGen(source);
  const startedAt = performance.now();
  const value = hasReturnEffectInGen(source);
  return { elapsedMs: performance.now() - startedAt, value };
};

describe('remaining source hotspot regressions', (): void => {
  it('keeps nested Effect.gen scans near-linear within a bounded local budget', (): void => {
    const small = measureNestedGenScan(256);
    const large = measureNestedGenScan(1_024);

    expect(small.value).toBe(false);
    expect(large.value).toBe(false);
    expect(large.elapsedMs).toBeLessThan(SCALING_ABSOLUTE_LIMIT_MS);
    expect(large.elapsedMs).toBeLessThan(
      small.elapsedMs * SCALING_RATIO_LIMIT + SCALING_OVERHEAD_MS,
    );
  });
});
