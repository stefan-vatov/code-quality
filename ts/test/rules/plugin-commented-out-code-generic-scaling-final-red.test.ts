import { describe, expect, it } from 'vitest';
import noCommentedOutCodeRule from '../../src/rules/plugin-commented-out-code-rule';
import { scanSourceComments } from '../../src/rules/plugin-commented-out-code-source-scanner';

interface Report {
  message: string;
}

const runFallbackRule = (source: string): readonly Report[] => {
  const reports: Report[] = [];
  const context = {
    report: (report: Report): void => {
      reports.push(report);
    },
    sourceCode: { text: source },
  } as unknown as Parameters<typeof noCommentedOutCodeRule.create>[0];

  noCommentedOutCodeRule.create(context).Program?.({ body: [], type: 'Program' } as never);
  return reports;
};

const countScannedComments = (source: string): number => {
  let commentCount = 0;
  scanSourceComments(source, (): void => {
    commentCount += 1;
  });
  return commentCount;
};

describe('fallback scanning of TypeScript generic syntax', (): void => {
  it('keeps angle-bracket assertions, generic calls, slash-like strings, and regex opaque', (): void => {
    const source = [
      'type SlashLike<Path extends string> = { readonly matcher: RegExp; readonly path: Path };',
      "const asserted = <SlashLike<'https://example.test/a//b'>>{",
      '  matcher: /https?:\\/\\/[^/]+\\/[/*]/,',
      "  path: '/* const fake = true; */',",
      '};',
      "const decoded = decode<SlashLike<'// not a comment'>>(asserted);",
      "const nested = decode<Result<SlashLike<'/a/*/b/'>>>(decoded);",
      '',
    ].join('\n');

    expect(countScannedComments(source)).toBe(0);
    expect(runFallbackRule(source)).toEqual([]);
  });

  it('preserves deep legitimate TSX and ignores comment-shaped raw text', (): void => {
    const depth = 256;
    const source =
      `const view = <Panel>${'<Layer>'.repeat(depth)}` +
      '/* const fake = true; */' +
      `${'</Layer>'.repeat(depth)}</Panel>;\n`;

    expect(countScannedComments(source)).toBe(0);
    expect(runFallbackRule(source)).toEqual([]);
  });

  it('still finds a genuine comment in a deeply nested TSX expression', (): void => {
    const depth = 256;
    const source =
      `const view = <Panel>${'<Layer>'.repeat(depth)}` +
      '{/* const dead = compute(); */ liveValue}' +
      `${'</Layer>'.repeat(depth)}</Panel>;\n`;

    expect(countScannedComments(source)).toBe(1);
    expect(runFallbackRule(source)).toHaveLength(1);
  });
});
