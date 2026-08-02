import { describe, expect, it } from 'vitest';
import { parseSync } from 'oxc-parser';
import { stripComments } from '../../src/rules/effect-source-comments';
import { stripCommentsAndStrings } from '../../src/rules/effect-source-scan';

interface CommentSpan {
  readonly end: number;
  readonly start: number;
}

const sourceWithJSXCommentMarkers = (): string =>
  [
    'const view = <Layout data-url="https://example.test/a//attribute" data-note="/* attribute */">',
    '{/* jsx expression */}<Panel title="https://nested.example/p//attribute /* attribute */">',
    '😀 /* raw block */ https://raw.example/path//text <Leaf>nested /* raw block */</Leaf>',
    '</Panel>{value /* expression comment */}</Layout>; const after = 1; // trailing',
    '',
  ].join('');

const parseTSX = (source: string): ReturnType<typeof parseSync> => {
  const parsed = parseSync('effect-source-tsx-comments.tsx', source, { sourceType: 'module' });
  expect(parsed.errors).toHaveLength(0);
  return parsed;
};

const projectComments = (source: string, comments: readonly CommentSpan[]): string => {
  const projected = source.split('');
  for (const { start, end } of comments) {
    for (let index = start; index < end; index += 1) {
      const character = source.charAt(index);
      if (
        character !== '\n' &&
        character !== '\r' &&
        character !== '\u2028' &&
        character !== '\u2029'
      ) {
        projected[index] = ' ';
      }
    }
  }
  return projected.join('');
};

describe('TSX source comment projections', (): void => {
  it('uses parser comments to strip only real comments from nested JSX source', (): void => {
    const source = sourceWithJSXCommentMarkers();
    const parsed = parseTSX(source);
    const commentTexts = parsed.comments.map(({ start, end }) => source.slice(start, end));
    const expectedCommentTexts = [
      '/* jsx expression */',
      '/* expression comment */',
      '// trailing',
    ];

    expect(commentTexts).toEqual(expectedCommentTexts);

    const stripped = stripComments(source);

    expect(stripped).toBe(projectComments(source, parsed.comments));
    expect(stripped).toHaveLength(source.length);
    expect(stripped.indexOf('😀')).toBe(source.indexOf('😀'));
    expect(stripped.indexOf('const after = 1;')).toBe(source.indexOf('const after = 1;'));
    for (const marker of [
      'https://example.test/a//attribute',
      '/* attribute */',
      '/* raw block */',
      'https://raw.example/path//text',
      'nested /* raw block */',
    ]) {
      const markerStart = source.indexOf(marker);
      expect(stripped.slice(markerStart, markerStart + marker.length)).toBe(marker);
    }
  });

  it('keeps live code after JSX text while stripping comments and strings at UTF-16 offsets', (): void => {
    const source = sourceWithJSXCommentMarkers();
    const parsed = parseTSX(source);
    const stripped = stripCommentsAndStrings(source);
    const afterStatement = 'const after = 1;';
    const afterStart = source.indexOf(afterStatement);

    expect(stripped).toHaveLength(source.length);
    expect(stripped.indexOf(afterStatement)).toBe(afterStart);
    expect(stripped.slice(afterStart, afterStart + afterStatement.length)).toBe(afterStatement);
    for (const { start, end } of parsed.comments) {
      expect(stripped.slice(start, end)).toBe(' '.repeat(end - start));
    }
  });
});
