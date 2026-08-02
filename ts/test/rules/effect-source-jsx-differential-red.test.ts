import { describe, expect, it } from 'vitest';
import { parseSync } from 'oxc-parser';
import { stripComments } from '../../src/rules/effect-source-comments';

const source = String.raw`const x = <A>raw // text<B>{/[//]/ /* c */}</B></A>;`;

const projectComments = (): string => {
  const parsed = parseSync('effect-source-jsx-differential-red.tsx', source, {
    sourceType: 'module',
  });
  const projected = source.split('');
  for (const { start, end } of parsed.comments) {
    for (let index = start; index < end; index += 1) {
      if (!'\n\r\u2028\u2029'.includes(source.charAt(index))) {
        projected[index] = ' ';
      }
    }
  }
  return projected.join('');
};

describe('TSX JSX lexical differential RED', (): void => {
  it('keeps nested JSX after raw // text and a regex character class', (): void => {
    const parsed = parseSync('effect-source-jsx-differential-red.tsx', source, {
      sourceType: 'module',
    });

    expect(parsed.errors).toHaveLength(0);
    expect(stripComments(source)).toBe(projectComments());
  });
});
