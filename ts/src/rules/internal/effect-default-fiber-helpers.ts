import type { SourceNavigationIndex } from './effect-source-navigation-index';
import { sourceNavigationIndex } from './effect-source-navigation-index';
import { stripCommentsAndStrings } from './effect-source-helpers';

const EFFECT_CALL_PATTERN = /\bEffect\.(?:gen|fn)\s*\(/g;
const FUNCTION_BOUNDARY_PATTERN =
  /\n\s*(?:export\s+)?(?:(?:async\s+)?function\b|const\s+[A-Za-z_$][\w$]*\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)?\s*=>)/g;
const ADD_OBSERVER_PATTERN = /\b([A-Za-z_$][\w$]*)\.addObserver\b/g;
const FIBER_OBSERVATION_PATTERN =
  /\b(?:yield\*\s+Fiber\.(?:join|interrupt)\s*\(\s*([A-Za-z_$][\w$]*)\b|yield\*\s+([A-Za-z_$][\w$]*)\.await\b)/g;
const ASSIGNED_RUN_FORK_PATTERN =
  /\b(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*Effect\.runFork\s*\(/g;
const DIRECT_RUN_FORK_PATTERN = /\bEffect\.runFork\s*\(/g;
const YIELDED_FORK_PATTERNS = [
  /\b(?:(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*)?yield\*\s+Effect\.fork\s*\(/g,
  /\b(?:(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*)?yield\*\s+[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?\.pipe\s*\(\s*Effect\.fork\b/g,
];
const DIRECT_FORK_PATTERNS = [
  /^\s*Effect\.fork\s*\(/m,
  /^\s*[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?\.pipe\s*\(\s*Effect\.fork\b/m,
];

interface EffectCallBoundary {
  endIndex: number;
  startIndex: number;
}

interface SourceTailIndex {
  readonly braceEnds: Map<number, number>;
  readonly effectCalls: EffectCallBoundary[];
  readonly functionStarts: number[];
  readonly navigation: SourceNavigationIndex;
}

interface NamedPositions {
  readonly positions: Map<string, number[]>;
}

interface AssignedRunFork {
  readonly callIndex: number;
  readonly fiberName: string;
  readonly startIndex: number;
  nextBoundaryIndex: number | undefined;
}

interface FunctionEnd {
  readonly endIndex: number;
  readonly nextIndex: number;
}

const lowerBound = (positions: readonly number[], targetIndex: number): number => {
  let low = 0;
  let high = positions.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if ((positions[middle] ?? Number.POSITIVE_INFINITY) < targetIndex) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return low;
};

const buildNamedPositions = (code: string, pattern: RegExp): NamedPositions => {
  const positions = new Map<string, number[]>();
  for (const match of code.matchAll(pattern)) {
    const fiberName = match[1] ?? match[2];
    if (fiberName !== undefined && match.index !== undefined && !fiberName.includes('$')) {
      const namePositions = positions.get(fiberName);
      if (namePositions === undefined) {
        positions.set(fiberName, [match.index]);
      } else {
        namePositions.push(match.index);
      }
    }
  }
  return { positions };
};

const buildEffectCallBoundaries = (
  code: string,
  navigation: SourceNavigationIndex,
): EffectCallBoundary[] => {
  const effectCalls: EffectCallBoundary[] = [];
  for (const match of code.matchAll(EFFECT_CALL_PATTERN)) {
    if (match.index !== undefined) {
      const openParenIndex = code.indexOf('(', match.index);
      if (openParenIndex !== -1) {
        effectCalls.push({
          endIndex: navigation.matchingCall(openParenIndex),
          startIndex: openParenIndex,
        });
      }
    }
  }
  return effectCalls;
};

const buildFunctionStarts = (code: string): number[] => {
  const functionStarts: number[] = [];
  for (const match of code.matchAll(FUNCTION_BOUNDARY_PATTERN)) {
    if (match.index !== undefined) {
      functionStarts.push(match.index);
    }
  }
  return functionStarts;
};

const buildTailIndex = (code: string): SourceTailIndex => {
  const navigation = sourceNavigationIndex(code);
  return {
    braceEnds: new Map(),
    effectCalls: buildEffectCallBoundaries(code, navigation),
    functionStarts: buildFunctionStarts(code),
    navigation,
  };
};

interface EffectTailSearch {
  readonly boundary: EffectCallBoundary | undefined;
  readonly nextIndex: number;
}

const nextEffectCallIndex = (
  sourceIndex: SourceTailIndex,
  targetIndex: number,
  startIndex: number,
): number => {
  let nextIndex = startIndex;
  while (nextIndex < sourceIndex.effectCalls.length) {
    const effectCall = sourceIndex.effectCalls[nextIndex];
    if (effectCall === undefined || targetIndex <= effectCall.endIndex) {
      break;
    }
    nextIndex += 1;
  }
  return nextIndex;
};

const effectCallForTarget = (
  sourceIndex: SourceTailIndex,
  targetIndex: number,
  startIndex: number,
): EffectTailSearch => {
  const nextIndex = nextEffectCallIndex(sourceIndex, targetIndex, startIndex);
  const effectCall = sourceIndex.effectCalls[nextIndex];
  if (
    effectCall === undefined ||
    effectCall.startIndex > targetIndex ||
    targetIndex > effectCall.endIndex
  ) {
    return { boundary: undefined, nextIndex };
  }
  return { boundary: effectCall, nextIndex };
};

const cachedBraceEnd = (sourceIndex: SourceTailIndex, braceOpenIndex: number): number => {
  const cachedEndIndex = sourceIndex.braceEnds.get(braceOpenIndex);
  if (cachedEndIndex !== undefined) {
    return cachedEndIndex;
  }
  const braceEndIndex = sourceIndex.navigation.matchingBrace(braceOpenIndex);
  sourceIndex.braceEnds.set(braceOpenIndex, braceEndIndex);
  return braceEndIndex;
};

const braceEndForTarget = (
  sourceIndex: SourceTailIndex,
  targetIndex: number,
): number | undefined => {
  const braceOpenIndex = sourceIndex.navigation.enclosingBraceOpen(targetIndex);
  if (braceOpenIndex === -1) {
    return undefined;
  }
  const braceEndIndex = cachedBraceEnd(sourceIndex, braceOpenIndex);
  if (braceEndIndex === -1) {
    return undefined;
  }
  return braceEndIndex;
};

const functionEndForTarget = (
  functionStarts: readonly number[],
  targetIndex: number,
  startIndex: number,
): FunctionEnd => {
  let nextIndex = startIndex;
  while (
    nextIndex < functionStarts.length &&
    (functionStarts[nextIndex] ?? Infinity) <= targetIndex
  ) {
    nextIndex += 1;
  }
  const functionStart = functionStarts[nextIndex];
  let endIndex = Number.POSITIVE_INFINITY;
  if (functionStart !== undefined) {
    endIndex = functionStart - 1;
  }
  return {
    endIndex,
    nextIndex,
  };
};

const tailEndWithoutEffectCall = (
  sourceIndex: SourceTailIndex,
  targetIndex: number,
  functionStartIndex: number,
): FunctionEnd => {
  const braceEndIndex = braceEndForTarget(sourceIndex, targetIndex);
  if (braceEndIndex !== undefined) {
    return { endIndex: braceEndIndex, nextIndex: functionStartIndex };
  }
  return functionEndForTarget(sourceIndex.functionStarts, targetIndex, functionStartIndex);
};

const createTailEndFinder = (sourceIndex: SourceTailIndex): ((targetIndex: number) => number) => {
  let effectCallIndex = 0;
  let functionStartIndex = 0;
  return (targetIndex: number): number => {
    const effectSearch = effectCallForTarget(sourceIndex, targetIndex, effectCallIndex);
    effectCallIndex = effectSearch.nextIndex;
    if (effectSearch.boundary !== undefined) {
      return effectSearch.boundary.endIndex;
    }
    const tailEnd = tailEndWithoutEffectCall(sourceIndex, targetIndex, functionStartIndex);
    functionStartIndex = tailEnd.nextIndex;
    return tailEnd.endIndex;
  };
};

const tailEndsForTargets = (sourceIndex: SourceTailIndex, targets: readonly number[]): number[] => {
  const tailEndForTarget = createTailEndFinder(sourceIndex);
  return targets.map((targetIndex): number => tailEndForTarget(targetIndex));
};

const hasPositionInRange = (
  positions: readonly number[] | undefined,
  startIndex: number,
  endIndex: number,
): boolean => {
  if (positions === undefined) {
    return false;
  }
  const positionIndex = lowerBound(positions, startIndex);
  const position = positions[positionIndex];
  return position !== undefined && position < endIndex;
};

const linePrefixEndsWithReturn = (code: string, targetIndex: number): boolean => {
  const lineStart = code.lastIndexOf('\n', targetIndex) + 1;
  return /\breturn\s+$/.test(code.slice(lineStart, targetIndex));
};

const yieldedForkIsUnobserved = (
  code: string,
  match: RegExpMatchArray,
  tailEnd: number,
  observations: NamedPositions,
): boolean => {
  const [, fiberName] = match;
  const matchIndex = match.index ?? 0;
  if (fiberName === undefined) {
    return !linePrefixEndsWithReturn(code, matchIndex);
  }
  const namePositions = observations.positions.get(fiberName);
  return !hasPositionInRange(namePositions, matchIndex + match[0].length, tailEnd + 1);
};

const yieldedForkTargets = (matches: readonly RegExpMatchArray[]): number[] =>
  matches.map((match): number => (match.index ?? 0) + match[0].length);

const hasUnobservedYieldedForks = (
  code: string,
  matches: readonly RegExpMatchArray[],
  observations: NamedPositions,
  sourceIndex: SourceTailIndex,
): boolean => {
  const tailEnds = tailEndsForTargets(sourceIndex, yieldedForkTargets(matches));

  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const tailEnd = tailEnds[index];
    if (
      match !== undefined &&
      tailEnd !== undefined &&
      yieldedForkIsUnobserved(code, match, tailEnd, observations)
    ) {
      return true;
    }
  }
  return false;
};

const hasUnobservedYieldedFork = (code: string, matches: readonly RegExpMatchArray[]): boolean => {
  const observations = buildNamedPositions(code, FIBER_OBSERVATION_PATTERN);
  const sourceIndex = buildTailIndex(code);
  return hasUnobservedYieldedForks(code, matches, observations, sourceIndex);
};

const hasUnassignedFork = (code: string): boolean => {
  for (const pattern of DIRECT_FORK_PATTERNS) {
    if (pattern.test(code)) {
      return true;
    }
  }
  return false;
};

export const hasUnobservedFork = (source: string): boolean => {
  const code = stripCommentsAndStrings(source);
  for (const pattern of YIELDED_FORK_PATTERNS) {
    const matches = [...code.matchAll(pattern)];
    if (matches.length > 0 && hasUnobservedYieldedFork(code, matches)) {
      return true;
    }
  }
  return hasUnassignedFork(code);
};

const assignedRunForkFromMatch = (match: RegExpMatchArray): AssignedRunFork | undefined => {
  const [, fiberName] = match;
  if (fiberName === undefined) {
    return undefined;
  }
  const matchIndex = match.index ?? 0;
  return {
    callIndex: matchIndex + match[0].indexOf('Effect.runFork'),
    fiberName,
    nextBoundaryIndex: undefined,
    startIndex: matchIndex,
  };
};

const setNextSameNameBoundaries = (assignedForks: AssignedRunFork[]): void => {
  const nextByName = new Map<string, number>();
  for (let index = assignedForks.length - 1; index >= 0; index -= 1) {
    const assignedFork = assignedForks[index];
    if (assignedFork !== undefined) {
      assignedFork.nextBoundaryIndex = nextByName.get(assignedFork.fiberName);
      nextByName.set(assignedFork.fiberName, assignedFork.startIndex);
    }
  }
};

const buildAssignedRunForks = (code: string): AssignedRunFork[] => {
  const assignedForks: AssignedRunFork[] = [];
  for (const match of code.matchAll(ASSIGNED_RUN_FORK_PATTERN)) {
    const assignedFork = assignedRunForkFromMatch(match);
    if (assignedFork !== undefined) {
      assignedForks.push(assignedFork);
    }
  }
  setNextSameNameBoundaries(assignedForks);
  return assignedForks;
};

const assignedRunForkIsUnobserved = (
  assignedFork: AssignedRunFork,
  tailEndIndex: number,
  observations: NamedPositions,
): boolean => {
  const endIndex = Math.min(tailEndIndex + 1, assignedFork.nextBoundaryIndex ?? Infinity);
  const namePositions = observations.positions.get(assignedFork.fiberName);
  return !hasPositionInRange(namePositions, assignedFork.startIndex, endIndex);
};

const hasUnobservedAssignedRunFork = (code: string, assignedForks: AssignedRunFork[]): boolean => {
  const observations = buildNamedPositions(code, ADD_OBSERVER_PATTERN);
  const sourceIndex = buildTailIndex(code);
  const targets = assignedForks.map(({ startIndex }): number => startIndex);
  const tailEnds = tailEndsForTargets(sourceIndex, targets);

  for (let index = 0; index < assignedForks.length; index += 1) {
    const assignedFork = assignedForks[index];
    const tailEndIndex = tailEnds[index];
    if (
      assignedFork !== undefined &&
      tailEndIndex !== undefined &&
      assignedRunForkIsUnobserved(assignedFork, tailEndIndex, observations)
    ) {
      return true;
    }
  }
  return false;
};

const hasUnassignedRunFork = (code: string, assignedForks: readonly AssignedRunFork[]): boolean => {
  const assignedCallIndexes = assignedForks.map(({ callIndex }): number => callIndex);
  let assignedIndex = 0;
  for (const match of code.matchAll(DIRECT_RUN_FORK_PATTERN)) {
    const matchIndex = match.index ?? 0;
    while (
      assignedIndex < assignedCallIndexes.length &&
      (assignedCallIndexes[assignedIndex] ?? Number.POSITIVE_INFINITY) < matchIndex
    ) {
      assignedIndex += 1;
    }
    if (assignedCallIndexes[assignedIndex] !== matchIndex) {
      return true;
    }
  }
  return false;
};

export const hasRunForkWithoutObserver = (source: string): boolean => {
  const code = stripCommentsAndStrings(source);
  const assignedForks = buildAssignedRunForks(code);
  if (assignedForks.length > 0 && hasUnobservedAssignedRunFork(code, assignedForks)) {
    return true;
  }
  return hasUnassignedRunFork(code, assignedForks);
};
