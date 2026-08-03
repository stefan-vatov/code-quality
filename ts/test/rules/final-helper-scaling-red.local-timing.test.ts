import { describe, expect, it } from 'vitest';
import {
  hasCastAfterSchemaDecode,
  hasUnhandledSchemaEffectDecode,
} from '../../src/rules/effect-default-schema-helpers';
import { hasParsedJSONNumberFromString } from '../../src/rules/effect-default-workflow-helpers';
import { parseSync } from 'oxc-parser';
import { performance } from 'node:perf_hooks';

const SCALE_COUNTS = [128, 256, 512, 1_024, 2_048] as const;
const SAMPLE_COUNT = 5;
const MAX_SCALING_RATIO = 48;
const MAX_LARGE_ELAPSED_MS = 5_000;

type SourceHelper = (source: string) => boolean;

interface ScalingFixture {
  readonly count: number;
  readonly source: string;
}

const median = (samples: readonly number[]): number => {
  const sorted = [...samples].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
};

const measure = (helper: SourceHelper, source: string): number => {
  helper(source);
  return median(
    Array.from({ length: SAMPLE_COUNT }, (): number => {
      const startedAt = performance.now();
      helper(source);
      return performance.now() - startedAt;
    }),
  );
};

const parseFixture = (name: string, source: string): void => {
  const parsed = parseSync(name, source, { sourceType: 'module' });
  expect(parsed.errors, name).toHaveLength(0);
};

const workflowSource = (count: number): string =>
  `const payload = '{}'; const values = [${'JSON.parse(payload), '.repeat(count)}null];`;

const schemaSuffixSource = (count: number): string => {
  const declarations = Array.from(
    { length: count },
    (_, index): string => `const value${index} = Schema.decodeUnknown(Schema.String)(input);`,
  ).join(' ');
  const yields = Array.from({ length: count }, (_, index): string => `yield* value${index};`).join(
    ' ',
  );
  return `import { Effect, Schema } from 'effect'; declare const input: unknown; const program = Effect.gen(function* () { ${declarations} ${yields} });`;
};

const schemaLineSource = (count: number): string => {
  const declarations = Array.from(
    { length: count },
    (_, index): string => `const value${index} = Schema.decodeUnknown(Schema.String)(input);`,
  ).join(' ');
  return `import { Schema } from 'effect'; declare const input: unknown; ${declarations}`;
};

const validateScalingFixtures = (
  name: string,
  factory: (count: number) => string,
  helper: SourceHelper,
  expected: boolean,
): readonly [ScalingFixture, ScalingFixture] => {
  const fixtures = SCALE_COUNTS.map((count): ScalingFixture => {
    const source = factory(count);
    parseFixture(`${name}-${count}.ts`, source);
    expect(helper(source), `${name}-${count}`).toBe(expected);
    return { count, source };
  });
  const first = fixtures[0];
  const last = fixtures[fixtures.length - 1];
  if (first === undefined || last === undefined) {
    throw new Error(`No scaling fixtures were generated for ${name}`);
  }
  return [first, last];
};

const assertBoundedScaling = (
  name: string,
  factory: (count: number) => string,
  helper: SourceHelper,
  expected: boolean,
): void => {
  const [small, large] = validateScalingFixtures(name, factory, helper, expected);
  const smallElapsedMs = measure(helper, small.source);
  const largeElapsedMs = measure(helper, large.source);
  const ratio = largeElapsedMs / Math.max(smallElapsedMs, Number.EPSILON);
  const summary = `${name} ${small.count}->${large.count}: ${smallElapsedMs.toFixed(2)}ms -> ${largeElapsedMs.toFixed(2)}ms (${ratio.toFixed(1)}x)`;

  expect(largeElapsedMs, summary).toBeLessThanOrEqual(MAX_LARGE_ELAPSED_MS);
  expect(largeElapsedMs, summary).toBeLessThan(
    smallElapsedMs * MAX_SCALING_RATIO + MAX_LARGE_ELAPSED_MS / 1_000,
  );
};

describe('final default-helper scaling regressions', (): void => {
  it('keeps JSON parse number detection bounded on one large statement', (): void => {
    assertBoundedScaling(
      'workflow-json-parse',
      workflowSource,
      hasParsedJSONNumberFromString,
      false,
    );
  });

  it('keeps handled schema decode scans bounded on one large workflow', (): void => {
    assertBoundedScaling(
      'schema-unhandled-decode',
      schemaSuffixSource,
      hasUnhandledSchemaEffectDecode,
      false,
    );
  });

  it('keeps schema decode cast scans bounded on one large line', (): void => {
    assertBoundedScaling('schema-decode-cast', schemaLineSource, hasCastAfterSchemaDecode, false);
  });
});
