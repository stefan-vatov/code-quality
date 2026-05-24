/**
 * Helpers for Effect test-determinism lint rules.
 *
 * @internal
 */
import { stripCommentsAndStrings } from './effect-source-helpers';

const testStartPattern = /\bit(?:\.effect)?\s*\(/g;

const testStartsIn = (code: string): number[] =>
  [...code.matchAll(testStartPattern)].map((match) => match.index);

const enclosingTestBody = (code: string, testStarts: readonly number[], index: number): string => {
  const previousStarts = testStarts.filter((start): boolean => start < index);
  const testStart = previousStarts.at(-1) ?? 0;
  const nextTestStart = testStarts.find((start): boolean => start > index) ?? code.length;
  return code.slice(testStart, nextTestStart);
};

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const hasForkBeforeTestClockAdjust = (source: string): boolean => {
  const code = stripCommentsAndStrings(source);
  const adjustMatches = [...code.matchAll(/TestClock\.adjust\s*\(/g)];
  if (adjustMatches.length === 0) {
    return false;
  }

  return adjustMatches.every((match) => {
    const adjustIndex = match.index;
    const testStart = Math.max(
      code.lastIndexOf('it.effect', adjustIndex),
      code.lastIndexOf('it(', adjustIndex),
    );
    let segmentStart = testStart;
    if (segmentStart === -1) {
      segmentStart = 0;
    }
    const segment = code.slice(segmentStart, adjustIndex);
    return /Effect\.fork(?:Scoped)?\b/.test(segment);
  });
};

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const hasRealSleepWithoutTestClock = (source: string): boolean => {
  const code = stripCommentsAndStrings(source);
  const testStarts = testStartsIn(code);

  for (const sleepMatch of code.matchAll(/Effect\.sleep\s*\(/g)) {
    const testBody = enclosingTestBody(code, testStarts, sleepMatch.index);
    if (!/TestClock\./.test(testBody)) {
      return true;
    }
  }

  return false;
};

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const hasTestClockWithoutEffectContext = (source: string): boolean => {
  const code = stripCommentsAndStrings(source);
  const testStarts = testStartsIn(code);

  for (const clockMatch of code.matchAll(/TestClock\./g)) {
    const testBody = enclosingTestBody(code, testStarts, clockMatch.index);
    if (!/(?:it\.effect|TestContext)/.test(testBody)) {
      return true;
    }
  }

  return false;
};
