import { describe, expect, it } from 'vitest';
import { parseSync } from 'oxc-parser';
import { stripComments } from '../../src/rules/effect-source-comments';
import { stripCommentsAndStrings } from '../../src/rules/effect-source-scan';

interface SourceSpan {
  readonly end: number;
  readonly start: number;
}

interface ControlFlowFixture {
  readonly name: string;
  readonly source: string;
  readonly sourceType: 'module' | 'script';
}

interface OperatorFixture extends ControlFlowFixture {
  readonly operator: string;
}

const actualCommentBefore = '/* actual JS comment before */';
const actualCommentAfter = '// actual JS comment after';
const rawJSXText = 'raw // preserve\n';
const lineTerminators = new Set(['\n', '\r', '\u2028', '\u2029']);

const viewStatement = (prefix: string, suffix = ''): string =>
  `${prefix}<View>${rawJSXText}</View>;${suffix}`;

const sourceWithActualComments = (statement: string): string =>
  `${actualCommentBefore} ${statement} ${actualCommentAfter}`;

const controlFlowFixtures: readonly ControlFlowFixture[] = [
  {
    name: 'if body after a closed condition',
    source: sourceWithActualComments(viewStatement('if (ok) ')),
    sourceType: 'module',
  },
  {
    name: 'while body after a closed condition',
    source: sourceWithActualComments(viewStatement('while (ok) ')),
    sourceType: 'module',
  },
  {
    name: 'for body after a closed condition',
    source: sourceWithActualComments(viewStatement('for (const item of items) ')),
    sourceType: 'module',
  },
  {
    name: 'with body after a closed condition',
    source: sourceWithActualComments(viewStatement('with (value) ')),
    sourceType: 'script',
  },
  {
    name: 'do body after the do keyword',
    source: sourceWithActualComments(viewStatement('do ', ' while (ok);')),
    sourceType: 'module',
  },
  {
    name: 'else body after a closed block',
    source: sourceWithActualComments(viewStatement('if (skip) { fallback(); } else ')),
    sourceType: 'module',
  },
];

const operatorFixtures: readonly OperatorFixture[] = [
  {
    name: 'less-than comparison',
    operator: '<',
    source: sourceWithActualComments('const result = left < right;'),
    sourceType: 'module',
  },
  {
    name: 'left-shift operator in a do body',
    operator: '<<',
    source: sourceWithActualComments('do left << right; while (ok);'),
    sourceType: 'module',
  },
  {
    name: 'less-than-or-equal operator in a while body',
    operator: '<=',
    source: sourceWithActualComments('while (ok) left <= right;'),
    sourceType: 'module',
  },
];

const parseFixture = (fixture: ControlFlowFixture): ReturnType<typeof parseSync> => {
  const parsed = parseSync(`${fixture.name}.tsx`, fixture.source, {
    sourceType: fixture.sourceType,
  });
  expect(parsed.errors, fixture.name).toHaveLength(0);
  return parsed;
};

const spanFor = (source: string, value: string): SourceSpan => {
  const start = source.indexOf(value);
  if (start === -1) {
    throw new Error(`Missing fixture value: ${value}`);
  }
  return { end: start + value.length, start };
};

const commentSpans = (parsed: ReturnType<typeof parseSync>): readonly SourceSpan[] =>
  parsed.comments.map(({ end, start }) => ({ end, start }));

const projectRanges = (source: string, spans: readonly SourceSpan[]): string => {
  const projected = source.split('');
  for (const { end, start } of spans) {
    for (let index = start; index < end; index += 1) {
      if (!lineTerminators.has(source.charAt(index))) {
        projected[index] = ' ';
      }
    }
  }
  return projected.join('');
};

describe('TSX control-flow source projections', (): void => {
  it.each(controlFlowFixtures)('preserves raw JSX comments in $name', (fixture): void => {
    const parsed = parseFixture(fixture);
    const comments = commentSpans(parsed);
    const rawSpan = spanFor(fixture.source, rawJSXText);
    const afterCommentSpan = spanFor(fixture.source, actualCommentAfter);
    const stripped = stripComments(fixture.source);

    expect(parsed.comments.map(({ end, start }) => fixture.source.slice(start, end))).toEqual([
      actualCommentBefore,
      actualCommentAfter,
    ]);
    expect(stripped).toBe(projectRanges(fixture.source, comments));
    expect(stripped).toHaveLength(fixture.source.length);
    expect(stripped.slice(rawSpan.start, rawSpan.end)).toBe(rawJSXText);
    expect(stripped.slice(afterCommentSpan.start, afterCommentSpan.end)).toBe(
      ' '.repeat(actualCommentAfter.length),
    );
  });

  it.each(controlFlowFixtures)(
    'strips raw JSX text but keeps coordinates in $name',
    (fixture): void => {
      const parsed = parseFixture(fixture);
      const comments = commentSpans(parsed);
      const rawSpan = spanFor(fixture.source, rawJSXText);
      const afterCommentSpan = spanFor(fixture.source, actualCommentAfter);
      const codeOnly = stripCommentsAndStrings(fixture.source);

      expect(codeOnly).toBe(projectRanges(fixture.source, [...comments, rawSpan]));
      expect(codeOnly).toHaveLength(fixture.source.length);
      expect(codeOnly.slice(rawSpan.start, rawSpan.end)).toBe(
        projectRanges(fixture.source, [rawSpan]).slice(rawSpan.start, rawSpan.end),
      );
      expect(codeOnly.slice(afterCommentSpan.start, afterCommentSpan.end)).toBe(
        ' '.repeat(actualCommentAfter.length),
      );
    },
  );
});

describe('TSX control-flow operator negatives', (): void => {
  it.each(operatorFixtures)('does not classify $operator as JSX in $name', (fixture): void => {
    const parsed = parseFixture(fixture);
    const expected = projectRanges(fixture.source, commentSpans(parsed));
    const stripped = stripComments(fixture.source);
    const codeOnly = stripCommentsAndStrings(fixture.source);
    const operatorStart = fixture.source.indexOf(fixture.operator);

    expect(stripped).toBe(expected);
    expect(codeOnly).toBe(expected);
    expect(stripped.slice(operatorStart, operatorStart + fixture.operator.length)).toBe(
      fixture.operator,
    );
    expect(codeOnly.slice(operatorStart, operatorStart + fixture.operator.length)).toBe(
      fixture.operator,
    );
  });
});
