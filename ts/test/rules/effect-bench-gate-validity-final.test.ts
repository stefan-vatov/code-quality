import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { medianBenchmarkRows } from '../../bench/performance-gate-measurement';
import plugin from '../../src/rules/plugin';
import type { BenchRow } from '../../bench/performance-gate-support';

interface BudgetEntry {
  inputSamples: number;
  iterations: number;
  operationsPerSample: number;
}

interface BudgetFile {
  rules: Record<string, BudgetEntry>;
}

const readBenchFile = (filename: string): string =>
  readFileSync(fileURLToPath(new URL(`../../bench/${filename}`, import.meta.url)), 'utf8');

const gateSource = readBenchFile('performance-gate.ts');
// SAFETY: the repository-owned budget JSON contains rule entries with the harness metadata checked below.
const budgets = JSON.parse(readBenchFile('performance-budgets.json')) as BudgetFile;

const sourceBetween = (start: string, end: string): string => {
  const startIndex = gateSource.indexOf(start);
  const endIndex = gateSource.indexOf(end, startIndex);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return gateSource.slice(startIndex, endIndex);
};

const numericConstant = (name: string): number => {
  const match = new RegExp(`const ${name} = ([\\d_]+);`).exec(gateSource);
  expect(match).not.toBeNull();
  return Number((match?.[1] ?? '').replaceAll('_', ''));
};

describe('Effect benchmark validity contracts', (): void => {
  it('budgets every registered rule, including the native TypeScript rules', (): void => {
    expect(Object.keys(budgets.rules).sort()).toStrictEqual(Object.keys(plugin.rules).sort());
  });

  it('uses the median of repeated measurements to reject transient tail jitter', (): void => {
    const row = (medianNs: number, p95Ns: number): BenchRow => ({
      inputSamples: 7,
      iterations: 20,
      medianNs,
      name: 'effect-example',
      operationsPerSample: 1,
      p95Ns,
    });

    const oneOutlier = medianBenchmarkRows([
      [row(10_000, 20_000)],
      [row(10_500, 2_000_000)],
      [row(11_000, 22_000)],
    ]);
    const repeatedRegression = medianBenchmarkRows([
      [row(10_000, 20_000)],
      [row(80_000, 2_000_000)],
      [row(90_000, 2_100_000)],
    ]);

    expect(oneOutlier[0]).toMatchObject({ medianNs: 10_500, p95Ns: 22_000 });
    expect(repeatedRegression[0]).toMatchObject({ medianNs: 80_000, p95Ns: 2_000_000 });
  });

  it('does not fabricate fixer work for a plugin with no fixable rules', (): void => {
    expect(gateSource).not.toContain('fixMode');
    expect(gateSource).not.toContain('benchmarkFixer');
    expect(gateSource).not.toContain('descriptor.fix');
  });

  it('requires only work paths exposed by the retained plugin', (): void => {
    const fixableRuleNames = Object.entries(plugin.rules)
      .filter(([, rule]): boolean => {
        const meta = rule.meta;
        return meta !== undefined && ('fixable' in meta || meta.hasSuggestions === true);
      })
      .map(([ruleName]) => ruleName);

    expect(fixableRuleNames).toStrictEqual([]);

    const requiredCounters = ['nativeReferenceHits', 'candidateHits'] as const;

    for (const counter of requiredCounters) {
      expect(gateSource).toContain(counter);
    }
    expect(gateSource).toMatch(
      /requiredBenchmarkHits[\s\S]{0,500}nativeReferenceHits[\s\S]{0,500}candidateHits/,
    );
    expect(gateSource).not.toMatch(/requiredBenchmarkHits[\s\S]{0,500}\bfixHits\b/);
    expect(gateSource).not.toContain('fixReadHits');
    expect(gateSource).toMatch(
      /requiredBenchmarkHits[\s\S]{0,1000}(?:throw new Error|assertBenchmarkHits)/,
    );
  });

  it('keeps candidate position and input scale as separate benchmark dimensions', (): void => {
    expect(gateSource).toMatch(
      /candidateShapes\s*=\s*\[[\s\S]{0,300}candidate-free[\s\S]{0,300}early-candidate[\s\S]{0,300}late-candidate/,
    );
    expect(gateSource).toMatch(
      /candidateScales\s*=\s*\[[\s\S]{0,300}\b100\b[\s\S]{0,300}\b1_000\b[\s\S]{0,300}\b5_000\b/,
    );
    expect(gateSource).toMatch(
      /candidateShapes\.(?:flatMap|map)[\s\S]{0,500}candidateScales\.(?:flatMap|map)/,
    );
  });

  it('isolates rule visitor work or subtracts a measured walker baseline', (): void => {
    const reportPath = sourceBetween('const runRule =', 'const benchmark =');
    const hasIsolatedVisitorWork =
      !/\bwalk\s*\(/.test(reportPath) &&
      /\b(?:dispatchNodes|visitorNodes|visitorDispatches)\b/.test(gateSource);
    const hasSubtractedWalkerBaseline =
      /\b(?:walkerBaselineNs|walkBaselineNs)\b/.test(gateSource) &&
      /\b(?:subtractBaseline|baselineAdjustedNs)\b/.test(gateSource);

    expect(hasIsolatedVisitorWork || hasSubtractedWalkerBaseline).toBe(true);
  });

  it('keeps every rule budget calibrated to current harness metadata', (): void => {
    const fixtureBlock = sourceBetween('const ruleFixtures:', 'const codemodFixtures =');
    const fixtureCount = [...fixtureBlock.matchAll(/\bfilename:/g)].length;
    const expectedIterations = numericConstant('defaultRuleIterations');
    const expectedOperations = numericConstant('ruleOperationsPerSample');
    const staleEntries = Object.entries(budgets.rules)
      .filter(
        ([, entry]): boolean =>
          entry.inputSamples !== fixtureCount ||
          entry.iterations !== expectedIterations ||
          entry.operationsPerSample !== expectedOperations,
      )
      .map(([name]) => name);

    expect(fixtureCount).toBe(7);
    expect(staleEntries).toEqual([]);
  });

  it('confirms apparent budget breaches across independent measurements', (): void => {
    const checkBudgets = sourceBetween('const checkBudgets =', "if (args.has('--update'))");

    expect(numericConstant('budgetConfirmationMeasurements')).toBeGreaterThanOrEqual(3);
    expect(checkBudgets).toMatch(
      /failures\.length[\s\S]{0,1500}measureAll[\s\S]{0,1500}medianBenchmarkRows/,
    );
  });

  it('propagates calibration runs to rule and codemod measurements', (): void => {
    const measureAll = sourceBetween('const measureAll =', 'const readBudgets =');

    expect(measureAll).toContain('Math.max(defaultRuleIterations, runs)');
    expect(measureAll).toContain('Math.max(defaultCodemodIterations, runs)');
  });
});
