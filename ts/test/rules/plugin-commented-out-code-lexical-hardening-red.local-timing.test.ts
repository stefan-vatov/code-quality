import { describe, expect, it } from 'vitest';
import { performance } from 'node:perf_hooks';
import { scanSourceComments } from '../../src/rules/plugin-commented-out-code-source-scanner';

const nestedTSX = (depth: number): string =>
  `const view = ${'<Layer>'.repeat(depth)}live${'</Layer>'.repeat(depth)};\n`;

const countScannedComments = (source: string): number => {
  let commentCount = 0;
  scanSourceComments(source, (): void => {
    commentCount += 1;
  });
  return commentCount;
};

const median = (values: readonly number[]): number => {
  const ordered = values.toSorted((left, right): number => left - right);
  return ordered[Math.floor(ordered.length / 2)] ?? Number.POSITIVE_INFINITY;
};

const normalizedScanDuration = (source: string): number => {
  const targetCharacters = 50_000;
  const repetitions = Math.max(1, Math.ceil(targetCharacters / source.length));
  countScannedComments(source);
  const samples: number[] = [];
  for (let sample = 0; sample < 5; sample += 1) {
    let totalComments = 0;
    const startedAt = performance.now();
    for (let repetition = 0; repetition < repetitions; repetition += 1) {
      totalComments += countScannedComments(source);
    }
    const duration = performance.now() - startedAt;
    expect(totalComments).toBe(0);
    samples.push(duration / repetitions / source.length);
  }
  return median(samples);
};

describe('deep valid TSX fallback scanning local timing', (): void => {
  it('keeps normalized scan cost roughly linear from depth 100 through 5,000', (): void => {
    const normalizedDurations = [100, 1_000, 5_000].map((depth): number =>
      normalizedScanDuration(nestedTSX(depth)),
    );
    const fastest = Math.min(...normalizedDurations);
    const slowest = Math.max(...normalizedDurations);

    expect(Number.isFinite(fastest)).toBe(true);
    expect(fastest).toBeGreaterThan(0);
    expect(slowest / fastest).toBeLessThan(6);
  });
});
