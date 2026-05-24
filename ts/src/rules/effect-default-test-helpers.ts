import { stripCommentsAndStrings } from './effect-source-helpers.js';

function hasForkBeforeTestClockAdjust(source: string): boolean {
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
    const segment = code.slice(testStart === -1 ? 0 : testStart, adjustIndex);
    return /Effect\.fork(?:Scoped)?\b/.test(segment);
  });
}

function hasRealSleepWithoutTestClock(source: string): boolean {
  const code = stripCommentsAndStrings(source);
  const testStartPattern = /\bit(?:\.effect)?\s*\(/g;
  const testStarts = [...code.matchAll(testStartPattern)].map((match) => match.index);

  for (const sleepMatch of code.matchAll(/Effect\.sleep\s*\(/g)) {
    const previousStarts = testStarts.filter((start) => start < sleepMatch.index);
    const testStart = previousStarts.at(-1) ?? 0;
    const nextTestStart = testStarts.find((start) => start > sleepMatch.index) ?? code.length;
    const testBody = code.slice(testStart, nextTestStart);
    if (!/TestClock\./.test(testBody)) {
      return true;
    }
  }

  return false;
}

function hasTestClockWithoutEffectContext(source: string): boolean {
  const code = stripCommentsAndStrings(source);
  const testStartPattern = /\bit(?:\.effect)?\s*\(/g;
  const testStarts = [...code.matchAll(testStartPattern)].map((match) => match.index);

  for (const clockMatch of code.matchAll(/TestClock\./g)) {
    const previousStarts = testStarts.filter((start) => start < clockMatch.index);
    const testStart = previousStarts.at(-1) ?? 0;
    const nextTestStart = testStarts.find((start) => start > clockMatch.index) ?? code.length;
    const testBody = code.slice(testStart, nextTestStart);
    if (!/(?:it\.effect|TestContext)/.test(testBody)) {
      return true;
    }
  }

  return false;
}

export {
  hasForkBeforeTestClockAdjust,
  hasRealSleepWithoutTestClock,
  hasTestClockWithoutEffectContext,
};
