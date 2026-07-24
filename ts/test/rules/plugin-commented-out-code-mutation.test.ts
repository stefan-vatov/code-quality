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

interface RunResult {
  node: object;
  reports: Report[];
}

interface CommentToken {
  end: number;
  range: [number, number];
  start: number;
  type: 'Block' | 'Line';
  value: string;
}

const fixer: Fixer = {
  removeRange: (range): Fix => ({ range, text: '' }),
};

const runRule = (
  source: string,
  useCreateOnce = false,
  comments?: readonly CommentToken[],
): RunResult => {
  const reports: Report[] = [];
  const node = { body: [], type: 'Program' };
  const sourceCode =
    comments === undefined
      ? { text: source }
      : {
          getAllComments: (): readonly CommentToken[] => comments,
          text: source,
        };
  const context = {
    report: (report: Report): void => {
      reports.push(report);
    },
    sourceCode,
  } as unknown as Parameters<typeof noCommentedOutCodeRule.create>[0];
  const create = useCreateOnce ? noCommentedOutCodeRule.createOnce : noCommentedOutCodeRule.create;

  create(context).Program?.(node as never);
  return { node, reports };
};

const commentToken = (source: string, marker: string, type: CommentToken['type']): CommentToken => {
  const start = source.indexOf(marker);
  const suffixLength = ((): number => {
    if (type === 'Block') {
      return 2;
    }
    return 0;
  })();
  const end = start + marker.length - (type === 'Line' && marker.endsWith('\n') ? 1 : 0);
  return {
    end,
    range: [start, end],
    start,
    type,
    value: source.slice(start + 2, end - suffixLength),
  };
};

const fixesFor = (reports: readonly Report[]): readonly Fix[] =>
  reports.map((report): Fix => {
    const fix = report.fix;
    expect(fix).toBeTypeOf('function');
    return fix?.(fixer) ?? { range: [-1, -1], text: 'missing fix' };
  });

const applyFix = (source: string, fix: Fix): string =>
  source.slice(0, fix.range[0]) + fix.text + source.slice(fix.range[1]);

const applyFixes = (source: string, reports: readonly Report[]): string =>
  fixesFor(reports)
    .toSorted((left, right): number => right.range[0] - left.range[0])
    .reduce((fixedSource, fix): string => applyFix(fixedSource, fix), source);

describe('commented-out-code plugin scanner mutation contracts', (): void => {
  it('reports a terminated block comment on the exact Program node with guidance and fix', (): void => {
    const comment = '/* const dead = true; */';
    const result = runRule(`${comment}\nexport const live = true;\n`);

    expect(result.reports).toHaveLength(1);
    expect(result.reports[0]?.node).toBe(result.node);
    expect(result.reports[0]?.message).toContain(
      'Commented-out code is dead code and wastes agent context.',
    );
    expect(result.reports[0]?.message).toContain(
      'Fix: Delete the commented code. If it is still needed, restore it as live code with tests.',
    );
    expect(result.reports[0]?.message).toContain(
      'Example:\n```ts\nconst live = computeValue();\n```',
    );
    expect(fixesFor(result.reports)).toStrictEqual([{ range: [0, comment.length], text: '' }]);
  });

  it('removes an unterminated block comment through end of file', (): void => {
    const source = '/* const dead = true;';
    const result = runRule(source);

    expect(result.reports).toHaveLength(1);
    expect(fixesFor(result.reports)).toStrictEqual([{ range: [0, source.length], text: '' }]);
  });

  it('removes a line comment without a trailing newline through end of file', (): void => {
    const source = '// const dead = true;';
    const result = runRule(source);

    expect(result.reports).toHaveLength(1);
    expect(fixesFor(result.reports)).toStrictEqual([{ range: [0, source.length], text: '' }]);
  });

  it('preserves LF after an inline native line-comment fix', (): void => {
    const source = 'foo(); // const dead = 1;\nbar();';
    const marker = '// const dead = 1;';
    const token = commentToken(source, marker, 'Line');
    const result = runRule(source, false, [token]);

    expect(result.reports).toHaveLength(1);
    const fixes = fixesFor(result.reports);
    expect(fixes).toStrictEqual([{ range: token.range, text: '' }]);
    const actualFix = fixes.at(0);
    expect(actualFix === undefined ? source : applyFix(source, actualFix)).toBe('foo(); \nbar();');
  });

  it('removes indentation and LF with a standalone native line-comment fix', (): void => {
    const prefix = 'foo();\n';
    const indentation = '    ';
    const marker = '// const dead = 1;';
    const source = `${prefix}${indentation}${marker}\nbar();`;
    const token = commentToken(source, marker, 'Line');
    const expectedRange: [number, number] = [prefix.length, token.end + 1];
    const result = runRule(source, false, [token]);

    expect(result.reports).toHaveLength(1);
    const fixes = fixesFor(result.reports);
    expect(fixes).toStrictEqual([{ range: expectedRange, text: '' }]);
    const actualFix = fixes.at(0);
    expect(actualFix === undefined ? source : applyFix(source, actualFix)).toBe('foo();\nbar();');
  });

  it('preserves CRLF after an inline native line-comment fix', (): void => {
    const source = 'foo(); // const dead = 1;\r\nbar();';
    const marker = '// const dead = 1;';
    const token = commentToken(source, marker, 'Line');
    const result = runRule(source, false, [token]);

    expect(result.reports).toHaveLength(1);
    const fixes = fixesFor(result.reports);
    expect(fixes).toStrictEqual([{ range: token.range, text: '' }]);
    const actualFix = fixes.at(0);
    expect(actualFix === undefined ? source : applyFix(source, actualFix)).toBe(
      'foo(); \r\nbar();',
    );
  });

  it('removes an inline native line comment through EOF', (): void => {
    const source = 'foo(); // const dead = 1;';
    const marker = '// const dead = 1;';
    const token = commentToken(source, marker, 'Line');
    const result = runRule(source, false, [token]);

    expect(result.reports).toHaveLength(1);
    const fixes = fixesFor(result.reports);
    expect(fixes).toStrictEqual([{ range: token.range, text: '' }]);
    const actualFix = fixes.at(0);
    expect(actualFix === undefined ? source : applyFix(source, actualFix)).toBe('foo(); ');
  });

  it.each(['\n', '\r\n'])(
    'preserves the %j line ending after a fallback inline line-comment fix',
    (lineEnding): void => {
      const marker = '// const dead = true;';
      const source = `function live() {${lineEnding}  return ${marker}${lineEnding}  value;${lineEnding}}${lineEnding}`;
      const expected = `function live() {${lineEnding}  return ${lineEnding}  value;${lineEnding}}${lineEnding}`;
      const start = source.indexOf(marker);
      const result = runRule(source);

      expect({
        fixedSource: applyFixes(source, result.reports),
        fixes: fixesFor(result.reports),
        reportCount: result.reports.length,
      }).toStrictEqual({
        fixedSource: expected,
        fixes: [{ range: [start, start + marker.length], text: '' }],
        reportCount: 1,
      });
    },
  );

  it.each(['\n', '\r\n'])(
    'consumes indentation and the %j line ending for a standalone fallback comment',
    (lineEnding): void => {
      const marker = '// const dead = true;';
      const prefix = `live();${lineEnding}`;
      const source = `${prefix}    ${marker}${lineEnding}next();${lineEnding}`;
      const result = runRule(source);

      expect({
        fixedSource: applyFixes(source, result.reports),
        fixes: fixesFor(result.reports),
        reportCount: result.reports.length,
      }).toStrictEqual({
        fixedSource: `${prefix}next();${lineEnding}`,
        fixes: [
          {
            range: [prefix.length, prefix.length + 4 + marker.length + lineEnding.length],
            text: '',
          },
        ],
        reportCount: 1,
      });
    },
  );

  it('continues after a line comment and then a block comment', (): void => {
    const first = '// const first = true;\n';
    const second = '/* const second = false; */';
    const result = runRule(`${first}${second}\n`);

    expect(result.reports).toHaveLength(2);
    expect(fixesFor(result.reports)).toStrictEqual([
      { range: [0, first.length], text: '' },
      { range: [first.length, first.length + second.length], text: '' },
    ]);
  });

  it.each([
    '/',
    'const ratio = total / count;\n',
    'const tested = /const dead = true;/.test(input);\n',
  ])('ignores ordinary slash syntax in %j', (source): void => {
    expect(runRule(source).reports).toEqual([]);
  });

  it.each([
    String.raw`const single = 'escaped \' // const dead = true;';`,
    String.raw`const double = "escaped \" /* const dead = true; */";`,
    'const template = `escaped \\` // const dead = true;`;\n',
  ])('ignores comment markers after an escaped quote in %j', (source): void => {
    expect(runRule(source).reports).toEqual([]);
  });

  it('skips fake markers in strings and reports a later real comment', (): void => {
    const prefix =
      "const line = '// const fakeLine = true;';\n" +
      "const block = '/* const fakeBlock = true; */';\n";
    const realComment = '// const real = true;\n';
    const result = runRule(`${prefix}${realComment}`);

    expect(result.reports).toHaveLength(1);
    expect(fixesFor(result.reports)).toStrictEqual([
      { range: [prefix.length, prefix.length + realComment.length], text: '' },
    ]);
  });

  it('preserves a regex character class containing // when fixing a later line comment', (): void => {
    const regexPrefix = 'const slashPair = /[//]/gu; ';
    const comment = '// const dead = true;\n';
    const liveSuffix = 'export const live = true;\n';
    const source = `${regexPrefix}${comment}${liveSuffix}`;
    const token = commentToken(source, comment, 'Line');
    const result = runRule(source, false, [token]);

    expect(token).toStrictEqual({
      end: regexPrefix.length + comment.length - 1,
      range: [regexPrefix.length, regexPrefix.length + comment.length - 1],
      start: regexPrefix.length,
      type: 'Line',
      value: ' const dead = true;',
    });
    expect(result.reports).toHaveLength(1);
    const fixes = fixesFor(result.reports);
    expect(fixes).toStrictEqual([
      {
        range: token.range,
        text: '',
      },
    ]);
    const actualFix = fixes.at(0);
    expect(actualFix === undefined ? source : applyFix(source, actualFix)).toBe(
      `${regexPrefix}\n${liveSuffix}`,
    );
  });

  it('preserves a regex character class containing /* when fixing a later block comment', (): void => {
    const regexPrefix = 'const blockPair = /[/*]/gu; ';
    const comment = '/* const dead = true; */';
    const liveSuffix = '\nexport const live = true;\n';
    const source = `${regexPrefix}${comment}${liveSuffix}`;
    const token = commentToken(source, comment, 'Block');
    const result = runRule(source, false, [token]);

    expect(token).toStrictEqual({
      end: regexPrefix.length + comment.length,
      range: [regexPrefix.length, regexPrefix.length + comment.length],
      start: regexPrefix.length,
      type: 'Block',
      value: ' const dead = true; ',
    });
    expect(result.reports).toHaveLength(1);
    const fixes = fixesFor(result.reports);
    expect(fixes).toStrictEqual([
      {
        range: [regexPrefix.length, regexPrefix.length + comment.length],
        text: '',
      },
    ]);
    const actualFix = fixes.at(0);
    expect(actualFix === undefined ? source : applyFix(source, actualFix)).toBe(
      `${regexPrefix}${liveSuffix}`,
    );
  });

  it.each([
    'const slashPair = /[//]/gu; const live = true;\n',
    'const blockPair = /[/*]/gu; const live = true;\n',
  ])('does not treat a fallback regex character class as a comment in %j', (source): void => {
    const result = runRule(source);

    expect({
      fixedSource: applyFixes(source, result.reports),
      reportCount: result.reports.length,
    }).toStrictEqual({
      fixedSource: source,
      reportCount: 0,
    });
  });

  it.each([
    String.raw`const url = /https?:\/\/[^/]+/giu;`,
    String.raw`const block = /\/\*[^]*?\*\//g;`,
    'const slashPair = /[//]/uy;',
    'const blockPair = /[/*]/dg;',
  ])('ignores regex delimiters and flags when no comment token exists in %j', (source): void => {
    expect(runRule(`${source}\n`, false, []).reports).toEqual([]);
  });

  it('reports real comments inside a template expression but ignores raw template markers', (): void => {
    const lineComment = '// const deadLine = true;\n';
    const blockComment = '/* const deadBlock = false; */';
    const source =
      'const rendered = `raw // const fakeLine = true; ' +
      '/* const fakeBlock = false; */ ${(() => {\n' +
      `${lineComment}${blockComment}\n` +
      'return live;\n})()} tail // const fakeTail = true;`;\n';
    const lineToken = commentToken(source, lineComment, 'Line');
    const blockToken = commentToken(source, blockComment, 'Block');
    const result = runRule(source, false, [lineToken, blockToken]);

    expect(result.reports).toHaveLength(2);
    expect(fixesFor(result.reports)).toStrictEqual([
      { range: [lineToken.start, lineToken.end + 1], text: '' },
      { range: blockToken.range, text: '' },
    ]);
  });

  it('does not report empty source', (): void => {
    expect(runRule('').reports).toEqual([]);
  });

  it.each([
    '// This explains why the cache is reused.\n',
    '/* The parser keeps prose available for maintainers. */\n',
    '// See https://example.com/reference for the protocol.\n',
    '/** @returns The cached value. */\n',
  ])('does not report natural-language comment %j', (source): void => {
    expect(runRule(source).reports).toEqual([]);
  });

  it('exposes create as the same semantic entry point as createOnce', (): void => {
    const source = '// const dead = true;\n';

    expect(noCommentedOutCodeRule.create).toBe(noCommentedOutCodeRule.createOnce);
    expect(fixesFor(runRule(source, true).reports)).toStrictEqual([
      { range: [0, source.length], text: '' },
    ]);
  });
});
