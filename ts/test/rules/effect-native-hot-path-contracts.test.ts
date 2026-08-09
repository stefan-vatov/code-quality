import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

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

  it('benchmarks only retained recursion and global-fetch candidate paths', (): void => {
    const source = performanceGateSource();

    expect(source).toContain("name: 'recursion'");
    expect(source).toContain("ruleName: 'effect-require-suspend-for-recursion'");
    expect(source).toContain("name: 'native'");
    expect(source).toContain("ruleName: 'effect-no-global-fetch'");
  });
});
