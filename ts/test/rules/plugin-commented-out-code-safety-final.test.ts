import { describe, expect, it } from 'vitest';
import noCommentedOutCodeRule from '../../src/rules/plugin-commented-out-code-rule';

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

describe.each<ScannerMode>(['fallback', 'native'])(
  'comment fix safety with the %s scanner',
  (mode): void => {
    it('reports without fixing a block comment whose removal would merge tokens', (): void => {
      const marker = '/* const dead = compute(); */';
      const source = `const merged = left${marker}right;\n`;
      const comments = mode === 'native' ? [tokenFor(source, marker, 'Block')] : [];
      const reports = runRule(source, mode, comments);

      expect(reports).toHaveLength(1);
      expect(reports[0]?.fix).toBeUndefined();
      expect(applyFixes(source, reports)).toBe(source);
    });

    it('reports without fixing a block comment that contains a restricted-production newline', (): void => {
      const marker = '/* const dead = compute();\n */';
      const source = `function read() {\n  return ${marker}value;\n}\n`;
      const comments = mode === 'native' ? [tokenFor(source, marker, 'Block')] : [];
      const reports = runRule(source, mode, comments);

      expect(reports).toHaveLength(1);
      expect(reports[0]?.fix).toBeUndefined();
      expect(applyFixes(source, reports)).toBe(source);
    });
  },
);

describe.each(['\u2028', '\u2029'])('ECMAScript line terminator %j', (lineTerminator): void => {
  it.each<ScannerMode>(['fallback', 'native'])(
    'terminates an inline line comment in %s mode without deleting live code',
    (mode): void => {
      const marker = '// const dead = true;';
      const source = `live(); ${marker}${lineTerminator}export const survivor = true;\n`;
      const token = tokenFor(source, marker, 'Line');
      const reports = runRule(source, mode, mode === 'native' ? [token] : []);

      expect(fixesFor(reports)).toStrictEqual([{ range: token.range, text: '' }]);
      expect(applyFixes(source, reports)).toBe(
        `live(); ${lineTerminator}export const survivor = true;\n`,
      );
    },
  );

  it.each<ScannerMode>(['fallback', 'native'])(
    'removes a standalone line including its terminator in %s mode',
    (mode): void => {
      const marker = '// const dead = true;';
      const source = `  ${marker}${lineTerminator}export const survivor = true;\n`;
      const token = tokenFor(source, marker, 'Line');
      const reports = runRule(source, mode, mode === 'native' ? [token] : []);

      expect(fixesFor(reports)).toStrictEqual([
        { range: [0, token.end + lineTerminator.length], text: '' },
      ]);
      expect(applyFixes(source, reports)).toBe('export const survivor = true;\n');
    },
  );
});

describe('fallback lexical boundaries', (): void => {
  it.each(['if (ready) /[//]/.test(value);\n', 'if (ready) {}\n/[/*]/.test(value);\n'])(
    'keeps a regex expression statement byte-identical in %j',
    (source): void => {
      const reports = runRule(source, 'fallback');

      expect(reports).toEqual([]);
      expect(applyFixes(source, reports)).toBe(source);
    },
  );

  it.each([
    'const view = <section>// const fake = true;\ncontent</section>;\n',
    'const view = <section>/* const fake = true; */</section>;\n',
  ])('ignores JSX raw text byte-for-byte in %j', (source): void => {
    const reports = runRule(source, 'fallback');

    expect(reports).toEqual([]);
    expect(applyFixes(source, reports)).toBe(source);
  });

  it.each([
    '#!/usr/bin/env -S node // const fake = true;\nexport const live = true;\n',
    '#!/usr/bin/env -S node /* const fake = true; */\nexport const live = true;\n',
  ])('treats a hashbang as opaque in %j', (source): void => {
    const reports = runRule(source, 'fallback');

    expect(reports).toEqual([]);
    expect(applyFixes(source, reports)).toBe(source);
  });
});

describe.each<ScannerMode>(['fallback', 'native'])(
  'embedded expression comments with the %s scanner',
  (mode): void => {
    it('detects and safely fixes a real comment in a JSX expression', (): void => {
      const marker = '/* const dead = true; */';
      const source = `const view = <section>{${marker}}{value}</section>;\n`;
      const token = tokenFor(source, marker, 'Block');
      const reports = runRule(source, mode, mode === 'native' ? [token] : []);

      expect(fixesFor(reports)).toStrictEqual([{ range: token.range, text: '' }]);
      expect(applyFixes(source, reports)).toBe('const view = <section>{}{value}</section>;\n');
    });

    it('ignores template raw chunks while detecting and fixing comments in interpolation', (): void => {
      const lineMarker = '// const deadLine = true;';
      const blockMarker = '/* const deadBlock = false; */';
      const source =
        'const text = `raw // const fakeLine = true; ${(() => { ' +
        `${lineMarker}\nreturn ${blockMarker} value; })()} ` +
        'tail /* const fakeBlock = false; */`;\n';
      const lineToken = tokenFor(source, lineMarker, 'Line');
      const blockToken = tokenFor(source, blockMarker, 'Block');
      const comments = mode === 'native' ? [lineToken, blockToken] : [];
      const reports = runRule(source, mode, comments);

      expect(fixesFor(reports)).toStrictEqual([
        { range: lineToken.range, text: '' },
        { range: blockToken.range, text: '' },
      ]);
      expect(applyFixes(source, reports)).toBe(
        'const text = `raw // const fakeLine = true; ${(() => { \n' +
          'return  value; })()} tail /* const fakeBlock = false; */`;\n',
      );
    });
  },
);

describe('native parser token boundary preservation', (): void => {
  it('ignores JSX raw text when the parser exposes no comment token', (): void => {
    const source = 'const view = <section>// const fake = true;</section>;\n';
    const reports = runRule(source, 'native');

    expect(reports).toEqual([]);
    expect(applyFixes(source, reports)).toBe(source);
  });

  it('keeps hashbang content opaque when the parser exposes no comment token', (): void => {
    const source = '#!/usr/bin/env node // const fake = true;\nexport const live = true;\n';
    const reports = runRule(source, 'native');

    expect(reports).toEqual([]);
    expect(applyFixes(source, reports)).toBe(source);
  });
});
