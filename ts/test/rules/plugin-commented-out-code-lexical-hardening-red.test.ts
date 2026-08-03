import { describe, expect, it } from 'vitest';
import noCommentedOutCodeRule from '../../src/rules/plugin-commented-out-code-rule';
import { scanSourceComments } from '../../src/rules/plugin-commented-out-code-source-scanner';

interface Fix {
  range: [number, number];
  text: string;
}

interface Fixer {
  removeRange(range: [number, number]): Fix;
}

interface Report {
  fix?: (fixer: Fixer) => Fix;
  message: string;
  node: object;
}

interface CommentToken {
  end: number;
  range: [number, number];
  start: number;
  type: 'Block' | 'Line';
  value: string;
}

type ScannerMode = 'fallback' | 'native';

const fixer: Fixer = {
  removeRange: (range): Fix => ({ range, text: '' }),
};

const tokenFor = (source: string, marker: string, type: CommentToken['type']): CommentToken => {
  const start = source.indexOf(marker);
  const end = start + marker.length;
  return {
    end,
    range: [start, end],
    start,
    type,
    value: source.slice(start + 2, type === 'Block' ? end - 2 : end),
  };
};

const runRule = (
  source: string,
  mode: ScannerMode,
  comments: readonly CommentToken[] = [],
): readonly Report[] => {
  const reports: Report[] = [];
  const sourceCode =
    mode === 'native'
      ? {
          getAllComments: (): readonly CommentToken[] => comments,
          text: source,
        }
      : { text: source };
  const context = {
    report: (report: Report): void => {
      reports.push(report);
    },
    sourceCode,
  } as unknown as Parameters<typeof noCommentedOutCodeRule.create>[0];

  noCommentedOutCodeRule.create(context).Program?.({ body: [], type: 'Program' } as never);
  return reports;
};

const fixesFor = (reports: readonly Report[]): readonly Fix[] =>
  reports.flatMap((report): readonly Fix[] => {
    const fix = report.fix;
    if (fix === undefined) {
      return [];
    }
    return [fix(fixer)];
  });

const applyFixes = (source: string, reports: readonly Report[]): string =>
  fixesFor(reports)
    .toSorted((left, right): number => right.range[0] - left.range[0])
    .reduce(
      (fixedSource, fix): string =>
        fixedSource.slice(0, fix.range[0]) + fix.text + fixedSource.slice(fix.range[1]),
      source,
    );

const expectByteIdentical = (source: string, reports: readonly Report[]): void => {
  expect(fixesFor(reports)).toEqual([]);
  expect(applyFixes(source, reports)).toBe(source);
};

describe.each<ScannerMode>(['fallback', 'native'])(
  'numeric member-access fix safety in %s mode',
  (mode): void => {
    it('reports without joining an integer literal to a property-access dot', (): void => {
      const marker = '/* const dead = compute(); */';
      const source = `const rendered = 1${marker}.toString();\n`;
      const comments = mode === 'native' ? [tokenFor(source, marker, 'Block')] : [];
      const reports = runRule(source, mode, comments);

      expect(reports).toHaveLength(1);
      expect(reports[0]?.fix).toBeUndefined();
      expectByteIdentical(source, reports);
    });

    it('keeps already valid spaced numeric member access byte-identical', (): void => {
      const source = 'const rendered = 1 .toString();\n';
      const reports = runRule(source, mode);

      expect(reports).toEqual([]);
      expectByteIdentical(source, reports);
    });
  },
);

describe.each<ScannerMode>(['fallback', 'native'])(
  'JSX fragment raw-text safety in %s mode',
  (mode): void => {
    it.each([
      'const view = <>// const fake = true;\n<span>live</span></>;\n',
      'const view = <>/* const fake = true; */<span>live</span></>;\n',
    ])('keeps raw fragment text byte-identical in %j', (source): void => {
      const reports = runRule(source, mode);

      expect(reports).toEqual([]);
      expectByteIdentical(source, reports);
    });

    it('keeps nested fragment and element raw text byte-identical', (): void => {
      const source =
        'const view = <><section>/* const fake = true; */</section>' +
        '<>// const alsoFake = false;</></>;\n';
      const reports = runRule(source, mode);

      expect(reports).toEqual([]);
      expectByteIdentical(source, reports);
    });
  },
);

describe.each<ScannerMode>(['fallback', 'native'])(
  'JavaScript comments embedded in TSX with the %s scanner',
  (mode): void => {
    it('detects a genuine comment inside a JSX attribute expression', (): void => {
      const marker = '/* const dead = compute(); */';
      const source = `const view = <Widget value={${marker} liveValue} />;\n`;
      const token = tokenFor(source, marker, 'Block');
      const reports = runRule(source, mode, mode === 'native' ? [token] : []);

      expect(reports).toHaveLength(1);
      expect(fixesFor(reports)).toStrictEqual([{ range: token.range, text: '' }]);
      expect(applyFixes(source, reports)).toBe('const view = <Widget value={ liveValue} />;\n');
    });

    it('ignores comment-shaped text inside a quoted JSX attribute', (): void => {
      const source = 'const view = <Widget label="/* const fake = true; */" />;\n';
      const reports = runRule(source, mode);

      expect(reports).toEqual([]);
      expectByteIdentical(source, reports);
    });
  },
);

describe.each<ScannerMode>(['fallback', 'native'])(
  'regex and division state transitions with the %s scanner',
  (mode): void => {
    it('preserves regex state across a real comment between a control keyword and paren', (): void => {
      const marker = '/* const dead = compute(); */';
      const source = `if${marker} (ready) /[//]/.test(value);\n`;
      const token = tokenFor(source, marker, 'Block');
      const reports = runRule(source, mode, mode === 'native' ? [token] : []);

      expect(reports).toHaveLength(1);
      expect(fixesFor(reports)).toStrictEqual([{ range: token.range, text: '' }]);
      expect(applyFixes(source, reports)).toBe('if (ready) /[//]/.test(value);\n');
    });

    it('finds a real comment after object-literal division', (): void => {
      const marker = '/* const dead = compute(); */';
      const source =
        `const ratio = ({ value: 4 } / divisor); ${marker}\n` + 'export const live = ratio;\n';
      const token = tokenFor(source, marker, 'Block');
      const reports = runRule(source, mode, mode === 'native' ? [token] : []);

      expect(reports).toHaveLength(1);
      expect(fixesFor(reports)).toStrictEqual([{ range: token.range, text: '' }]);
      expect(applyFixes(source, reports)).toBe(
        'const ratio = ({ value: 4 } / divisor); \nexport const live = ratio;\n',
      );
    });

    it('keeps object-literal division without a comment byte-identical', (): void => {
      const source = 'const ratio = ({ value: 4 } / divisor);\n';
      const reports = runRule(source, mode);

      expect(reports).toEqual([]);
      expectByteIdentical(source, reports);
    });
  },
);

const nestedTSX = (depth: number): string =>
  `const view = ${'<Layer>'.repeat(depth)}live${'</Layer>'.repeat(depth)};\n`;

const countScannedComments = (source: string): number => {
  let commentCount = 0;
  scanSourceComments(source, (): void => {
    commentCount += 1;
  });
  return commentCount;
};

describe('deep valid TSX fallback scanning', (): void => {
  it.each([100, 1_000, 5_000])('terminates without reports or fixes at depth %i', (depth): void => {
    const source = nestedTSX(depth);
    const reports = runRule(source, 'fallback');

    expect(countScannedComments(source)).toBe(0);
    expect(reports).toEqual([]);
    expectByteIdentical(source, reports);
  });
});
