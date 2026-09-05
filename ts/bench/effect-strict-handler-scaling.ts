import {
  HANDLER_CANDIDATE_INTERVAL,
  type HandlerCandidateDensity,
  SCALING_LINE_COUNTS,
  createStrictHandlerSource,
} from './effect-strict-handler-fixtures.js';
import type { BenchRow } from './performance-gate-support.js';
import { hasRunSyncInServerRequestHandler } from '../src/rules/effect-strict-internals.js';
import { pathToFileURL } from 'node:url';
import { percentile } from './performance-gate-measurement.js';

const ITERATIONS = 31;
const WARMUP_ITERATIONS = 5;
const OPERATIONS_PER_SAMPLE = 3;
const LINEAR_NORMALIZED_GROWTH_FRACTION = 0.75;
const HANDLER_ASSIGNMENT_PATTERN = /\b(?:handler|route|loader|action)\s*=/g;

interface ScalingCase {
  density: HandlerCandidateDensity;
  hasLastLineViolation: boolean;
  label: string;
}

export interface HandlerScalingRow extends BenchRow {
  density: HandlerCandidateDensity;
  hasLastLineViolation: boolean;
  lineCount: number;
}

const scalingCases: readonly ScalingCase[] = [
  { density: 'sparse', hasLastLineViolation: false, label: 'sparse-safe' },
  { density: 'sparse', hasLastLineViolation: true, label: 'sparse-last-line-violation' },
  { density: 'dense', hasLastLineViolation: false, label: 'dense-safe' },
  { density: 'dense', hasLastLineViolation: true, label: 'dense-last-line-violation' },
];

const expectedHandlerAssignments = (
  lineCount: number,
  density: HandlerCandidateDensity,
  hasLastLineViolation: boolean,
): number => {
  if (density === 'dense') {
    return lineCount;
  }
  const safeAssignments = Math.floor(lineCount / HANDLER_CANDIDATE_INTERVAL);
  const lastLineAddsCandidate =
    hasLastLineViolation && lineCount % HANDLER_CANDIDATE_INTERVAL !== 0;
  return safeAssignments + (lastLineAddsCandidate ? 1 : 0);
};

const sourceFor = (lineCount: number, testCase: ScalingCase, sample: number): string =>
  createStrictHandlerSource(lineCount, {
    density: testCase.density,
    hasLastLineViolation: testCase.hasLastLineViolation,
    seed: sample,
  });

const assertScanResult = (source: string, testCase: ScalingCase, lineCount: number): void => {
  const expected = testCase.hasLastLineViolation;
  const actual = hasRunSyncInServerRequestHandler(source);
  if (actual !== expected) {
    throw new Error(
      `${testCase.label} expected ${String(expected)} for ${lineCount} lines, got ${String(actual)}`,
    );
  }
};

const assertFixtureContract = (lineCount: number, testCase: ScalingCase): void => {
  const source = sourceFor(lineCount, testCase, 0);
  const lineCountInSource = source.split('\n').length;
  if (lineCountInSource !== lineCount) {
    throw new Error(
      `${testCase.label} generated ${lineCountInSource} lines, expected ${lineCount}`,
    );
  }
  assertScanResult(source, testCase, lineCount);
  const assignmentCount = source.match(HANDLER_ASSIGNMENT_PATTERN)?.length ?? 0;
  const expectedAssignments = expectedHandlerAssignments(
    lineCount,
    testCase.density,
    testCase.hasLastLineViolation,
  );
  if (assignmentCount !== expectedAssignments) {
    throw new Error(
      `${testCase.label} generated ${assignmentCount} handler candidates, expected ${expectedAssignments}`,
    );
  }
};

const measureUniquePreparedBenchmark = (
  name: string,
  iterations: number,
  operationsPerSample: number,
  prepare: (sample: number) => readonly string[],
  fn: (input: string) => void,
  warmupIterations: number,
): BenchRow => {
  const times: number[] = [];
  const runBatch = (inputs: readonly string[]): void => {
    if (inputs.length !== operationsPerSample) {
      throw new Error(`${name} prepared ${inputs.length} inputs, expected ${operationsPerSample}`);
    }
    for (const input of inputs) {
      fn(input);
    }
  };

  for (let iteration = 0; iteration < warmupIterations; iteration += 1) {
    runBatch(prepare(iteration));
  }
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const inputs = prepare(iteration + warmupIterations);
    const startedAt = process.hrtime.bigint();
    runBatch(inputs);
    times.push(Number(process.hrtime.bigint() - startedAt) / operationsPerSample);
  }

  return {
    inputSamples: iterations * operationsPerSample,
    iterations,
    medianNs: percentile(times, 0.5),
    name,
    operationsPerSample,
    p95Ns: percentile(times, 0.95),
  };
};

const measureCase = (lineCount: number, testCase: ScalingCase): HandlerScalingRow => {
  const sourceSamples = Array.from(
    { length: (WARMUP_ITERATIONS + ITERATIONS) * OPERATIONS_PER_SAMPLE },
    (_, sample): string => sourceFor(lineCount, testCase, sample + 1),
  );
  if (new Set(sourceSamples).size !== sourceSamples.length) {
    throw new Error(`${testCase.label}-${lineCount} reused a prepared source sample`);
  }

  const row = measureUniquePreparedBenchmark(
    `${testCase.label}-${lineCount}`,
    ITERATIONS,
    OPERATIONS_PER_SAMPLE,
    (sample): readonly string[] =>
      sourceSamples.slice(sample * OPERATIONS_PER_SAMPLE, (sample + 1) * OPERATIONS_PER_SAMPLE),
    (source): void => assertScanResult(source, testCase, lineCount),
    WARMUP_ITERATIONS,
  );
  return {
    ...row,
    density: testCase.density,
    hasLastLineViolation: testCase.hasLastLineViolation,
    lineCount,
  };
};

const rowsForCase = (
  rows: readonly HandlerScalingRow[],
  testCase: ScalingCase,
): readonly HandlerScalingRow[] => {
  const caseRows = rows
    .filter(
      (row): boolean =>
        row.density === testCase.density &&
        row.hasLastLineViolation === testCase.hasLastLineViolation,
    )
    .sort((left, right): number => left.lineCount - right.lineCount);
  const expectedLineCounts = [...SCALING_LINE_COUNTS];
  if (
    caseRows.length !== expectedLineCounts.length ||
    caseRows.some((row, index): boolean => row.lineCount !== expectedLineCounts[index])
  ) {
    throw new Error(`${testCase.label} did not produce one row for every scaling size`);
  }
  return caseRows;
};

const normalizedGrowth = (
  rows: readonly HandlerScalingRow[],
  selector: (row: HandlerScalingRow) => number,
): readonly number[] => {
  const growth: number[] = [];
  for (let index = 1; index < rows.length; index += 1) {
    const previous = rows[index - 1];
    const current = rows[index];
    if (!previous || !current || previous.lineCount <= 0 || current.lineCount <= 0) {
      growth.push(Number.NaN);
      continue;
    }
    const previousNormalized = selector(previous) / previous.lineCount;
    const currentNormalized = selector(current) / current.lineCount;
    if (previousNormalized <= 0 || currentNormalized <= 0) {
      growth.push(Number.NaN);
      continue;
    }
    growth.push(currentNormalized / previousNormalized);
  }
  return growth;
};

const hasInvalidGrowth = (growth: readonly number[], limits: readonly number[]): boolean =>
  growth.length !== limits.length ||
  growth.some(
    (value, index): boolean =>
      !Number.isFinite(value) || value <= 0 || !Number.isFinite(limits[index]),
  );

const hasConsistentSuperlinearGrowth = (
  growth: readonly number[],
  limits: readonly number[],
): boolean =>
  growth.length > 0 &&
  growth.length === limits.length &&
  growth.every((value, index): boolean => {
    const limit = limits[index];
    return limit !== undefined && value > limit;
  });

const formatGrowthValue = (value: number): string => {
  if (Number.isFinite(value)) {
    return value.toFixed(2);
  }
  return 'NaN';
};

const formatGrowth = (growth: readonly number[]): string => growth.map(formatGrowthValue).join('/');

export const assertNearLinearScaling = (rows: readonly HandlerScalingRow[]): void => {
  const firstLineCount = SCALING_LINE_COUNTS[0];
  const lastLineCount = SCALING_LINE_COUNTS[SCALING_LINE_COUNTS.length - 1];
  if (firstLineCount === undefined || lastLineCount === undefined || firstLineCount <= 0) {
    throw new Error('Scaling fixture requires positive source line counts');
  }
  const maximumNormalizedGrowth =
    (lastLineCount / firstLineCount) * LINEAR_NORMALIZED_GROWTH_FRACTION;
  const totalLineGrowth = lastLineCount / firstLineCount;
  for (const testCase of scalingCases) {
    const caseRows = rowsForCase(rows, testCase);
    const growthLimits = caseRows.slice(1).map((row, index): number => {
      const previous = caseRows[index];
      if (!previous || previous.lineCount <= 0 || row.lineCount <= previous.lineCount) {
        return Number.NaN;
      }
      return (
        maximumNormalizedGrowth **
        (Math.log(row.lineCount / previous.lineCount) / Math.log(totalLineGrowth))
      );
    });
    const medianGrowth = normalizedGrowth(caseRows, (row): number => row.medianNs);
    const p95Growth = normalizedGrowth(caseRows, (row): number => row.p95Ns);
    if (
      hasInvalidGrowth(medianGrowth, growthLimits) ||
      hasInvalidGrowth(p95Growth, growthLimits) ||
      hasConsistentSuperlinearGrowth(medianGrowth, growthLimits) ||
      hasConsistentSuperlinearGrowth(p95Growth, growthLimits)
    ) {
      const message = [
        `${testCase.label} exceeded near-linear normalized scaling:`,
        `median ${formatGrowth(medianGrowth)}x,`,
        `p95 ${formatGrowth(p95Growth)}x,`,
        `limits ${formatGrowth(growthLimits)}x`,
      ].join(' ');
      throw new Error(message);
    }
  }
};

const printRows = (rows: readonly HandlerScalingRow[]): void => {
  console.log('Strict server-handler fallback scaling benchmark');
  console.log('| case | lines | iterations | median ns | p95 ns | median ns/line | p95 ns/line |');
  console.log('|---|---:|---:|---:|---:|---:|---:|');
  for (const row of rows) {
    const values = [
      row.name,
      row.lineCount.toLocaleString(),
      String(row.iterations),
      row.medianNs.toFixed(0),
      row.p95Ns.toFixed(0),
      (row.medianNs / row.lineCount).toFixed(2),
      (row.p95Ns / row.lineCount).toFixed(2),
    ];
    console.log(`| ${values.join(' | ')} |`);
  }
};

export const main = (): void => {
  for (const lineCount of SCALING_LINE_COUNTS) {
    for (const testCase of scalingCases) {
      assertFixtureContract(lineCount, testCase);
    }
  }

  const rows = SCALING_LINE_COUNTS.flatMap((lineCount): readonly HandlerScalingRow[] =>
    scalingCases.map((testCase): HandlerScalingRow => measureCase(lineCount, testCase)),
  );
  assertNearLinearScaling(rows);
  printRows(rows);
};

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main();
}
