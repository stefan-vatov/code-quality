import { describe, expect, it } from 'vitest';
import { formatJSDoc, formatMainHeader, formatSubheader } from '../../src/codemods/comment-format';

describe('comment-format', () => {
  it('formats JSDoc with text on its own comment line', () => {
    expect(
      formatJSDoc({
        summary: 'Internal helper exported for package-local composition.',
        tags: ['@internal'],
      }),
    ).toBe(`/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
`);
  });

  it('formats top-level internal JSDoc without same-line prose', () => {
    expect(
      formatJSDoc({
        summary: 'Conservative codemod for safe func-style declaration rewrites.',
        tags: ['@internal'],
      }),
    ).toBe(`/**
 * Conservative codemod for safe func-style declaration rewrites.
 *
 * @internal
 */
`);
  });

  it('formats centered divider comments for reusable section headers', () => {
    expect(formatMainHeader('Header comment'))
      .toBe(`/* -------------------------------------------------------------------------- */
/*                               Header comment                               */
/* -------------------------------------------------------------------------- */`);

    expect(formatSubheader('Header comment')).toBe(
      '/* ----------------------------- Header comment ----------------------------- */',
    );
  });

  it('wraps long divider comments instead of creating overlong lines', () => {
    expect(
      formatMainHeader(
        'Detection heuristic for commented-out source code. Checks whether a comment text content looks like code rather than natural language.',
      ),
    ).toBe(`/* -------------------------------------------------------------------------- */
/*    Detection heuristic for commented-out source code. Checks whether a     */
/*     Comment text content looks like code rather than natural language.     */
/* -------------------------------------------------------------------------- */`);
  });
});
