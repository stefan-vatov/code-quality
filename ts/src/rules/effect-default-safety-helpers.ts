/* -------------------------------------------------------------------------- */
/*     Error-handling and cleanup predicates for always-on Effect rules.      */
/* -------------------------------------------------------------------------- */
import { Array, Match, Option, pipe } from 'effect';
import { effectCallBodies } from './effect-default-scan-helpers';
import { findBalancedCallEnd, stripCommentsAndStrings } from './effect-source-helpers';

const balancedCallBodyAt = (source: string, match: RegExpExecArray): Option.Option<string> => {
  const openParenIndex = source.indexOf('(', match.index);
  return Match.value(openParenIndex).pipe(
    Match.when(
      (index): boolean => index === -1,
      (): Option.Option<string> => Option.none(),
    ),
    Match.orElse(
      (index): Option.Option<string> =>
        Option.some(source.slice(index + 1, findBalancedCallEnd(source, index))),
    ),
  );
};

const hasErrorWithoutCause = (callBody: string): boolean =>
  pipe(
    [...callBody.matchAll(/new\s+[A-Z][\w$]*Error\s*\(/g)],
    Array.some((errorMatch): boolean => {
      const errorOpenParenIndex = callBody.indexOf('(', errorMatch.index);
      const errorArgs = callBody.slice(
        errorOpenParenIndex + 1,
        findBalancedCallEnd(callBody, errorOpenParenIndex),
      );
      return !/\bcause\b/.test(errorArgs);
    }),
  );

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const hasErrorMappingWithoutCause = (source: string): boolean => {
  const code = stripCommentsAndStrings(source);
  return pipe(
    [...code.matchAll(/(?:mapError|catchAll)\s*\(/g)],
    Array.some((match): boolean =>
      pipe(
        balancedCallBodyAt(source, match),
        Option.exists((callBody): boolean => hasErrorWithoutCause(callBody)),
      ),
    ),
  );
};

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const hasForkDaemonWithoutCleanup = (source: string): boolean =>
  pipe(
    effectCallBodies(source, /\bEffect\.forkDaemon\s*\(/g),
    Array.some(
      (body): boolean =>
        !/\b(?:Effect\.)?(?:ensuring|onExit|onInterrupt|supervised)\b|Supervisor\./.test(body),
    ),
  );

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const hasForkInUninterruptibleWithoutRestore = (source: string): boolean => {
  const code = stripCommentsAndStrings(source);
  return pipe(
    [...code.matchAll(/\bEffect\.uninterruptible\s*\(/g)],
    Array.some((match): boolean =>
      pipe(
        balancedCallBodyAt(source, match),
        Option.exists(
          (callBody): boolean =>
            /\bEffect\.fork\b/.test(callBody) && !/\brestore\s*\(/.test(callBody),
        ),
      ),
    ),
  );
};
