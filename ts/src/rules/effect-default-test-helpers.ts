/* -------------------------------------------------------------------------- */
/*              Helpers for Effect test-determinism lint rules.               */
/* -------------------------------------------------------------------------- */
import { Array, Match, Option, pipe } from 'effect';
import { stripCommentsAndStrings } from './effect-source-helpers';

const testStartPattern = /\bit(?:\.effect)?\s*\(/g;

const testStartsIn = (code: string): number[] =>
  pipe(
    [...code.matchAll(testStartPattern)],
    Array.map((match): number => match.index),
  );

const enclosingTestBody = (code: string, testStarts: readonly number[], index: number): string => {
  const testStart = pipe(
    testStarts,
    Array.filter((start): boolean => start < index),
    Array.last,
    Option.getOrElse((): number => 0),
  );
  const nextTestStart = pipe(
    testStarts,
    Array.findFirst((start): boolean => start > index),
    Option.getOrElse((): number => code.length),
  );
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
  return Match.value(adjustMatches).pipe(
    Match.when(
      (matches): boolean => matches.length === 0,
      (): boolean => false,
    ),
    Match.orElse((matches): boolean =>
      pipe(
        matches,
        Array.every((match): boolean => {
          const adjustIndex = match.index;
          const testStart = Math.max(
            code.lastIndexOf('it.effect', adjustIndex),
            code.lastIndexOf('it(', adjustIndex),
          );
          const segmentStart = Math.max(testStart, 0);
          const segment = code.slice(segmentStart, adjustIndex);
          return /Effect\.fork(?:Scoped)?\b/.test(segment);
        }),
      ),
    ),
  );
};

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const hasRealSleepWithoutTestClock = (source: string): boolean => {
  const code = stripCommentsAndStrings(source);
  const testStarts = testStartsIn(code);

  return pipe(
    [...code.matchAll(/Effect\.sleep\s*\(/g)],
    Array.some((sleepMatch): boolean => {
      const testBody = enclosingTestBody(code, testStarts, sleepMatch.index);
      return !/TestClock\./.test(testBody);
    }),
  );
};

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const hasTestClockWithoutEffectContext = (source: string): boolean => {
  const code = stripCommentsAndStrings(source);
  const testStarts = testStartsIn(code);

  return pipe(
    [...code.matchAll(/TestClock\./g)],
    Array.some((clockMatch): boolean => {
      const testBody = enclosingTestBody(code, testStarts, clockMatch.index);
      return !/(?:it\.effect|TestContext)/.test(testBody);
    }),
  );
};
