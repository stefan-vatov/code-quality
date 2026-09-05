import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const performanceGateSource = (): string =>
  readFileSync(fileURLToPath(new URL('../../bench/performance-gate.ts', import.meta.url)), 'utf8');

describe('Effect native performance contracts', (): void => {
  it('provides native scope and traversal services to rule benchmarks', (): void => {
    const source = performanceGateSource();

    expect(source).toContain('isGlobalReference');
    expect(source).toContain('scopeManager');
    expect(source).toContain('visitorKeys');
    expect(source).not.toContain('sourceCode: { text: fixture.source },');
  });

  it('benchmarks retained recursion candidate paths', (): void => {
    const source = performanceGateSource();

    expect(source).toContain("name: 'recursion'");
    expect(source).toContain("ruleName: 'effect-require-suspend-for-recursion'");
  });
});
