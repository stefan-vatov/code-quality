import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

interface BudgetEntry {
  iterations: number;
  medianLimitNs: number;
  observedMedianNs: number;
  observedP95Ns: number;
  p95LimitNs: number;
  runs: number;
}

interface BudgetFile {
  codemods: Record<string, BudgetEntry>;
  rules: Record<string, BudgetEntry>;
}

const readBenchFile = (filename: string): string =>
  readFileSync(fileURLToPath(new URL(`../../bench/${filename}`, import.meta.url)), 'utf8');

const gateSource = readBenchFile('performance-gate.ts');
const supportSource = readBenchFile('performance-gate-support.ts');
const executableSource = `${gateSource}\n${supportSource}`;
// SAFETY: this repository-owned JSON uses the benchmark budget contract verified by these tests.
const budgets = JSON.parse(readBenchFile('performance-budgets.json')) as BudgetFile;

const numericConstant = (name: string): number => {
  const match = new RegExp(`const ${name} = ([\\d_]+);`).exec(gateSource);
  expect(match, `missing numeric constant ${name}`).not.toBeNull();
  return Number((match?.[1] ?? '').replaceAll('_', ''));
};

const declarationBody = (name: string): string => {
  const start = gateSource.indexOf(`const ${name}`);
  expect(start, `missing declaration ${name}`).toBeGreaterThanOrEqual(0);
  return gateSource.slice(start, start + 2_500);
};

const sourceWithoutQuotedText = (source: string): string => {
  let output = '';
  let quote = 0;
  let isEscaped = false;
  for (let index = 0; index < source.length; index += 1) {
    const code = source.charCodeAt(index);
    if (quote === 0) {
      if (code === 34 || code === 39 || code === 96) {
        quote = code;
        output += ' ';
      } else {
        output += source[index];
      }
      continue;
    }
    if (isEscaped) {
      isEscaped = false;
    } else if (code === 92) {
      isEscaped = true;
    } else if (code === quote) {
      quote = 0;
    }
    output += code === 10 || code === 13 ? source[index] : ' ';
  }
  return output;
};

const codeOnly = sourceWithoutQuotedText(executableSource);

const expectIdentifier = (name: string): void => {
  expect(new RegExp(`\\b${name}\\b`).test(codeOnly), `missing executable identifier ${name}`).toBe(
    true,
  );
};

const allBudgetEntries = (): readonly [string, BudgetEntry][] => [
  ...Object.entries(budgets.rules).map(([name, entry]): [string, BudgetEntry] => [
    `rule:${name}`,
    entry,
  ]),
  ...Object.entries(budgets.codemods).map(([name, entry]): [string, BudgetEntry] => [
    `codemod:${name}`,
    entry,
  ]),
];

describe('Effect gate strength RED contracts', (): void => {
  it('separates cold-start rows from warmed steady-state rows', (): void => {
    for (const identifier of [
      'coldRows',
      'hotRows',
      'coldMedianNs',
      'hotMedianNs',
      'coldP95Ns',
      'hotP95Ns',
    ]) {
      expectIdentifier(identifier);
    }
    expect(declarationBody('measureAll')).toMatch(
      /coldRows[\s\S]{0,1500}hotRows|hotRows[\s\S]{0,1500}coldRows/,
    );
  });

  it('takes at least twenty independent timed samples for every measured path', (): void => {
    expectIdentifier('minimumTimedSamples');
    const minimumTimedSamples = numericConstant('minimumTimedSamples');
    expect(minimumTimedSamples).toBeGreaterThanOrEqual(20);
    expect(numericConstant('defaultRuns')).toBeGreaterThanOrEqual(minimumTimedSamples);
    expect(numericConstant('candidateRuns')).toBeGreaterThanOrEqual(minimumTimedSamples);
  });

  it('crosses every changed subsystem with all candidate positions and scales', (): void => {
    const matrix = declarationBody('candidateSubsystems');
    const subsystems = ['recursion', 'native'] as const;

    for (const subsystem of subsystems) {
      expect(matrix, `missing ${subsystem} candidate subsystem`).toMatch(
        new RegExp(`['"]${subsystem}['"]`),
      );
    }
    expect(matrix).toMatch(/\bcandidateSubsystems\.(?:flatMap|map)\b/);
    expect(matrix).toMatch(/\bcandidateShapes\.(?:flatMap|map)\b/);
    expect(matrix).toMatch(/\bcandidateScales\.(?:flatMap|map)\b/);
    expect(declarationBody('candidateScales')).toMatch(
      /\b100\b[\s\S]{0,100}\b1_000\b[\s\S]{0,100}\b5_000\b/,
    );
    expect(declarationBody('candidateShapes')).toMatch(
      /candidate-free[\s\S]{0,150}early-candidate[\s\S]{0,150}late-candidate/,
    );
  });

  it('records real work-path hits for each candidate-scaled subsystem', (): void => {
    for (const identifier of [
      'ruleBenchmarkHits',
      'referenceEntryHits',
      'candidateHits',
      'assertRuleBenchmarkHits',
    ]) {
      expectIdentifier(identifier);
    }
    expect(codeOnly).toMatch(
      /(?:Map|Record)<string,\s*(?:Rule)?BenchmarkHits>|ruleBenchmarkHits\s*=\s*new Map/,
    );
    expect(codeOnly).toMatch(/referenceEntryHits\s*\+=\s*1/);
    expect(codeOnly).toMatch(/candidateHits\s*\+=\s*1/);
  });

  it('normalizes subsystem timing and enforces tight linear scaling', (): void => {
    for (const identifier of [
      'normalizedP95NsPerNode',
      'linearGrowthTolerance',
      'normalizedCandidateLimitNs',
    ]) {
      expectIdentifier(identifier);
    }
    expect(numericConstant('candidateBaseLimitNs')).toBeLessThanOrEqual(1_000_000);
    expect(numericConstant('candidateNodeLimitNs')).toBeLessThanOrEqual(10_000);
    expect(gateSource).toMatch(/normalizedP95NsPerNode[\s\S]{0,1000}linearGrowthTolerance/);
  });

  it('subjects candidate cold rows to the same ceilings and scaling checks as hot rows', (): void => {
    const matrix = declarationBody('benchmarkCandidateMatrix');

    expect(matrix).toMatch(
      /const coldRow\s*=\s*measurePreparedBenchmark\([\s\S]{0,1500}candidateColdRows\.push\(\s*coldRow\s*\)/,
    );
    expect(matrix).toMatch(
      /for\s*\(\s*const row of \[\s*coldRow\s*,\s*hotRow\s*\]\s*\)[\s\S]{0,1000}normalizedCandidateLimitNs[\s\S]{0,1000}normalizedP95NsPerNode/,
    );
  });

  it('keeps calibrated limits within a small noise floor or six times observation', (): void => {
    const medianNoiseFloorNs = 25_000;
    const p95NoiseFloorNs = 100_000;
    const excessiveLimits = allBudgetEntries()
      .flatMap(([name, entry]) => {
        const medianLimit = Math.max(medianNoiseFloorNs, entry.observedMedianNs * 6);
        const p95Limit = Math.max(p95NoiseFloorNs, entry.observedP95Ns * 6);
        return [
          ...(entry.medianLimitNs <= medianLimit
            ? []
            : [`${name}:median=${entry.medianLimitNs}/${medianLimit}`]),
          ...(entry.p95LimitNs <= p95Limit ? [] : [`${name}:p95=${entry.p95LimitNs}/${p95Limit}`]),
        ];
      })
      .slice(0, 20);

    expect(excessiveLimits).toEqual([]);
  });

  it('persists at least twenty independent runs in every calibrated budget entry', (): void => {
    const undersampled = allBudgetEntries()
      .filter(([, entry]): boolean => entry.runs < 20)
      .map(([name, entry]) => `${name}=${entry.runs}`);

    expect(undersampled).toEqual([]);
  });

  it('does not hide structural contract bait in diagnostic strings', (): void => {
    const diagnosticBait = [
      ...gateSource.matchAll(/(?:throw new Error|process\.stdout\.write)\s*\(([\s\S]{0,500}?)\);/g),
    ]
      .map((match) => match[1] ?? '')
      .filter((message): boolean => /\{0,[\d_]+\}|\[\\s\\S\]|\\b[A-Za-z]+\b/.test(message));

    expect(diagnosticBait).toEqual([]);
    expect(gateSource).not.toContain('requiredBenchmarkHits {0,1_000}assertBenchmarkHits');
  });
});
