import { describe, expect, it } from 'vitest';
import { findStatementEnd, statementAfter } from '../../src/rules/effect-source-navigation';
import { isREGEXLiteralStart } from '../../src/rules/effect-source-regex-scan';
import { stripComments } from '../../src/rules/effect-source-comments';
import { stripCommentsAndStrings } from '../../src/rules/effect-source-scan';

const lineTerminators = [
  { name: 'lone CR', terminator: '\r' },
  { name: 'U+2028 line separator', terminator: '\u2028' },
  { name: 'U+2029 paragraph separator', terminator: '\u2029' },
] as const;

describe('source navigation around non-LF line comments', (): void => {
  it.each(lineTerminators)(
    'indexes the statement after a $name comment and stops at its semicolon',
    ({ terminator }): void => {
      const comment = '// ignored;';
      const statement = 'const after = 2;';
      const source = `${comment}${terminator}${statement} consume(after);`;
      const targetIndex = source.indexOf(statement);
      const expectedEndIndex = targetIndex + statement.length - 1;

      expect(source).toHaveLength(44);
      expect(source.indexOf(terminator)).toBe(11);
      expect(targetIndex).toBe(12);
      expect(findStatementEnd(source, targetIndex)).toBe(expectedEndIndex);
      expect(findStatementEnd(source, targetIndex)).not.toBe(source.length - 1);
      expect(statementAfter(source, targetIndex)).toBe(statement);
      expect(statementAfter(source, targetIndex)).toHaveLength(16);
    },
  );
});

describe('stripComments around non-LF line comments', (): void => {
  it.each(lineTerminators)(
    'blanks a $name comment while preserving its terminator and following code',
    ({ terminator }): void => {
      const comment = '// ignored;';
      const following = 'const after = 2;';
      const source = `${comment}${terminator}${following}`;
      const stripped = stripComments(source);
      const expected = `${' '.repeat(comment.length)}${terminator}${following}`;

      expect(source).toHaveLength(28);
      expect(stripped).toBe(expected);
      expect(stripped).toHaveLength(28);
      expect(stripped.slice(0, 11)).toBe(' '.repeat(11));
      expect(stripped.charAt(11)).toBe(terminator);
      expect(stripped.indexOf(following)).toBe(12);
      expect(stripped.slice(12)).toHaveLength(16);
    },
  );
});

describe('stripCommentsAndStrings around non-LF line comments', (): void => {
  it.each(lineTerminators)(
    'blanks a $name comment while preserving its terminator and following code',
    ({ terminator }): void => {
      const prefix = 'const hidden = "value"; ';
      const codeOnlyPrefix = 'const hidden = "     "; ';
      const comment = '// ignored;';
      const following = 'const after = visible;';
      const source = `${prefix}${comment}${terminator}${following}`;
      const stripped = stripCommentsAndStrings(source);
      const expected = `${codeOnlyPrefix}${' '.repeat(comment.length)}${terminator}${following}`;

      expect(source).toHaveLength(58);
      expect(stripped).toBe(expected);
      expect(stripped).toHaveLength(58);
      expect(source.indexOf(comment)).toBe(24);
      expect(stripped.slice(24, 35)).toBe(' '.repeat(11));
      expect(stripped.charAt(35)).toBe(terminator);
      expect(stripped.indexOf(following)).toBe(36);
      expect(stripped.slice(36)).toHaveLength(22);
    },
  );
});

describe('regex recognition after non-LF line comments', (): void => {
  it.each(lineTerminators)(
    'recognizes a regex at the first token after a $name comment',
    ({ terminator }): void => {
      const comment = '// ignored';
      const regex = '/value/';
      const source = `${comment}${terminator}${regex};`;
      const regexIndex = source.indexOf(regex);

      expect(source).toHaveLength(19);
      expect(source.indexOf(terminator)).toBe(10);
      expect(regexIndex).toBe(11);
      expect(isREGEXLiteralStart(source, regexIndex)).toBe(true);
    },
  );
});
