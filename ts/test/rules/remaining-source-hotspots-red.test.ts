import { describe, expect, it } from 'vitest';
import type { LocalBinding } from '../../src/rules/effect-recursion-local-bindings';
import { resolveLocalTarget } from '../../src/rules/effect-recursion-local-bindings';

const DEEP_SCAN_SIZES = [10_000, 100_000] as const;

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

describe('remaining source hotspot regressions', (): void => {
  it('keeps local recursion alias-chain resolution stack-safe at deep chains', (): void => {
    const outcomes = DEEP_SCAN_SIZES.map((size) =>
      attempt(() => resolveLocalTarget('alias0', 'loop', [aliasScope(size)])),
    );

    expect(outcomes).toStrictEqual([
      { kind: 'success', value: { isSelfCall: true } },
      { kind: 'success', value: { isSelfCall: true } },
    ]);
  });
});
