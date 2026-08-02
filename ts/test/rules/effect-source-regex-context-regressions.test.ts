import { describe, expect, it } from 'vitest';
import { isREGEXLiteralStart } from '../../src/rules/effect-source-regex-scan';
import { parseSync } from 'oxc-parser';
import { stripComments } from '../../src/rules/effect-source-comments';
import { stripCommentsAndStrings } from '../../src/rules/effect-source-scan';

interface ASTNode {
  readonly [key: string]: unknown;
  readonly type: string;
}

type RegexSpan = readonly [number, number];

interface SlashExpectation {
  readonly isRegex: boolean;
  readonly offset: number;
}

interface RegexContextFixture {
  readonly expectedRegexSpans: readonly RegexSpan[];
  readonly name: string;
  readonly slashExpectations: readonly SlashExpectation[];
  readonly source: string;
}

const classREGEXWithCommentMarkers = 'class Declared {}\n/[//]/;';

const regexSpan = (start: number, end: number): RegexSpan => [start, end];

const slash = (offset: number, isREGEX: boolean): SlashExpectation => ({
  isRegex: isREGEX,
  offset,
});

const regexContextFixtures: readonly RegexContextFixture[] = [
  {
    expectedRegexSpans: [regexSpan(23, 38)],
    name: 'function declaration boundary',
    slashExpectations: [slash(23, true), slash(37, false)],
    source: 'function declared() {}\n/afterFunction/;',
  },
  {
    expectedRegexSpans: [regexSpan(18, 30)],
    name: 'class declaration boundary',
    slashExpectations: [slash(18, true), slash(29, false)],
    source: 'class Declared {}\n/afterClass/;',
  },
  {
    expectedRegexSpans: [regexSpan(24, 41)],
    name: 'named catch boundary',
    slashExpectations: [slash(24, true), slash(40, false)],
    source: 'try {} catch (error) {}\n/afterNamedCatch/;',
  },
  {
    expectedRegexSpans: [regexSpan(16, 36)],
    name: 'optional catch binding boundary',
    slashExpectations: [slash(16, true), slash(35, false)],
    source: 'try {} catch {}\n/afterOptionalCatch/;',
  },
  {
    expectedRegexSpans: [regexSpan(15, 28)],
    name: 'regex inside optional catch block',
    slashExpectations: [slash(15, true), slash(27, false)],
    source: 'try {} catch { /insideCatch/; }',
  },
  {
    expectedRegexSpans: [],
    name: 'function expression division',
    slashExpectations: [slash(34, false)],
    source: 'const quotient = (function () {}) / divisor;',
  },
  {
    expectedRegexSpans: [],
    name: 'class expression division',
    slashExpectations: [slash(28, false)],
    source: 'const quotient = (class {}) / divisor;',
  },
  {
    expectedRegexSpans: [regexSpan(22, 28)],
    name: 'class extends expression',
    slashExpectations: [slash(22, true), slash(27, false)],
    source: 'class Derived extends /base/ {}',
  },
  {
    expectedRegexSpans: [regexSpan(15, 24)],
    name: 'export default expression',
    slashExpectations: [slash(15, true), slash(23, false)],
    source: 'export default /default/;',
  },
  {
    expectedRegexSpans: [regexSpan(26, 33)],
    name: 'break followed by ASI',
    slashExpectations: [slash(26, true), slash(32, false)],
    source: 'while (condition) { break\n/value/; }',
  },
  {
    expectedRegexSpans: [regexSpan(29, 36)],
    name: 'continue followed by ASI',
    slashExpectations: [slash(29, true), slash(35, false)],
    source: 'while (condition) { continue\n/value/; }',
  },
  {
    expectedRegexSpans: [regexSpan(9, 16)],
    name: 'debugger followed by ASI',
    slashExpectations: [slash(9, true), slash(15, false)],
    source: 'debugger\n/value/;',
  },
  {
    expectedRegexSpans: [regexSpan(32, 39)],
    name: 'return followed by ASI',
    slashExpectations: [slash(32, true), slash(38, false)],
    source: 'function returnValue() { return\n/value/; }',
  },
  {
    expectedRegexSpans: [regexSpan(30, 37)],
    name: 'throw expression without a line terminator',
    slashExpectations: [slash(30, true), slash(36, false)],
    source: 'function throwValue() { throw /value/; }',
  },
  {
    expectedRegexSpans: [regexSpan(31, 38)],
    name: 'yield followed by ASI',
    slashExpectations: [slash(31, true), slash(37, false)],
    source: 'function* yieldValue() { yield\n/value/; }',
  },
  {
    expectedRegexSpans: [regexSpan(19, 26)],
    name: 'spread operand',
    slashExpectations: [slash(19, true), slash(25, false)],
    source: 'const spread = [.../value/];',
  },
  {
    expectedRegexSpans: [],
    name: 'Unicode identifier followed by division',
    slashExpectations: [slash(22, false), slash(32, false)],
    source: 'const quotient = café / divisor / remainder;',
  },
  {
    expectedRegexSpans: [],
    name: 'U+2000 whitespace before division',
    slashExpectations: [slash(23, false), slash(33, false)],
    source: `const quotient = value\u2000/ divisor / remainder;`,
  },
  {
    expectedRegexSpans: [],
    name: 'U+FEFF whitespace before division',
    slashExpectations: [slash(23, false), slash(33, false)],
    source: `const quotient = value\uFEFF/ divisor / remainder;`,
  },
  {
    expectedRegexSpans: [regexSpan(18, 24)],
    name: 'regex containing comment markers after class declaration',
    slashExpectations: [slash(18, true), slash(20, false), slash(21, false), slash(23, false)],
    source: classREGEXWithCommentMarkers,
  },
];

const isASTNode = (value: unknown): value is ASTNode =>
  value !== null && typeof value === 'object' && typeof Reflect.get(value, 'type') === 'string';

const visitNode = (value: unknown, visit: (node: ASTNode) => void): void => {
  if (Array.isArray(value)) {
    for (const item of value) {
      visitNode(item, visit);
    }
    return;
  }
  if (!isASTNode(value)) {
    return;
  }
  visit(value);
  for (const [key, child] of Object.entries(value)) {
    if (key !== 'parent') {
      visitNode(child, visit);
    }
  }
};

const regexSpansFrom = (program: ASTNode): RegexSpan[] => {
  const spans: RegexSpan[] = [];
  visitNode(program, (node): void => {
    const regex = Reflect.get(node, 'regex');
    const isREGEXNode = node.type === 'RegExpLiteral' || (node.type === 'Literal' && regex != null);
    if (!isREGEXNode) {
      return;
    }
    const start = Reflect.get(node, 'start');
    const end = Reflect.get(node, 'end');
    if (typeof start !== 'number' || typeof end !== 'number') {
      throw new Error('Regex AST node is missing source offsets');
    }
    spans.push([start, end]);
  });
  return spans;
};

const parseFixture = (fixture: RegexContextFixture): ASTNode => {
  const parsed = parseSync(`${fixture.name}.ts`, fixture.source, { sourceType: 'module' });
  expect(parsed.errors, fixture.name).toHaveLength(0);
  return parsed.program as ASTNode;
};

const slashOffsets = (source: string): number[] => {
  const offsets: number[] = [];
  for (let index = 0; index < source.length; index += 1) {
    if (source.charAt(index) === '/') {
      offsets.push(index);
    }
  }
  return offsets;
};

describe('regex source context regressions', (): void => {
  it.each(regexContextFixtures)(
    'matches parser spans and slash context for $name',
    (fixture): void => {
      const program = parseFixture(fixture);

      expect(regexSpansFrom(program)).toEqual(fixture.expectedRegexSpans);
      expect(slashOffsets(fixture.source)).toEqual(
        fixture.slashExpectations.map(({ offset }) => offset),
      );
      for (const expectation of fixture.slashExpectations) {
        expect(isREGEXLiteralStart(fixture.source, expectation.offset)).toBe(expectation.isRegex);
      }
    },
  );

  it('preserves a regex containing comment markers after a class declaration', (): void => {
    expect(stripComments(classREGEXWithCommentMarkers)).toBe(classREGEXWithCommentMarkers);
  });

  it('blanks a regex containing comment markers as one opaque span', (): void => {
    expect(stripCommentsAndStrings(classREGEXWithCommentMarkers)).toBe(
      'class Declared {}\n      ;',
    );
  });
});
