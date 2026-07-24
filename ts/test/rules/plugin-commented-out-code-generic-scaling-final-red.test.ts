import { describe, expect, it } from 'vitest';
import { cpuUsage } from 'node:process';
import noCommentedOutCodeRule from '../../src/rules/plugin-commented-out-code-rule';
import { scanSourceComments } from '../../src/rules/plugin-commented-out-code-source-scanner';

interface Report {
  message: string;
}

interface ScalingMeasurement {
  characters: number;
  medianMs: number;
  normalizedNsPerCharacter: number;
  statements: number;
}

const runFallbackRule = (source: string): readonly Report[] => {
  const reports: Report[] = [];
  const context = {
    report: (report: Report): void => {
      reports.push(report);
    },
    sourceCode: { text: source },
  } as unknown as Parameters<typeof noCommentedOutCodeRule.create>[0];

  noCommentedOutCodeRule.create(context).Program?.({ body: [], type: 'Program' } as never);
  return reports;
};

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

const genericAssertionSource = (statements: number): string => {
  const lines: string[] = [];
  for (let index = 0; index < statements; index += 1) {
    lines.push(
      `const value${index} = <ReadonlyBox<'https://example.test/a//b'>>records[${index}];\n`,
    );
  }
  return lines.join('');
};

const CPU_NOISE_FLOOR_MS = 0.25;
const INDEPENDENT_SAMPLES = 5;

const scalingMeasurement = (
  statements: number,
  source: string,
  durations: readonly number[],
): ScalingMeasurement => {
  const medianMs = median(durations);
  return {
    characters: source.length,
    medianMs,
    normalizedNsPerCharacter: (Math.max(medianMs, CPU_NOISE_FLOOR_MS) * 1_000_000) / source.length,
    statements,
  };
};

const scanCPUTimeMs = (source: string): number => {
  const startedAt = cpuUsage();
  const commentCount = countScannedComments(source);
  const elapsed = cpuUsage(startedAt);
  expect(commentCount).toBe(0);
  return (elapsed.user + elapsed.system) / 1_000;
};

describe('fallback scanning of TypeScript generic syntax', (): void => {
  it('keeps angle-bracket assertions, generic calls, slash-like strings, and regex opaque', (): void => {
    const source = [
      'type SlashLike<Path extends string> = { readonly matcher: RegExp; readonly path: Path };',
      "const asserted = <SlashLike<'https://example.test/a//b'>>{",
      '  matcher: /https?:\\/\\/[^/]+\\/[/*]/,',
      "  path: '/* const fake = true; */',",
      '};',
      "const decoded = decode<SlashLike<'// not a comment'>>(asserted);",
      "const nested = decode<Result<SlashLike<'/a/*/b/'>>>(decoded);",
      '',
    ].join('\n');

    expect(countScannedComments(source)).toBe(0);
    expect(runFallbackRule(source)).toEqual([]);
  });

  it('preserves deep legitimate TSX and ignores comment-shaped raw text', (): void => {
    const depth = 256;
    const source =
      `const view = <Panel>${'<Layer>'.repeat(depth)}` +
      '/* const fake = true; */' +
      `${'</Layer>'.repeat(depth)}</Panel>;\n`;

    expect(countScannedComments(source)).toBe(0);
    expect(runFallbackRule(source)).toEqual([]);
  });

  it('still finds a genuine comment in a deeply nested TSX expression', (): void => {
    const depth = 256;
    const source =
      `const view = <Panel>${'<Layer>'.repeat(depth)}` +
      '{/* const dead = compute(); */ liveValue}' +
      `${'</Layer>'.repeat(depth)}</Panel>;\n`;

    expect(countScannedComments(source)).toBe(1);
    expect(runFallbackRule(source)).toHaveLength(1);
  });
});

describe('generic-heavy fallback scanner scaling', (): void => {
  it(
    'keeps per-character cost roughly linear across independent 100 through 1,600 statement runs',
    { timeout: 15_000 },
    (): void => {
      const warmupSource = genericAssertionSource(100);
      for (let warmup = 0; warmup < 5; warmup += 1) {
        expect(countScannedComments(warmupSource)).toBe(0);
      }

      const statementCounts = [100, 200, 400, 800, 1_600] as const;
      const sources = new Map(
        statementCounts.map((statements): readonly [number, string] => [
          statements,
          genericAssertionSource(statements),
        ]),
      );
      const samples = new Map(statementCounts.map((statements) => [statements, [] as number[]]));

      for (let sample = 0; sample < INDEPENDENT_SAMPLES; sample += 1) {
        const orderedCounts = sample % 2 === 0 ? statementCounts : statementCounts.toReversed();
        for (const statements of orderedCounts) {
          const source = sources.get(statements);
          expect(source).toBeDefined();
          samples.get(statements)?.push(scanCPUTimeMs(source ?? ''));
        }
      }

      const measurements = statementCounts.map((statements): ScalingMeasurement => {
        const source = sources.get(statements);
        expect(source).toBeDefined();
        return scalingMeasurement(statements, source ?? '', samples.get(statements) ?? []);
      });
      const baseline = measurements[1];
      const large = measurements[4];
      expect(baseline).toBeDefined();
      expect(large).toBeDefined();

      const normalizedGrowth =
        (large?.normalizedNsPerCharacter ?? Number.POSITIVE_INFINITY) /
        (baseline?.normalizedNsPerCharacter ?? Number.MIN_VALUE);

      expect(
        normalizedGrowth,
        `normalized generic-scan growth exceeded its 2.5x linear tolerance: ${JSON.stringify(measurements)}`,
      ).toBeLessThanOrEqual(2.5);
    },
  );
});
