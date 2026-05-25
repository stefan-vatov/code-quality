/* -------------------------------------------------------------------------- */
/*          Fiber observation predicates for always-on Effect rules.          */
/* -------------------------------------------------------------------------- */
import { Array, Match, Option, pipe } from 'effect';
import { sameFunctionTail, stripCommentsAndStrings } from './effect-source-helpers';

const isUnobservedForkMatch = (source: string, match: RegExpExecArray): boolean => {
  const [, fiberName] = match;
  const lineStart = source.lastIndexOf('\n', match.index) + 1;
  const prefix = source.slice(lineStart, match.index);
  if (!fiberName && /\breturn\s+$/.test(prefix)) {
    return false;
  }
  if (!fiberName) {
    return true;
  }

  const observedFiberPattern = new RegExp(
    `(?:yield\\*\\s+Fiber\\.(?:join|interrupt)\\s*\\(\\s*${fiberName}\\b|yield\\*\\s+${fiberName}\\.await\\b)`,
  );
  return !observedFiberPattern.test(sameFunctionTail(source, match.index + match[0].length));
};

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const hasUnobservedFork = (source: string): boolean => {
  const code = stripCommentsAndStrings(source);
  const forkPatterns = [
    /\b(?:(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*)?yield\*\s+Effect\.fork\s*\(/g,
    /\b(?:(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*)?yield\*\s+[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?\.pipe\s*\(\s*Effect\.fork\b/g,
  ];

  return pipe(
    forkPatterns,
    Array.some((pattern): boolean =>
      pipe(
        [...code.matchAll(pattern)],
        Array.some((match): boolean => isUnobservedForkMatch(code, match)),
      ),
    ),
    (hasUnobservedAssignedFork): boolean =>
      hasUnobservedAssignedFork ||
      /^\s*Effect\.fork\s*\(/m.test(code) ||
      /^\s*[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?\.pipe\s*\(\s*Effect\.fork\b/m.test(code),
  );
};

const nextSameNamedForkIndex = (
  assignedForks: RegExpMatchArray[],
  startIndex: number,
  fiberName: string,
): number | undefined =>
  pipe(
    assignedForks.slice(startIndex + 1),
    Array.findFirst((nextMatch): boolean => nextMatch[1] === fiberName),
    Option.flatMapNullable((nextMatch): number | undefined => nextMatch.index),
    Option.getOrUndefined,
  );

const runForkLocalSource = (
  code: string,
  match: RegExpMatchArray,
  nextForkIndex: number | undefined,
): string => {
  const matchIndex = match.index ?? 0;
  return Match.value(nextForkIndex).pipe(
    Match.when(Match.defined, (definedNextForkIndex): string =>
      sameFunctionTail(code, matchIndex).slice(0, definedNextForkIndex - matchIndex),
    ),
    Match.orElse((): string => sameFunctionTail(code, matchIndex)),
  );
};

const hasUnobservedAssignedRunFork = (code: string, assignedForks: RegExpMatchArray[]): boolean =>
  pipe(
    assignedForks,
    Array.some((match, index): boolean => {
      const [, fiberName] = match;
      const nextForkIndex = nextSameNamedForkIndex(assignedForks, index, fiberName);
      const localSource = runForkLocalSource(code, match, nextForkIndex);
      const observedPattern = new RegExp(`\\b${fiberName}\\.addObserver\\b`);
      return !observedPattern.test(localSource);
    }),
  );

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const hasRunForkWithoutObserver = (source: string): boolean => {
  const code = stripCommentsAndStrings(source);
  const assignedForks = [
    ...code.matchAll(/\b(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*Effect\.runFork\s*\(/g),
  ];
  if (hasUnobservedAssignedRunFork(code, assignedForks)) {
    return true;
  }

  const unassignedSource = code.replace(
    /\b(?:const|let)\s+[A-Za-z_$][\w$]*\s*=\s*Effect\.runFork\s*\(/g,
    '',
  );
  return /Effect\.runFork\s*\(/.test(unassignedSource);
};
