import { describe, expect, it } from 'vitest';
import { stripComments } from '../../src/rules/effect-source-helpers';

describe('stripComments Unicode and template contracts', (): void => {
  it('preserves UTF-16 length and offsets around astral comment text', (): void => {
    const source = [
      '😀prefix // comment 😀',
      'const value = /* block 😀 comment */ true;',
      'const tail = 😀;',
    ].join('\n');
    const expected = [
      '😀prefix··············',
      'const·value·=························true;',
      'const·tail·=·😀;',
    ]
      .join('\n')
      .replaceAll('·', ' ');

    const stripped = stripComments(source);

    expect(stripped).toBe(expected);
    expect(stripped).toHaveLength(82);
    expect(stripped.indexOf('\n')).toBe(22);
    expect(stripped.indexOf('const value')).toBe(23);
    expect(stripped.indexOf('true;')).toBe(60);
    expect(stripped.indexOf('const tail')).toBe(66);
    expect(stripped.lastIndexOf('😀')).toBe(79);
    expect(stripped.slice(9, 22)).toBe(' '.repeat(13));
    expect(stripped.slice(37, 59)).toBe(' '.repeat(22));
  });

  it('strips comments in template interpolation code but preserves raw template markers', (): void => {
    const source =
      'const rendered = `raw // literal 😀 /* literal */ ${value /* comment 😀 */} tail`;';
    const expected =
      'const·rendered·=·`raw·//·literal·😀·/*·literal·*/·${value·················}·tail`;'.replaceAll(
        '·',
        ' ',
      );

    const stripped = stripComments(source);

    expect(stripped).toBe(expected);
    expect(stripped).toHaveLength(82);
    expect(stripped.indexOf('// literal')).toBe(22);
    expect(stripped.indexOf('/* literal */')).toBe(36);
    expect(stripped.indexOf('value')).toBe(52);
    expect(stripped.indexOf('tail')).toBe(76);
    expect(stripped.indexOf('`;')).toBe(80);
    expect(stripped.slice(58, 74)).toBe(' '.repeat(16));
  });

  it('preserves coordinates across nested template interpolations', (): void => {
    const source =
      'const nested = `outer 😀 ${`inner /* raw */ ${value /* nested 😀 comment */}` /* outer 😀 comment */} tail`;';
    const expected =
      'const·nested·=·`outer·😀·${`inner·/*·raw·*/·${value························}`·······················}·tail`;'.replaceAll(
        '·',
        ' ',
      );

    const stripped = stripComments(source);

    expect(stripped).toBe(expected);
    expect(stripped).toHaveLength(108);
    expect(stripped.indexOf('/* raw */')).toBe(34);
    expect(stripped.indexOf('value')).toBe(46);
    expect(stripped.indexOf('}')).toBe(75);
    expect(stripped.indexOf('tail')).toBe(102);
    expect(stripped.indexOf('`;')).toBe(106);
    expect(stripped.slice(52, 75)).toBe(' '.repeat(23));
    expect(stripped.slice(78, 100)).toBe(' '.repeat(22));
  });
});
