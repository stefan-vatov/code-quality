import { describe, expect, it } from 'vitest';
import { exportedDeclarationTexts } from '../../src/rules/effect-exported-declarations';
import { hasRecursiveEffectSource } from '../../src/rules/effect-recursion-source';
import { performance } from 'node:perf_hooks';

interface Measurement {
  readonly bytes: number;
  readonly elapsedMs: number;
  readonly heapDeltaKB: number;
  readonly inputSize: number;
}

const SAMPLE_COUNT = 3;
const MEASURE_REPETITIONS = 5;

const median = (values: readonly number[]): number => {
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.floor(ordered.length / 2)] ?? 0;
};

const collectGarbage = (): void => {
  const runtime = globalThis as typeof globalThis & { ['gc']?: () => void };
  runtime['gc']?.();
};

const timed = (inputSize: number, bytes: number, invoke: () => void): Measurement => {
  invoke();
  const samples: number[] = [];
  for (let sample = 0; sample < SAMPLE_COUNT; sample += 1) {
    const startedAt = performance.now();
    for (let repetition = 0; repetition < MEASURE_REPETITIONS; repetition += 1) {
      invoke();
    }
    samples.push((performance.now() - startedAt) / MEASURE_REPETITIONS);
  }
  collectGarbage();
  const before = process.memoryUsage().heapUsed;
  invoke();
  const after = process.memoryUsage().heapUsed;
  return {
    bytes,
    elapsedMs: median(samples),
    heapDeltaKB: Math.max(0, after - before) / 1024,
    inputSize,
  };
};

const ratio = (larger: Measurement, smaller: Measurement): number =>
  larger.elapsedMs / Math.max(smaller.elapsedMs, 0.01);

const ratioMessage = (label: string, larger: Measurement, smaller: Measurement): string =>
  `${label}: time ${ratio(larger, smaller).toFixed(2)}x, heap ${(larger.heapDeltaKB / Math.max(smaller.heapDeltaKB, 0.01)).toFixed(2)}x, ` +
  `${smaller.inputSize}/${smaller.bytes} -> ${larger.inputSize}/${larger.bytes}`;

const exportedSource = (count: number, variant: number): string => {
  const names = Array.from({ length: count }, (_, index) => `value${index}`);
  const declarations = names.map((name, index) => `${name} = ${index}`).join(', ');
  return `const ${declarations}, privateValue = Promise.resolve(${variant});\nexport { ${names.join(', ')} };\n`;
};

const exportedMeasurement = (count: number): Measurement => {
  let variant = 0;
  const baselineSource = exportedSource(count, variant);
  const invoke = (): void => {
    variant += 1;
    const declarations = exportedDeclarationTexts(exportedSource(count, variant));
    if (
      declarations.length !== count ||
      declarations.some((declaration) => declaration.includes('privateValue'))
    ) {
      throw new Error(`export projection semantics changed at declaration count ${count}`);
    }
  };
  const baseline = exportedDeclarationTexts(baselineSource);
  if (baseline.length !== count) {
    throw new Error(`export projection count changed at declaration count ${count}`);
  }
  return timed(count, baselineSource.length, invoke);
};

const recursionSource = (count: number): string =>
  `import { Effect } from "effect";\n${Array.from(
    { length: count },
    (_, index) => `const generic${index} = <T,>(value: T): T => value;\n`,
  ).join('')}Effect.succeed(1);\n`;

const recursionMeasurement = (count: number): Measurement => {
  const source = recursionSource(count);
  const invoke = (): void => {
    if (hasRecursiveEffectSource(source)) {
      throw new Error(`generic arrow semantics changed at arrow count ${count}`);
    }
  };
  return timed(count, source.length, invoke);
};

const exportedSmall = exportedMeasurement(256);
const exportedLarge = exportedMeasurement(2048);
const recursionSmall = recursionMeasurement(256);
const recursionLarge = recursionMeasurement(1280);

describe('final immutable-copy local timing audit', (): void => {
  it('keeps exported sibling projection near-linear while preserving private siblings', (): void => {
    expect(exportedDeclarationTexts(exportedSource(4, 30))).toEqual([
      'const value0 = 0;',
      'const value1 = 1;',
      'const value2 = 2;',
      'const value3 = 3;',
    ]);
    expect(
      ratio(exportedLarge, exportedSmall),
      ratioMessage('effect-exported-declarations', exportedLarge, exportedSmall),
    ).toBeLessThan(18);
  });

  it('keeps generic arrow restoration near-linear while preserving recursion semantics', (): void => {
    expect(hasRecursiveEffectSource(recursionSource(4))).toBe(false);
    expect(
      hasRecursiveEffectSource(
        'import { Effect } from "effect"; const recurse = <T,>(value: T): T => Effect.succeed(recurse(value));',
      ),
    ).toBe(true);
    expect(
      ratio(recursionLarge, recursionSmall),
      ratioMessage('effect-recursion-source', recursionLarge, recursionSmall),
    ).toBeLessThan(24);
  });
});
