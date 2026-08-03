import { describe, expect, it } from 'vitest';
import { performance } from 'node:perf_hooks';
import { sourceNavigationIndex } from '../../src/rules/effect-source-navigation-index';

const QUERY_ITERATIONS = 1_024;
const STATEMENT_QUERY_ITERATIONS = 8_192;
const SCALING_RATIO_LIMIT = 32;
const SCALING_ABSOLUTE_LIMIT_MS = 4_000;
const SCALING_OVERHEAD_MS = 10;

interface TimingResult {
  checksum: number;
  elapsedMs: number;
}

const makeNestedBraceSource = (depth: number): string =>
  `{${'{'.repeat(depth)}value${'}'.repeat(depth)} target}`;

const makeNestedStatementSource = (count: number): string =>
  `const value = [${'fn(fn(value)), '.repeat(count)}done];`;

const measureWarmedQueries = (
  query: () => number,
  iterations: number = QUERY_ITERATIONS,
): TimingResult => {
  for (let index = 0; index < iterations; index += 1) {
    query();
  }
  let checksum = 0;
  const start = performance.now();
  for (let index = 0; index < iterations; index += 1) {
    checksum += query();
  }
  return { checksum, elapsedMs: performance.now() - start };
};

const expectSublinearScaling = (
  small: TimingResult,
  large: TimingResult,
  expectedSmallChecksum: number,
  expectedLargeChecksum: number,
): void => {
  expect(small.checksum).toBe(expectedSmallChecksum);
  expect(large.checksum).toBe(expectedLargeChecksum);
  expect(large.elapsedMs).toBeLessThan(SCALING_ABSOLUTE_LIMIT_MS);
  expect(large.elapsedMs).toBeLessThan(small.elapsedMs * SCALING_RATIO_LIMIT + SCALING_OVERHEAD_MS);
};

describe('source navigation index scaling', (): void => {
  it('should keep deeply nested enclosing-brace queries sublinear after warmup', (): void => {
    const smallSource = makeNestedBraceSource(500);
    const largeSource = makeNestedBraceSource(16_000);
    const smallIndex = sourceNavigationIndex(smallSource);
    const largeIndex = sourceNavigationIndex(largeSource);
    const smallTarget = smallSource.indexOf('target');
    const largeTarget = largeSource.indexOf('target');
    const smallTiming = measureWarmedQueries(
      (): number => smallIndex.enclosingBraceOpen(smallTarget) + 1,
    );
    const largeTiming = measureWarmedQueries(
      (): number => largeIndex.enclosingBraceOpen(largeTarget) + 1,
    );

    expectSublinearScaling(smallTiming, largeTiming, QUERY_ITERATIONS, QUERY_ITERATIONS);
  });

  it('should keep deeply nested statement-end queries sublinear after warmup', (): void => {
    const smallSource = makeNestedStatementSource(66);
    const largeSource = makeNestedStatementSource(2_200);
    const smallIndex = sourceNavigationIndex(smallSource);
    const largeIndex = sourceNavigationIndex(largeSource);
    const smallTarget = smallSource.indexOf('fn(');
    const largeTarget = largeSource.indexOf('fn(');
    const smallTiming = measureWarmedQueries(
      (): number => smallIndex.statementEnd(smallTarget),
      STATEMENT_QUERY_ITERATIONS,
    );
    const largeTiming = measureWarmedQueries(
      (): number => largeIndex.statementEnd(largeTarget),
      STATEMENT_QUERY_ITERATIONS,
    );

    expectSublinearScaling(
      smallTiming,
      largeTiming,
      (smallSource.length - 1) * STATEMENT_QUERY_ITERATIONS,
      (largeSource.length - 1) * STATEMENT_QUERY_ITERATIONS,
    );
  });
});
