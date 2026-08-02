import {
  type HandlerScalingRow,
  assertNearLinearScaling,
} from '../../bench/effect-strict-handler-scaling';
import { describe, expect, it } from 'vitest';
import { SCALING_LINE_COUNTS } from '../../bench/effect-strict-handler-fixtures';

const scalingCases = [
  { density: 'sparse', hasLastLineViolation: false, label: 'sparse-safe' },
  { density: 'sparse', hasLastLineViolation: true, label: 'sparse-last-line-violation' },
  { density: 'dense', hasLastLineViolation: false, label: 'dense-safe' },
  { density: 'dense', hasLastLineViolation: true, label: 'dense-last-line-violation' },
] as const;

type ScalingCase = (typeof scalingCases)[number];
type Timing = Pick<HandlerScalingRow, 'medianNs' | 'p95Ns'>;

const rowsFor = (
  timingFor: (lineCount: number, testCase: ScalingCase) => Timing,
): HandlerScalingRow[] =>
  scalingCases.flatMap((testCase): HandlerScalingRow[] =>
    SCALING_LINE_COUNTS.map((lineCount): HandlerScalingRow => {
      const timing = timingFor(lineCount, testCase);
      return {
        ...timing,
        density: testCase.density,
        hasLastLineViolation: testCase.hasLastLineViolation,
        inputSamples: 31,
        iterations: 31,
        lineCount,
        name: `${testCase.label}-${lineCount}`,
        operationsPerSample: 3,
      };
    }),
  );

const linearRowsWithSingleScaleOutlier = rowsFor((lineCount, testCase): Timing => {
  const lastLineCount = SCALING_LINE_COUNTS[SCALING_LINE_COUNTS.length - 1];
  const isObservedOutlier =
    testCase.label === 'dense-last-line-violation' && lineCount === lastLineCount;
  const medianNsPerLine = ((): number => {
    if (isObservedOutlier) {
      return 338;
    }
    return 100;
  })();
  const p95NsPerLine = ((): number => {
    if (isObservedOutlier) {
      return 500;
    }
    return 120;
  })();
  return {
    medianNs: lineCount * medianNsPerLine,
    p95Ns: lineCount * p95NsPerLine,
  };
});

const quadraticRows = rowsFor((lineCount): Timing => {
  const quadraticTime = lineCount * lineCount;
  return { medianNs: quadraticTime, p95Ns: quadraticTime };
});

const singleCaseQuadraticRows = rowsFor((lineCount, testCase): Timing => {
  const isQuadraticCase = testCase.label === 'dense-last-line-violation';
  const medianNs = isQuadraticCase ? lineCount * lineCount : lineCount * 100;
  const p95Ns = isQuadraticCase ? lineCount * lineCount : lineCount * 120;
  return { medianNs, p95Ns };
});

describe('handler scaling stability contract', (): void => {
  it('accepts near-linear growth with one deterministic noisy scale', (): void => {
    expect(() => assertNearLinearScaling(linearRowsWithSingleScaleOutlier)).not.toThrow();
  });

  it('rejects quadratic growth isolated to one handler case', (): void => {
    expect(() => assertNearLinearScaling(singleCaseQuadraticRows)).toThrow(
      /exceeded near-linear normalized scaling/,
    );
  });

  it('rejects quadratic growth across every scaling point', (): void => {
    expect(() => assertNearLinearScaling(quadraticRows)).toThrow(
      /exceeded near-linear normalized scaling/,
    );
  });
});
