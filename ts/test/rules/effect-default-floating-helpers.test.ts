import { describe, expect, it } from 'vitest';
import { hasFloatingEffect } from '../../src/rules/effect-default-floating-helpers';

describe('effect-default-floating-helpers rule logic', (): void => {
  it('completes a scan of 10,000 short lines without overflowing the call stack', (): void => {
    const source = [
      'import { Effect } from "effect";',
      ...Array.from({ length: 9_999 }, (): string => 'const value = 1;'),
    ].join('\n');

    expect((): boolean => hasFloatingEffect(source)).not.toThrow();
  });
});
