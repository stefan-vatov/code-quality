import { describe, expect, it } from 'vitest';
import { bindingPatternNames } from '../../src/rules/effect-export-binding-patterns';
import { performance } from 'node:perf_hooks';

const SMALL_DEPTH = 2_000;
const LARGE_DEPTH = 8_000;
const SAMPLE_COUNT = 5;
const MAX_SCALING_RATIO = 7;

const nestedArrayPattern = (depth: number, name = 'name'): string =>
  `${'['.repeat(depth)}${name}${']'.repeat(depth)}`;

const median = (samples: readonly number[]): number => {
  const orderedSamples = [...samples].sort((left, right) => left - right);
  return orderedSamples[Math.floor(orderedSamples.length / 2)] ?? Number.POSITIVE_INFINITY;
};

const measureNestedArrayPattern = (source: string): number => {
  const samples: number[] = [];
  for (let sample = 0; sample < SAMPLE_COUNT; sample += 1) {
    const startedAt = performance.now();
    const names = bindingPatternNames(source, 0, source.length);
    const elapsedMs = performance.now() - startedAt;
    expect(names).toEqual(['name']);
    samples.push(elapsedMs);
  }
  return median(samples);
};

describe('Effect export binding-pattern traversal scaling', (): void => {
  it(
    'keeps deeply nested arrays near-linear while preserving binding order',
    { timeout: 4_500 },
    (): void => {
      const smallSource = nestedArrayPattern(SMALL_DEPTH);
      const largeSource = nestedArrayPattern(LARGE_DEPTH);
      const orderedSource = `[${nestedArrayPattern(8, 'first')}, second, [third, fourth]]`;

      expect(bindingPatternNames(orderedSource, 0, orderedSource.length)).toEqual([
        'first',
        'second',
        'third',
        'fourth',
      ]);

      bindingPatternNames(smallSource, 0, smallSource.length);
      bindingPatternNames(largeSource, 0, largeSource.length);

      const smallMedianMs = measureNestedArrayPattern(smallSource);
      const largeMedianMs = measureNestedArrayPattern(largeSource);
      const scalingRatio = largeMedianMs / smallMedianMs;

      expect(
        scalingRatio,
        `nested array median scaling ${smallMedianMs.toFixed(2)}ms -> ${largeMedianMs.toFixed(2)}ms`,
      ).toBeLessThan(MAX_SCALING_RATIO);
    },
  );
});
