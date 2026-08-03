import { describe, expect, it } from 'vitest';
import {
  hasCastAfterSchemaDecode,
  hasUnhandledSchemaEffectDecode,
} from '../../src/rules/effect-default-schema-helpers';
import {
  hasForkBeforeTestClockAdjust,
  hasRealSleepWithoutTestClock,
  hasTestClockWithoutEffectContext,
} from '../../src/rules/effect-default-test-helpers';
import { hasParsedJSONNumberFromString } from '../../src/rules/effect-default-workflow-helpers';
import { parseSync } from 'oxc-parser';

interface SemanticFixture {
  readonly expected: boolean;
  readonly helper: SourceHelper;
  readonly name: string;
  readonly source: string;
}

const parseFixture = (name: string, source: string): void => {
  const parsed = parseSync(name, source, { sourceType: 'module' });
  expect(parsed.errors, name).toHaveLength(0);
};

const testAdjustmentSource = (count: number): string =>
  `import { Effect } from 'effect'; import { it } from '@effect/vitest'; declare const task: unknown; it.effect('many', () => { ${'Effect.fork(task); TestClock.adjust("1 second"); '.repeat(count)} });`;

describe('final default-helper scaling regressions', (): void => {
  it('preserves parser-valid helper semantics across adjacent candidates', (): void => {
    const fixtures: readonly SemanticFixture[] = [
      {
        expected: true,
        helper: hasParsedJSONNumberFromString,
        name: 'workflow-positive',
        source: 'const age = JSON.parse(input) as Schema.NumberFromString;',
      },
      {
        expected: true,
        helper: hasCastAfterSchemaDecode,
        name: 'schema-cast-positive',
        source: 'const value = Schema.decodeUnknown(Schema.String)(input) as string;',
      },
      {
        expected: true,
        helper: hasUnhandledSchemaEffectDecode,
        name: 'schema-unhandled-positive',
        source: 'const value = Schema.decodeUnknown(Schema.String)(input); consume(value);',
      },
      {
        expected: true,
        helper: hasForkBeforeTestClockAdjust,
        name: 'test-fork-positive',
        source: "it.effect('clock', () => { Effect.fork(task); TestClock.adjust('1 second'); });",
      },
      {
        expected: true,
        helper: hasRealSleepWithoutTestClock,
        name: 'test-sleep-positive',
        source: "it.effect('sleep', () => { Effect.sleep('1 second'); });",
      },
      {
        expected: true,
        helper: hasTestClockWithoutEffectContext,
        name: 'test-clock-positive',
        source: "it('clock', () => { TestClock.adjust('1 second'); });",
      },
      {
        expected: false,
        helper: hasForkBeforeTestClockAdjust,
        name: 'test-fork-negative',
        source: "it.effect('clock', () => { TestClock.adjust('1 second'); });",
      },
    ];

    for (const fixture of fixtures) {
      parseFixture(`${fixture.name}.ts`, fixture.source);
      expect(fixture.helper(fixture.source), fixture.name).toBe(fixture.expected);
    }
  });

  it('keeps test-clock candidate semantics after range indexing', (): void => {
    const source = testAdjustmentSource(2_048);
    parseFixture('test-clock-adjustments.ts', source);
    expect(hasForkBeforeTestClockAdjust(source)).toBe(true);
  });
});
