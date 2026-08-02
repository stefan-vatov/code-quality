import { describe, expect, it } from 'vitest';
import { bindingPatternNames } from '../../src/rules/effect-export-binding-patterns';

describe('remaining source recursion regressions', (): void => {
  it('keeps deeply nested export binding patterns stack-safe', (): void => {
    const depth = 2_000;
    const source = `${'['.repeat(depth)}name${']'.repeat(depth)}`;

    expect(bindingPatternNames(source, 0, source.length)).toEqual(['name']);
  });
});
