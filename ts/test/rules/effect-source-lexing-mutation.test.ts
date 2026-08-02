import { describe, expect, it } from 'vitest';
import { findREGEXLiteralEnd, isREGEXLiteralStart } from '../../src/rules/effect-source-regex-scan';
import {
  findStatementEnd,
  isInsideCall,
  sameFunctionTail,
  statementAfter,
} from '../../src/rules/effect-source-navigation';
import { hasSharedResourceForEachWithoutSemaphore } from '../../src/rules/effect-strict-helpers';
import { stripComments } from '../../src/rules/effect-source-comments';

describe('stripComments', (): void => {
  it('preserves CRLF source positions while removing a line comment', (): void => {
    const source = 'const first = 1; // note\r\nconst second = 2;';
    const expected = `const first = 1;${' '.repeat(8)}\r\nconst second = 2;`;
    const stripped = stripComments(source);

    expect(stripped).toBe(expected);
    expect(stripped).toHaveLength(source.length);
    expect(stripped.indexOf('const second')).toBe(source.indexOf('const second'));
  });

  it('blanks an EOF line comment without changing its length', (): void => {
    const source = 'run(); // pending';
    const expected = `run(); ${' '.repeat(10)}`;

    expect(stripComments(source)).toBe(expected);
    expect(stripComments(source)).toHaveLength(source.length);
  });

  it('blanks an unclosed block comment and preserves its newline', (): void => {
    const source = 'run(); /* pending\nstill pending';
    const expected = `run(); ${' '.repeat(10)}\n${' '.repeat(13)}`;

    expect(stripComments(source)).toBe(expected);
    expect(stripComments(source)).toHaveLength(source.length);
  });

  it('does not interpret comment markers inside escaped quoted values', (): void => {
    const source = [
      "const single = 'it\\'s // text';",
      'const double = "say \\"/* text */\\"";',
      'const template = `left \\` // text /* block */ right`;',
    ].join('\n');

    expect(stripComments(source)).toBe(source);
  });

  it('preserves comment markers inside a template interpolation', (): void => {
    const source =
      'const message = `https://example.test/${path} /* literal */ // literal`; // remove';
    const expected = `${source.slice(0, source.lastIndexOf('// remove'))}${' '.repeat(9)}`;

    expect(stripComments(source)).toBe(expected);
  });

  it('preserves a regex literal containing escaped slashes while removing a real comment', (): void => {
    const source = String.raw`const matcher = /https?:\/\/example\.test/giu; // remove`;
    const expected = `${source.slice(0, source.lastIndexOf('// remove'))}${' '.repeat(9)}`;

    expect(stripComments(source)).toBe(expected);
  });
});

describe('regex literal navigation', (): void => {
  it.each([
    { expected: true, source: '/value/giu' },
    { expected: true, source: 'return /value/giu' },
    { expected: true, source: 'throw /value/giu' },
    { expected: true, source: 'case /value/giu: break' },
    { expected: false, source: 'identifier / divisor' },
    { expected: false, source: 'returned / divisor' },
    { expected: false, source: 'call() / divisor' },
    { expected: false, source: '// comment' },
    { expected: false, source: '/* comment */' },
  ])('classifies the slash in $source', ({ expected, source }): void => {
    expect(isREGEXLiteralStart(source, source.indexOf('/'))).toBe(expected);
  });

  it.each(['(', '[', '{', '=', ':', ',', ';', '!', '?', '&', '|'])(
    'accepts a regex literal after the %s punctuation prefix',
    (prefix): void => {
      const source = `${prefix} /value/g`;

      expect(isREGEXLiteralStart(source, source.indexOf('/'))).toBe(true);
    },
  );

  it.each(['delete', 'typeof', 'void', 'yield'])(
    'accepts a regex literal after the %s keyword',
    (keyword): void => {
      const source = `${keyword} /value/g`;

      expect(isREGEXLiteralStart(source, source.indexOf('/'))).toBe(true);
    },
  );

  it.each([
    'value + /pattern/.test(input)',
    'value - /pattern/.test(input)',
    'value * /pattern/.test(input)',
    'value / /pattern/.test(input)',
    'const matcher = () => /pattern/.test(input)',
    'await /pattern/.test(input)',
    'if (enabled) /pattern/.test(input)',
    'return /* reason */ /pattern/.test(input)',
  ])('accepts a regex literal in expression position: %s', (source): void => {
    expect(isREGEXLiteralStart(source, source.lastIndexOf('/pattern/'))).toBe(true);
  });

  it('does not treat a keyword-named property division as a regex literal', (): void => {
    const source = 'obj.return / divisor';

    expect(isREGEXLiteralStart(source, source.indexOf('/'))).toBe(false);
  });

  it('finds the final flag after an escaped slash', (): void => {
    const source = String.raw`/a\/b/giu`;

    expect(findREGEXLiteralEnd(source, 0)).toBe(8);
  });

  it('recognizes a regex at the first token inside a template interpolation', (): void => {
    const source = 'const matcher = `${/pattern/gi}`;';
    const slashIndex = source.indexOf('/');

    expect(isREGEXLiteralStart(source, slashIndex)).toBe(true);
  });

  it('does not treat a slash inside a character class as the closing delimiter', (): void => {
    const source = '/[a/b]+/gi';

    expect(findREGEXLiteralEnd(source, 0)).toBe(9);
  });

  it('does not close a character class at an escaped bracket', (): void => {
    const source = String.raw`/[a\]b/]+/g`;

    expect(findREGEXLiteralEnd(source, 0)).toBe(10);
  });

  it.each(['\r', '\u2028', '\u2029'])(
    'stops an unterminated regex at the %s line terminator',
    (terminator): void => {
      const source = `/left${terminator}right/`;

      expect(findREGEXLiteralEnd(source, 0)).toBe(0);
    },
  );
});

describe('source navigation', (): void => {
  it('recognizes a target inside a nested call despite delimiters in strings and comments', (): void => {
    const source =
      'Effect.runPromise(pipe(value, () => ")", /* ignored ) */ transform(target))); consume(target);';
    const insideTarget = source.indexOf('transform');
    const outsideTarget = source.indexOf('consume');
    const callPattern = /Effect\.runPromise\s*\(/g;

    expect(isInsideCall(source, insideTarget, callPattern)).toBe(true);
    expect(isInsideCall(source, outsideTarget, callPattern)).toBe(false);
  });

  it('recognizes a target at the nested call boundary', (): void => {
    const source = 'Effect.runPromise(pipe(value, Effect.map(transform)));';
    const targetIndex = source.indexOf('Effect.map');

    expect(isInsideCall(source, targetIndex, /Effect\.runPromise\s*\(/g)).toBe(true);
  });

  it('returns a complete statement when a quoted value contains a semicolon', (): void => {
    const statement = 'const value = "inside;still";';
    const source = `${statement} consume(value);`;

    expect(statementAfter(source, 0)).toBe(statement);
  });

  it('returns a complete statement when a block comment contains a semicolon', (): void => {
    const statement = 'const value = 1 /* ; ignored */ + 2;';
    const source = `${statement} consume(value);`;

    expect(statementAfter(source, 0)).toBe(statement);
  });

  it('returns a complete statement through nested delimiters', (): void => {
    const statement = 'const value = create({ text: ";", nested: [first, call(second)] });';
    const source = `${statement} consume(value);`;

    expect(statementAfter(source, 0)).toBe(statement);
  });

  it('finds the statement end through nested delimiters and quoted semicolons', (): void => {
    const statement = 'const value = create({ text: ";", nested: [first, call(second)] });';
    const source = `${statement} consume(value);`;

    expect(findStatementEnd(source, 0)).toBe(statement.length - 1);
  });

  it('finds the statement end after semicolons in both comment forms', (): void => {
    const statement = 'const value = first /* ; */ + second // ; ignored\n  + third;';
    const source = `${statement}\nconsume(value);`;

    expect(findStatementEnd(source, 0)).toBe(statement.length - 1);
  });

  it('uses the source EOF when no statement terminator exists', (): void => {
    const source = 'const value = Effect.succeed(1)';

    expect(findStatementEnd(source, 0)).toBe(source.length - 1);
  });

  it.each([
    {
      statement: 'const result = pipe(input, Effect.map(transform), finalize);',
      target: 'Effect.map',
    },
    {
      statement: 'const result = [first, Effect.succeed(second), third];',
      target: 'Effect.succeed',
    },
    {
      statement: 'const result = { first, effect: Effect.succeed(second), third };',
      target: 'Effect.succeed',
    },
  ])('stops at the containing statement from inside $target', ({ statement, target }): void => {
    const source = `${statement} consume(result);`;
    const targetIndex = source.indexOf(target);

    expect(statementAfter(source, targetIndex)).toBe(statement.slice(targetIndex));
    expect(findStatementEnd(source, targetIndex)).toBe(statement.length - 1);
  });

  it('keeps nested template interpolations inside one statement', (): void => {
    const statement =
      'const message = `outer ${enabled ? `inner;${value}` : /;/.test(value) /* ; */} tail`;';
    const source = `${statement} consume(message);`;

    expect(statementAfter(source, 0)).toBe(statement);
    expect(findStatementEnd(source, 0)).toBe(statement.length - 1);
  });

  it('keeps TSX attribute and text semicolons inside one statement', (): void => {
    const statement =
      'const view = <Panel title="left;right" matcher={/;/.test(value)}>text;still</Panel>;';
    const source = `${statement} consume(view);`;

    expect(statementAfter(source, 0)).toBe(statement);
    expect(findStatementEnd(source, 0)).toBe(statement.length - 1);
  });

  it('returns only the tail of the enclosing function block', (): void => {
    const source = [
      'function current() {',
      '  const label = "}";',
      '  // } ignored',
      '  return Effect.succeed(label);',
      '}',
      'function next() {',
      '  return Effect.void;',
      '}',
    ].join('\n');
    const targetIndex = source.indexOf('return Effect.succeed');

    expect(sameFunctionTail(source, targetIndex)).toBe('return Effect.succeed(label);\n}');
  });

  it('returns only the remainder of an enclosing Effect.gen call', (): void => {
    const source = [
      'const task = Effect.gen(function* () {',
      '  const value = yield* Effect.succeed(1);',
      '  return value;',
      '});',
      'const next = () => Effect.void;',
    ].join('\n');
    const targetIndex = source.indexOf('yield*');

    expect(sameFunctionTail(source, targetIndex)).toBe(
      'yield* Effect.succeed(1);\n  return value;\n})',
    );
  });

  it('stops an unbraced source tail at the next arrow function', (): void => {
    const source = 'Effect.succeed(first);\n\nconst next = () => Effect.succeed(second);';

    expect(sameFunctionTail(source, 0)).toBe('Effect.succeed(first);');
  });

  it('stops an unbraced source tail at the next function declaration', (): void => {
    const source =
      'Effect.succeed(first);\n\nexport async function next() {\n  return Effect.void;\n}';

    expect(sameFunctionTail(source, 0)).toBe('Effect.succeed(first);');
  });
});

describe('shared-resource statement boundaries', (): void => {
  it('does not borrow a shared-resource token from the following statement', (): void => {
    const source = [
      'const jobs = pipe(',
      '  Effect.forEach(items, runItem),',
      '  Effect.map(Array.length),',
      ');',
      'const pool = createPool();',
    ].join('\n');

    expect(hasSharedResourceForEachWithoutSemaphore(source)).toBe(false);
  });

  it('does not borrow a semaphore token from the following statement', (): void => {
    const source = [
      'const jobs = pipe(',
      '  Effect.forEach(items, (item) => pool.run(item)),',
      '  Effect.map(Array.length),',
      ');',
      'const permit = Semaphore.make(1);',
    ].join('\n');

    expect(hasSharedResourceForEachWithoutSemaphore(source)).toBe(true);
  });
});
