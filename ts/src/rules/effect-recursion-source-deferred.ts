/* -------------------------------------------------------------------------- */
/*        Deferred callback ranges for source-backed Effect recursion.        */
/* -------------------------------------------------------------------------- */

import type { SourceNavigationIndex } from './effect-source-navigation-index';

const DEFERRED_EFFECT_CALLBACK = /\bEffect\.(?:flatMap|gen|map|succeed|suspend)\s*\(/g;
const FUNCTION_OR_ARROW = /=>|\bfunction\b/g;

/**
 * Source offsets used by the deferred callback index.
 */
export interface SourceRange {
  end: number;
  start: number;
}

/**
 * One Effect call and its callback argument ranges.
 */
export interface DeferredCallRange extends SourceRange {
  callbackRanges: readonly SourceRange[];
  parent: number;
}

interface DeferredCallCandidate extends SourceRange {
  callbackRanges: SourceRange[];
  parent: number;
}

interface DeferredCallCandidates {
  readonly byOpen: Map<number, number>;
  readonly candidates: DeferredCallCandidate[];
}

const matchIndexes = (source: string, pattern: RegExp): number[] => {
  const matcher = new RegExp(pattern.source, pattern.flags);
  return [...source.matchAll(matcher)].map((match) => match.index);
};

const lastIndexBefore = (indexes: readonly number[], target: number): number => {
  let low = 0;
  let high = indexes.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if ((indexes[middle] ?? Number.POSITIVE_INFINITY) < target) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return low - 1;
};

const deferredCallCandidates = (
  source: string,
  navigation: SourceNavigationIndex,
): DeferredCallCandidates => {
  const byOpen = new Map<number, number>();
  const candidates: DeferredCallCandidate[] = [];
  for (const match of source.matchAll(DEFERRED_EFFECT_CALLBACK)) {
    const open = source.indexOf('(', match.index);
    if (open !== -1) {
      byOpen.set(open, candidates.length);
      candidates.push({
        callbackRanges: [],
        end: navigation.matchingCall(open),
        parent: -1,
        start: open,
      });
    }
  }
  return { byOpen, candidates };
};

interface DeferredArgumentScan {
  argumentRanges: SourceRange[][];
  argumentStarts: number[];
  byOpen: ReadonlyMap<number, number>;
  candidates: DeferredCallCandidate[];
  closed: Set<number>;
  active: number[];
  delimiterStack: number[];
}

const appendArgumentRange = (scan: DeferredArgumentScan, callIndex: number, end: number): void => {
  const start = scan.argumentStarts[callIndex];
  if (start !== undefined && start < end) {
    scan.argumentRanges[callIndex]?.push({ end, start });
  }
};

const openDeferredArgumentCall = (index: number, scan: DeferredArgumentScan): void => {
  const callIndex = scan.byOpen.get(index);
  if (callIndex === undefined) {
    return;
  }
  const candidate = scan.candidates[callIndex];
  if (candidate) {
    candidate.parent = scan.active.at(-1) ?? -1;
    scan.active.push(callIndex);
    const { argumentStarts } = scan;
    argumentStarts[callIndex] = index + 1;
  }
};

const scanDeferredComma = (index: number, scan: DeferredArgumentScan): void => {
  const callIndex = scan.byOpen.get(scan.delimiterStack.at(-1) ?? -1);
  if (callIndex !== undefined) {
    appendArgumentRange(scan, callIndex, index);
    const { argumentStarts } = scan;
    argumentStarts[callIndex] = index + 1;
  }
};

const closeDeferredArgumentCall = (index: number, scan: DeferredArgumentScan): void => {
  const open = scan.delimiterStack.pop();
  if (open === undefined) {
    return;
  }
  const callIndex = scan.byOpen.get(open);
  if (callIndex === undefined) {
    return;
  }
  appendArgumentRange(scan, callIndex, index + 1);
  scan.closed.add(callIndex);
  if (scan.active.at(-1) === callIndex) {
    scan.active.pop();
  }
};

const scanDeferredDelimiter = (
  character: string | undefined,
  index: number,
  scan: DeferredArgumentScan,
): void => {
  if (character === '(') {
    scan.delimiterStack.push(index);
    openDeferredArgumentCall(index, scan);
    return;
  }
  if (character === '[' || character === '{') {
    scan.delimiterStack.push(index);
    return;
  }
  if (character === ',') {
    scanDeferredComma(index, scan);
    return;
  }
  if (character === ']' || character === '}') {
    scan.delimiterStack.pop();
    return;
  }
  if (character === ')') {
    closeDeferredArgumentCall(index, scan);
  }
};

const scanDeferredArguments = (
  source: string,
  byOpen: ReadonlyMap<number, number>,
  candidates: DeferredCallCandidate[],
): SourceRange[][] => {
  const scan: DeferredArgumentScan = {
    active: [],
    argumentRanges: candidates.map(() => []),
    argumentStarts: candidates.map((candidate) => candidate.start + 1),
    byOpen,
    candidates,
    closed: new Set(),
    delimiterStack: [],
  };
  for (let index = 0; index < source.length; index += 1) {
    scanDeferredDelimiter(source[index], index, scan);
  }
  for (let callIndex = 0; callIndex < candidates.length; callIndex += 1) {
    const candidate = candidates[callIndex];
    if (candidate && !scan.closed.has(callIndex)) {
      appendArgumentRange(scan, callIndex, Math.min(candidate.end + 1, source.length));
    }
  }
  return scan.argumentRanges;
};

const callbackRangeFor = (
  markers: readonly number[],
  argument: SourceRange,
): SourceRange | undefined => {
  const marker = markers[lastIndexBefore(markers, argument.start - 1) + 1];
  if (marker !== undefined && marker < argument.end) {
    return { end: argument.end, start: marker };
  }
  return undefined;
};

/**
 * Index deferred Effect callback argument ranges in source text.
 *
 * @param source - Comment-free, string-free source projection.
 * @returns Deferred Effect call ranges and their callback descendants.
 * @throws Does not throw.
 */
export const deferredCallRanges = (
  source: string,
  navigation: SourceNavigationIndex,
): DeferredCallRange[] => {
  const { byOpen, candidates } = deferredCallCandidates(source, navigation);
  const argumentRanges = scanDeferredArguments(source, byOpen, candidates);
  const markers = matchIndexes(source, FUNCTION_OR_ARROW);
  for (let callIndex = 0; callIndex < candidates.length; callIndex += 1) {
    const candidate = candidates[callIndex];
    if (candidate) {
      candidate.callbackRanges = (argumentRanges[callIndex] ?? [])
        .map((argument) => callbackRangeFor(markers, argument))
        .filter((range): range is SourceRange => range !== undefined);
    }
  }
  return candidates;
};
