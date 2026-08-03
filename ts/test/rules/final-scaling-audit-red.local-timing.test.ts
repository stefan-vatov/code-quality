import { describe, expect, it } from 'vitest';
import { hasFloatingEffect } from '../../src/rules/effect-default-floating-helpers';
import { performance } from 'node:perf_hooks';

const SMALL_PIPE_COUNT = 256;
const LARGE_PIPE_COUNT = 2_048;
const SCALING_RATIO_LIMIT = 8;

const pipeSource = (count: number): string => 'value.pipe(x)\n'.repeat(count);

const median = (samples: readonly number[]): number => {
  const sorted = [...samples].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
};

const measure = (source: string): number => {
  hasFloatingEffect(source);
  return median(
    Array.from({ length: 5 }, (): number => {
      const startedAt = performance.now();
      hasFloatingEffect(source);
      return performance.now() - startedAt;
    }),
  );
};

describe('final local timing audit regressions', (): void => {
  it('keeps repeated same-statement pipe scans near-linear', (): void => {
    const small = measure(pipeSource(SMALL_PIPE_COUNT));
    const large = measure(pipeSource(LARGE_PIPE_COUNT));

    expect(hasFloatingEffect(pipeSource(LARGE_PIPE_COUNT))).toBe(false);
    expect(large).toBeLessThan(small * SCALING_RATIO_LIMIT);
  });
});
