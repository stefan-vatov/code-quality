import { describe, expect, it } from 'vitest';
import type { LocalBinding } from '../../src/rules/effect-recursion-local-bindings';
import { hasReturnEffectInGen } from '../../src/rules/effect-default-workflow-helpers';
import { hasTopLevelPipeOperator } from '../../src/rules/effect-strict-segment-helpers';
import { performance } from 'node:perf_hooks';
import { resolveLocalTarget } from '../../src/rules/effect-recursion-local-bindings';

const DEEP_SCAN_SIZES = [10_000, 100_000] as const;
const SCALING_RATIO_LIMIT = 8;
const SCALING_ABSOLUTE_LIMIT_MS = 2_500;
const SCALING_OVERHEAD_MS = 50;

type Attempt<Value> =
  | { readonly kind: 'success'; readonly value: Value }
  | { readonly kind: 'error'; readonly error: string };

const attempt = <Value>(run: () => Value): Attempt<Value> => {
  try {
    return { kind: 'success', value: run() };
  } catch (error) {
    return {
      kind: 'error',
      error: error instanceof Error ? error.name : String(error),
    };
  }
};

const whitespaceSource = (size: number): string => `value.pipe(${' '.repeat(size)}Effect.retry(1))`;

const nonTopLevelOperatorSource = (count: number): string =>
  `value.pipe(${'xEffect.retry() '.repeat(count)})`;

const aliasScope = (depth: number): ReadonlyMap<string, LocalBinding> => {
  const bindings = new Map<string, LocalBinding>();
  for (let index = 0; index < depth; index += 1) {
    bindings.set(`alias${index}`, {
      kind: 'alias',
      name: index + 1 < depth ? `alias${index + 1}` : 'loop',
    });
  }
  return bindings;
};

const nestedEffectGenSource = (depth: number): string => {
  let source = `import { Effect } from 'effect';\n`;
  for (let index = 0; index < depth; index += 1) {
    source += 'Effect.gen(function* () { const nested = ';
  }
  source += '1';
  for (let index = 0; index < depth; index += 1) {
    source += '; return nested; })';
  }
  return source;
};

interface TimingResult {
  readonly elapsedMs: number;
  readonly value: boolean;
}

const measureNestedGenScan = (depth: number): TimingResult => {
  const source = nestedEffectGenSource(depth);
  hasReturnEffectInGen(source);
  const startedAt = performance.now();
  const value = hasReturnEffectInGen(source);
  return { elapsedMs: performance.now() - startedAt, value };
};

describe('remaining source hotspot regressions', (): void => {
  it('keeps strict pipe whitespace backscans stack-safe at deep whitespace runs', (): void => {
    const outcomes = DEEP_SCAN_SIZES.map((size) =>
      attempt((): boolean => hasTopLevelPipeOperator(whitespaceSource(size), 'retry')),
    );

    expect(outcomes).toStrictEqual([
      { kind: 'success', value: true },
      { kind: 'success', value: true },
    ]);
  });

  it('keeps strict pipe operator scans stack-safe across many non-top-level matches', (): void => {
    const outcomes = DEEP_SCAN_SIZES.map((size) =>
      attempt((): boolean => hasTopLevelPipeOperator(nonTopLevelOperatorSource(size), 'retry')),
    );

    expect(outcomes).toStrictEqual([
      { kind: 'success', value: false },
      { kind: 'success', value: false },
    ]);
  });

  it('keeps local recursion alias-chain resolution stack-safe at deep chains', (): void => {
    const outcomes = DEEP_SCAN_SIZES.map((size) =>
      attempt(() => resolveLocalTarget('alias0', 'loop', [aliasScope(size)])),
    );

    expect(outcomes).toStrictEqual([
      { kind: 'success', value: { isSelfCall: true } },
      { kind: 'success', value: { isSelfCall: true } },
    ]);
  });

  it('keeps nested Effect.gen scans near-linear within a bounded CI budget', (): void => {
    const small = measureNestedGenScan(256);
    const large = measureNestedGenScan(1_024);

    expect(small.value).toBe(false);
    expect(large.value).toBe(false);
    expect(large.elapsedMs).toBeLessThan(SCALING_ABSOLUTE_LIMIT_MS);
    expect(large.elapsedMs).toBeLessThan(
      small.elapsedMs * SCALING_RATIO_LIMIT + SCALING_OVERHEAD_MS,
    );
  });
});
