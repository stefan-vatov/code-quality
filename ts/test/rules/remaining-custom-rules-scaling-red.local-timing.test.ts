import { describe, expect, it } from 'vitest';
import findLongLines from '../../src/rules/max-line-length';
import { findRequiredFunctionDocFailure } from '../../src/rules/require-function-doc';
import { performance } from 'node:perf_hooks';

const documentedExports = (count: number): string =>
  Array.from(
    { length: count },
    (_, index) =>
      `/** Function ${index}. */\nexport function function${index}(): number { return ${index}; }\n`,
  ).join('');

const measure = <Result>(
  run: (input: string) => Result,
  input: string,
): { duration: number; result: Result } => {
  run(input);
  const startedAt = performance.now();
  const result = run(input);
  return { duration: performance.now() - startedAt, result };
};

describe('remaining custom Oxlint rule scaling regressions local timing', (): void => {
  it('keeps exported documentation checks near-linear as exports grow', (): void => {
    const smallMeasurement = measure(findRequiredFunctionDocFailure, documentedExports(256));
    const largeMeasurement = measure(findRequiredFunctionDocFailure, documentedExports(1_024));

    expect(largeMeasurement.result).toBeUndefined();
    expect(largeMeasurement.duration / smallMeasurement.duration).toBeLessThan(8);
  }, 15_000);

  it('keeps long-line collection near-linear as violating lines grow', (): void => {
    const smallSource = ('x'.repeat(160) + '\n').repeat(1_000);
    const largeSource = ('x'.repeat(160) + '\n').repeat(8_000);
    const smallMeasurement = measure(findLongLines, smallSource);
    const largeMeasurement = measure(findLongLines, largeSource);

    expect(largeMeasurement.result).toHaveLength(8_000);
    expect(largeMeasurement.duration / smallMeasurement.duration).toBeLessThan(16);
  }, 15_000);
});
