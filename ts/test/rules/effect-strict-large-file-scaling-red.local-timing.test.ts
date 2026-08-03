import { describe, expect, it } from 'vitest';
import type { SourceRule } from '../../src/rules/effect-rule-core';
import { parseSync } from 'oxc-parser';
import { performance } from 'node:perf_hooks';
import plugin from '../../src/rules/plugin';

const RETRY_RULE = 'effect-require-retry-policy-for-idempotent-external-effects';
const SOURCE_SIZES = [2_500, 5_000, 10_000] as const;
const CANDIDATE_INTERVAL = 600;
const MAX_RULE_TIME_MS = 1_000;
const MAX_NORMALIZED_GROWTH = 4;

type SparseFixture = {
  readonly ast: object;
  readonly filename: string;
  readonly source: string;
};

type Measurement = {
  readonly coldMs: number;
  readonly coldReportCount: number;
  readonly hotMs: number;
  readonly hotReportCount: number;
};

type TimedRun = {
  readonly durationMs: number;
  readonly reportCount: number;
};

const sourceFor = (lineCount: number, sample: number): string => {
  const lines = ['import { Effect } from "effect";', 'const toError = (error: unknown) => error;'];
  for (let index = 0; index < lineCount; index += 1) {
    const identifier = `${sample}x${index}`;
    const view = `const view${identifier}=<span data-id="${identifier}">{${index}}</span>;`;
    if (index % CANDIDATE_INTERVAL === CANDIDATE_INTERVAL - 1) {
      lines.push(
        `${view}const request${identifier}=Effect.tryPromise({try:()=>fetch("/users/${identifier}"),catch:toError}).pipe(Effect.retry(policy${identifier}));`,
      );
      continue;
    }
    lines.push(`${view}const stable${identifier}=value${identifier};`);
  }
  lines.push('const outlier=Effect.tryPromise({try:()=>fetch("/outlier"),catch:toError});');
  return lines.join('\n');
};

const makeFixture = (lineCount: number, sample: number): SparseFixture => {
  const filename = `effect-strict-large-file-scaling-${lineCount}-${sample}.tsx`;
  const source = sourceFor(lineCount, sample);
  const parsed = parseSync(filename, source, { sourceType: 'module' });
  expect(parsed.errors, filename).toHaveLength(0);
  return { ast: parsed.program as object, filename, source };
};

const runOneShot = (fixture: SparseFixture): TimedRun => {
  const reports: object[] = [];
  const rule = plugin.rules[RETRY_RULE] as SourceRule;
  const createOnce = rule.createOnce;
  if (createOnce === undefined) {
    throw new Error(`${RETRY_RULE} must expose createOnce`);
  }
  const visitors = createOnce({
    filename: fixture.filename,
    report(report): void {
      reports.push(report.node);
    },
    sourceCode: { text: fixture.source },
  });
  const startedAt = performance.now();
  const beforeResult = visitors.before?.();
  if (beforeResult !== false) {
    visitors.Program(fixture.ast);
  }
  return {
    durationMs: performance.now() - startedAt,
    reportCount: reports.length,
  };
};

const measureSize = (lineCount: number): Measurement => {
  const fixture = makeFixture(lineCount, lineCount);
  const cold = runOneShot(fixture);
  runOneShot(fixture);
  const hot = runOneShot(fixture);
  return {
    coldMs: cold.durationMs,
    coldReportCount: cold.reportCount,
    hotMs: hot.durationMs,
    hotReportCount: hot.reportCount,
  };
};

const measurementSummary = (measurements: readonly Measurement[]): string =>
  measurements
    .map(
      ({ coldMs, coldReportCount, hotMs, hotReportCount }, index): string =>
        `${SOURCE_SIZES[index]}: cold=${coldMs.toFixed(2)}ms/${coldReportCount} hot=${hotMs.toFixed(2)}ms/${hotReportCount}`,
    )
    .join('; ');

describe('strict Effect large-file local timing RED', (): void => {
  it('keeps retry-policy diagnostics bounded on sparse TSX files', (): void => {
    const measurements = SOURCE_SIZES.map(measureSize);
    const small = measurements[0];
    const medium = measurements[1];
    const large = measurements[2];
    if (!small || !medium || !large) {
      throw new Error('Expected measurements for every source size');
    }

    expect(measurements.map(({ coldReportCount }): number => coldReportCount)).toStrictEqual([
      1, 1, 1,
    ]);
    expect(measurements.map(({ hotReportCount }): number => hotReportCount)).toStrictEqual([
      1, 1, 1,
    ]);
    const summary = measurementSummary(measurements);
    expect(large.coldMs, summary).toBeLessThanOrEqual(MAX_RULE_TIME_MS);
    expect(large.hotMs, summary).toBeLessThanOrEqual(MAX_RULE_TIME_MS);
    expect(large.coldMs / medium.coldMs, summary).toBeLessThanOrEqual(MAX_NORMALIZED_GROWTH);
    expect(large.hotMs / medium.hotMs, summary).toBeLessThanOrEqual(MAX_NORMALIZED_GROWTH);
  }, 9_000);
});
