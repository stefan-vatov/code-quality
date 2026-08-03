import { describe, expect, it } from 'vitest';
import { hasRecursiveEffectSource } from '../../src/rules/effect-recursion-source';
import { performance } from 'node:perf_hooks';

const nestedFunctionSource = (depth: number): string => {
  let body = 'Effect.succeed(0);';
  for (let index = depth - 1; index >= 0; index -= 1) {
    body = `function f${index}() { ${body} }`;
  }
  return `import { Effect } from 'effect'; ${body}`;
};

const measure = (depth: number): number => {
  const source = nestedFunctionSource(depth);
  expect(hasRecursiveEffectSource(source)).toBe(false);
  hasRecursiveEffectSource(source);
  const startedAt = performance.now();
  expect(hasRecursiveEffectSource(source)).toBe(false);
  return performance.now() - startedAt;
};

describe('remaining custom-rule allocation local timing', (): void => {
  it('keeps nested source fallback scans near-linear as function depth grows', (): void => {
    const smallDuration = measure(96);
    const largeDuration = measure(768);

    expect(largeDuration / smallDuration).toBeLessThan(18);
  }, 15_000);
});
