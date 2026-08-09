import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

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
  it('executes reported fixes through a no-op fixer in fix mode', (): void => {
    const reportPath = sourceBetween('const runRule =', 'const benchmark =');

    expect(reportPath).toMatch(/\bfixMode\b/);
    expect(reportPath).toMatch(/descriptor\.fix(?:\?\.)?\(\s*(?:benchmarkFixer|noOpFixer)\s*\)/);
    expect(gateSource).toMatch(/\bremoveRange\s*\(/);
    expect(gateSource).toMatch(/\breplaceTextRange\s*\(/);
  });

  it('asserts that native references, candidates, and fixes are exercised', (): void => {
    const requiredCounters = ['nativeReferenceHits', 'candidateHits', 'fixHits'] as const;

    for (const counter of requiredCounters) {
      expect(gateSource).toContain(counter);
    }
    expect(gateSource).toMatch(
      /requiredBenchmarkHits[\s\S]{0,500}nativeReferenceHits[\s\S]{0,500}candidateHits[\s\S]{0,500}fixHits/,
    );
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
});
