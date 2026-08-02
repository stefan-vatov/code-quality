/* -------------------------------------------------------------------------- */
/*              Helpers for Effect test-determinism lint rules.               */
/* -------------------------------------------------------------------------- */
import { stripCommentsAndStrings } from './effect-source-helpers';

const TEST_START_PATTERN = /\bit(?:\.effect)?\s*\(/g;

interface TestRange {
  end: number;
  hasEffectContext: boolean;
  hasTestClock: boolean;
  start: number;
}

const testStartsIn = (code: string): number[] => {
  const starts = [0];
  TEST_START_PATTERN.lastIndex = 0;
  let match = TEST_START_PATTERN.exec(code);
  while (match !== null) {
    if (match.index !== starts.at(-1)) {
      starts.push(match.index);
    }
    match = TEST_START_PATTERN.exec(code);
  }
  return starts;
};

const testRangesIn = (code: string): TestRange[] => {
  const starts = testStartsIn(code);
  const ranges: TestRange[] = [];
  for (let index = 0; index < starts.length; index += 1) {
    const start = starts[index] ?? 0;
    const end = starts[index + 1] ?? code.length;
    const body = code.slice(start, end);
    ranges.push({
      end,
      hasEffectContext: /(?:it\.effect|TestContext)/.test(body),
      hasTestClock: body.includes('TestClock.'),
      start,
    });
  }
  return ranges;
};

const rangeAt = (ranges: readonly TestRange[], targetIndex: number): TestRange => {
  let low = 0;
  let high = ranges.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const range = ranges[middle];
    if (targetIndex >= range.end) {
      low = middle + 1;
    } else if (targetIndex < range.start) {
      high = middle - 1;
    } else {
      return range;
    }
  }
  return ranges[0] ?? { end: 0, hasEffectContext: false, hasTestClock: false, start: 0 };
};

const someMatch = (
  code: string,
  pattern: RegExp,
  predicate: (match: RegExpExecArray) => boolean,
): boolean => {
  const matcher = new RegExp(pattern.source, pattern.flags);
  let match = matcher.exec(code);
  while (match !== null) {
    if (predicate(match)) {
      return true;
    }
    match = matcher.exec(code);
  }
  return false;
};

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const hasForkBeforeTestClockAdjust = (source: string): boolean => {
  const code = stripCommentsAndStrings(source);
  const ranges = testRangesIn(code);
  let hasAdjust = false;
  const allAdjustmentsHaveFork = !someMatch(code, /TestClock\.adjust\s*\(/g, (match): boolean => {
    hasAdjust = true;
    const range = rangeAt(ranges, match.index);
    return code.slice(range.start, match.index).search(/Effect\.fork(?:Scoped)?\b/) === -1;
  });
  return hasAdjust && allAdjustmentsHaveFork;
};

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const hasRealSleepWithoutTestClock = (source: string): boolean => {
  const code = stripCommentsAndStrings(source);
  const ranges = testRangesIn(code);
  return someMatch(
    code,
    /Effect\.sleep\s*\(/g,
    (match): boolean => !rangeAt(ranges, match.index).hasTestClock,
  );
};

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const hasTestClockWithoutEffectContext = (source: string): boolean => {
  const code = stripCommentsAndStrings(source);
  const ranges = testRangesIn(code);
  return someMatch(
    code,
    /TestClock\./g,
    (match): boolean => !rangeAt(ranges, match.index).hasEffectContext,
  );
};
