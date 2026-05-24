/**
 * Fiber observation predicates for always-on Effect rules.
 *
 * @internal
 */
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

  for (const pattern of forkPatterns) {
    for (const match of code.matchAll(pattern)) {
      if (isUnobservedForkMatch(code, match)) {
        return true;
      }
    }
  }

  return (
    /^\s*Effect\.fork\s*\(/m.test(code) ||
    /^\s*[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?\.pipe\s*\(\s*Effect\.fork\b/m.test(code)
  );
};

const nextSameNamedForkIndex = (
  assignedForks: RegExpMatchArray[],
  startIndex: number,
  fiberName: string,
): number | undefined =>
  assignedForks.slice(startIndex + 1).find((nextMatch): boolean => nextMatch[1] === fiberName)
    ?.index;

const runForkLocalSource = (
  code: string,
  match: RegExpMatchArray,
  nextForkIndex: number | undefined,
): string => {
  const matchIndex = match.index ?? 0;
  if (nextForkIndex !== undefined) {
    return sameFunctionTail(code, matchIndex).slice(0, nextForkIndex - matchIndex);
  }
  return sameFunctionTail(code, matchIndex);
};

const hasUnobservedAssignedRunFork = (code: string, assignedForks: RegExpMatchArray[]): boolean => {
  for (const [index, match] of assignedForks.entries()) {
    const [, fiberName] = match;
    const nextForkIndex = nextSameNamedForkIndex(assignedForks, index, fiberName);
    const localSource = runForkLocalSource(code, match, nextForkIndex);
    const observedPattern = new RegExp(`\\b${fiberName}\\.addObserver\\b`);
    if (!observedPattern.test(localSource)) {
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
