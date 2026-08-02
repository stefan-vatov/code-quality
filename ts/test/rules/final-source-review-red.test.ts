import { describe, expect, it } from 'vitest';
import { stripComments } from '../../src/rules/effect-source-comments';

describe('final source review regressions', (): void => {
  it('preserves a regex character class after a JSX element', (): void => {
    const source = 'const view = <A></A>; const matcher = /a[//]b/giu;';

    expect(stripComments(source)).toBe(source);
  });
});
