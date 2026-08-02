import {
  HANDLER_CANDIDATE_INTERVAL,
  LARGE_SOURCE_LINE_COUNT,
  SCALING_LINE_COUNTS,
  createStrictHandlerSource,
} from '../../bench/effect-strict-handler-fixtures';
import {
  type HandlerScalingRow,
  assertNearLinearScaling,
} from '../../bench/effect-strict-handler-scaling';
import { describe, expect, it } from 'vitest';
import type { Context } from '../../src/rules/effect-rule-core';
import { fileURLToPath } from 'node:url';
import { hasRunSyncInServerRequestHandler } from '../../src/rules/effect-strict-source-predicates';
import { readFileSync } from 'node:fs';
import { runSyncServerHandlerAST } from '../../src/rules/effect-strict-server-handler-ast';
import { spawnSync } from 'node:child_process';

const HANDLER_ASSIGNMENT_PATTERN = /\b(?:handler|route|loader|action)\s*=/g;

const fallbackCases = [
  {
    density: 'sparse',
    expected: false,
    hasLastLineViolation: false,
  },
  {
    density: 'sparse',
    expected: true,
    hasLastLineViolation: true,
  },
  {
    density: 'dense',
    expected: false,
    hasLastLineViolation: false,
  },
  {
    density: 'dense',
    expected: true,
    hasLastLineViolation: true,
  },
] as const;

const scalingCases = SCALING_LINE_COUNTS.flatMap((lineCount) =>
  fallbackCases.map((testCase) => ({ ...testCase, lineCount })),
);
const smallScalingCases = scalingCases.filter(
  ({ lineCount }): boolean => lineCount !== LARGE_SOURCE_LINE_COUNT,
);
const strictSourcePredicateURL = new URL(
  '../../src/rules/effect-strict-source-predicates.ts',
  import.meta.url,
).href;
const strictHandlerFixtureURL = new URL(
  '../../bench/effect-strict-handler-fixtures.ts',
  import.meta.url,
).href;
const largeProbeCases = fallbackCases.map(
  ({ density, hasLastLineViolation }): { density: string; hasLastLineViolation: boolean } => ({
    density,
    hasLastLineViolation,
  }),
);
const LARGE_SCAN_TIMEOUT_MS = 5_000;

const scalingBenchmarkSource = readFileSync(
  fileURLToPath(new URL('../../bench/effect-strict-handler-scaling.ts', import.meta.url)),
  'utf8',
);

const expectedHandlerAssignments = (
  lineCount: number,
  density: (typeof fallbackCases)[number]['density'],
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

const syntheticCases = [
  { density: 'sparse', hasLastLineViolation: false, label: 'sparse-safe' },
  { density: 'sparse', hasLastLineViolation: true, label: 'sparse-last-line-violation' },
  { density: 'dense', hasLastLineViolation: false, label: 'dense-safe' },
  { density: 'dense', hasLastLineViolation: true, label: 'dense-last-line-violation' },
] as const;

const syntheticRows = (work: (lineCount: number) => number): HandlerScalingRow[] =>
  syntheticCases.flatMap((testCase): HandlerScalingRow[] =>
    SCALING_LINE_COUNTS.map(
      (lineCount): HandlerScalingRow => ({
        density: testCase.density,
        hasLastLineViolation: testCase.hasLastLineViolation,
        inputSamples: 1,
        iterations: 1,
        lineCount,
        medianNs: work(lineCount),
        name: `${testCase.label}-${lineCount}`,
        operationsPerSample: 1,
        p95Ns: work(lineCount),
      }),
    ),
  );

describe('runSync server-handler fallback regression coverage', (): void => {
  it('uses AST visitors for native server-handler detection', (): void => {
    const call = {
      callee: {
        computed: false,
        object: { name: 'Effect', type: 'Identifier' },
        property: { name: 'runSync', type: 'Identifier' },
        type: 'MemberExpression',
      },
      end: 48,
      start: 20,
      type: 'CallExpression',
    };
    const declarator = {
      end: 50,
      id: { name: 'handler', type: 'Identifier' },
      init: {
        body: call,
        end: 50,
        start: 0,
        type: 'ArrowFunctionExpression',
      },
      start: 0,
      type: 'VariableDeclarator',
    };
    const reports: object[] = [];
    const context: Context = {
      report({ node }): void {
        reports.push(node);
      },
    };
    const visitors = runSyncServerHandlerAST(context);
    const program = { body: [declarator], type: 'Program' };

    visitors.Program?.(program);
    visitors.VariableDeclarator?.(declarator);
    visitors.CallExpression?.(call);

    expect(reports).toHaveLength(1);
  });

  it('completes every 3,000-line fallback case inside a bounded child process', (): void => {
    const probeSource = `
      import { hasRunSyncInServerRequestHandler } from ${JSON.stringify(strictSourcePredicateURL)};
      import { createStrictHandlerSource } from ${JSON.stringify(strictHandlerFixtureURL)};
      const cases = ${JSON.stringify(largeProbeCases)};
      const results = cases.map(({ density, hasLastLineViolation }) =>
        String(hasRunSyncInServerRequestHandler(createStrictHandlerSource(${LARGE_SOURCE_LINE_COUNT}, {
          density,
          hasLastLineViolation,
        }))),
      );
      process.stdout.write(results.join(','));
    `;
    const result = spawnSync(
      process.execPath,
      ['--import', 'tsx', '--input-type=module', '--eval', probeSource],
      {
        cwd: fileURLToPath(new URL('../../..', import.meta.url)),
        encoding: 'utf8',
        maxBuffer: 10_000,
        timeout: LARGE_SCAN_TIMEOUT_MS,
      },
    );

    if (result.error !== undefined) {
      throw new Error(`large fallback probe failed: ${result.error.message}`);
    }
    if (result.status !== 0) {
      throw new Error(`large fallback probe exited with status ${String(result.status)}`);
    }
    expect(result.stdout.trim()).toBe('false,true,false,true');
  });

  it.each(scalingCases)(
    'keeps the $density fixture contract at $lineCount lines',
    ({ density, hasLastLineViolation, lineCount }): void => {
      const source = createStrictHandlerSource(lineCount, {
        density,
        hasLastLineViolation,
      });

      expect(source.split('\n')).toHaveLength(lineCount);
      expect(source.match(HANDLER_ASSIGNMENT_PATTERN)?.length ?? 0).toBe(
        expectedHandlerAssignments(lineCount, density, hasLastLineViolation),
      );
    },
  );

  it.each(smallScalingCases)(
    'scans the $density $lineCount-line fixture with the expected result',
    ({ density, expected, hasLastLineViolation, lineCount }): void => {
      const source = createStrictHandlerSource(lineCount, {
        density,
        hasLastLineViolation,
      });

      expect(hasRunSyncInServerRequestHandler(source)).toBe(expected);
    },
  );

  it('validates fixture contracts for every benchmarked source size', (): void => {
    expect(scalingBenchmarkSource).toMatch(
      /for\s*\(\s*const lineCount of SCALING_LINE_COUNTS\s*\)[\s\S]{0,250}assertFixtureContract\(lineCount/,
    );
    expect(scalingBenchmarkSource).not.toContain(
      'assertFixtureContract(LARGE_SOURCE_LINE_COUNT, testCase)',
    );
  });

  it('keeps the normalized-growth ceiling below the quadratic signature', (): void => {
    expect(scalingBenchmarkSource).toMatch(/LINEAR_NORMALIZED_GROWTH_FRACTION\s*=\s*0\.[0-9]+/);
    expect(scalingBenchmarkSource).not.toContain('MEDIAN_LINEAR_TOLERANCE = 6');
    expect(scalingBenchmarkSource).not.toContain('P95_LINEAR_TOLERANCE = 6');
  });

  it('rejects quadratic normalized growth while accepting linear growth', (): void => {
    expect(() =>
      assertNearLinearScaling(syntheticRows((lineCount) => lineCount * lineCount)),
    ).toThrow(/exceeded near-linear normalized scaling/);
    expect(() =>
      assertNearLinearScaling(syntheticRows((lineCount) => lineCount * 100)),
    ).not.toThrow();
  });

  it('keeps unrelated runSync calls outside a handler statement safe', (): void => {
    const source = [
      'const handler = () => ok;',
      'Effect.runSync(program);',
      'const docs = "const route = () => Effect.runSync(program);";',
      '// const action = () => Effect.runSync(program);',
    ].join('\n');

    expect(hasRunSyncInServerRequestHandler(source)).toBe(false);
  });

  it.each([
    ['a handler function', 'function handler() { return Effect.runSync(program); }'],
    ['a handler assignment', 'const handler = () => Effect.runSync(program);'],
    ['a route property assignment', 'server.route = () => Effect.runSync(program);'],
  ] as const)('detects runSync in %s', (_name, source): void => {
    expect(hasRunSyncInServerRequestHandler(source)).toBe(true);
  });
});
