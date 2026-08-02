import { describe, expect, it } from 'vitest';
import isCommentedOutCode from '../../src/rules/no-commented-out-code';

const LARGE_COMMENT_LINE_COUNT = 10_000;

describe('commented-out code stack safety', (): void => {
  it('scans 10,000 lines without exhausting the JavaScript call stack', (): void => {
    const comment = Array.from(
      { length: LARGE_COMMENT_LINE_COUNT },
      (_, index): string => `const value${index} = ${index};`,
    ).join('\n');

    expect((): boolean => isCommentedOutCode(comment)).not.toThrow();
  });
});
