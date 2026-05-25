/* -------------------------------------------------------------------------- */
/*     Error-handling and cleanup predicates for always-on Effect rules.      */
/* -------------------------------------------------------------------------- */
import { Array, Match, Option, pipe } from 'effect';
import { effectCallBodies, enclosingPipeBody } from './effect-default-scan-helpers';
import {
  findBalancedCallEnd,
  isInsideCall,
  stripCommentsAndStrings,
} from './effect-source-helpers';

const LOCAL_PREFIX_SCAN_WINDOW = 160;

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const hasUnsafeLazyEvaluation = (source: string): boolean => {
  const code = stripCommentsAndStrings(source);
  return pipe(
    [
      ...code.matchAll(
        /Effect\.succeed\s*\(\s*(?:Date\.now|Math\.random|new\s+Date|JSON\.parse)\s*\(/g,
      ),
    ],
    Array.some((match): boolean => !isInsideCall(code, match.index, /Effect\.suspend\s*\(/g)),
  );
};

const localIgnorePrefix = (source: string, matchIndex: number): string =>
  pipe(
    Option.fromNullable(enclosingPipeBody(source, matchIndex)),
    Option.match({
      onNone: (): string =>
        source.slice(Math.max(0, matchIndex - LOCAL_PREFIX_SCAN_WINDOW), matchIndex),
      onSome: (pipeBody): string =>
        pipeBody.slice(0, Math.max(0, matchIndex - source.indexOf(pipeBody))),
    }),
  );

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const hasUnloggedIgnore = (source: string): boolean =>
  pipe(
    [...source.matchAll(/\bEffect\.ignore\b/g)],
    Array.some(
      (match): boolean =>
        !/\b(?:Effect\.log|tapError|tapBoth|catchAll)\b/.test(
          localIgnorePrefix(source, match.index),
        ),
    ),
  );

const pipeBodyAt = (source: string, match: RegExpExecArray): Option.Option<string> => {
  const openParenIndex = source.indexOf('(', match.index);
  return Match.value(openParenIndex).pipe(
    Match.when(
      (index): boolean => index === -1,
      (): Option.Option<string> => Option.none(),
    ),
    Match.orElse(
      (index): Option.Option<string> =>
        Option.some(source.slice(match.index, findBalancedCallEnd(source, index) + 1)),
    ),
  );
};

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const hasMultipleCatchTagsInOnePipe = (source: string): boolean => {
  const code = stripCommentsAndStrings(source);
  return pipe(
    [...code.matchAll(/\.pipe\s*\(/g)],
    Array.some((match): boolean =>
      pipe(
        pipeBodyAt(source, match),
        Option.exists((pipeBody): boolean => {
          const catchTagCount = [...pipeBody.matchAll(/Effect\.catchTag\s*\(/g)].length;
          return catchTagCount > 1 && !/Effect\.catchTags\s*\(/.test(pipeBody);
        }),
      ),
    ),
  );
};

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

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const hasBroadCatchAllWithoutRethrow = (source: string): boolean => {
  const code = stripCommentsAndStrings(source);
  return pipe(
    [...code.matchAll(/Effect\.catchAll\s*\(/g)],
    Array.some((match): boolean =>
      pipe(
        balancedCallBodyAt(source, match),
        Option.exists((callBody): boolean => !/=>\s*Effect\.fail\s*\(/.test(callBody)),
      ),
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
