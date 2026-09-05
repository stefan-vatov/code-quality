import {
  NAVIGATION_CACHE_MAX_WEIGHT,
  navigationIndexCacheWeight,
} from './effect-source-cache-weights';
import type { SourceWeightedCache } from './effect-source-cache-weights';
import { createWeightedCache } from './source-cache';
import { nextSourceLexicalIndex } from './effect-source-navigation-lexer';

const NAVIGATION_CACHE_MAX_ENTRIES = 16;
const CHAR_CODE_BRACE_CLOSE = 125;
const CHAR_CODE_BRACE_OPEN = 123;
const CHAR_CODE_BRACKET_CLOSE = 93;
const CHAR_CODE_BRACKET_OPEN = 91;
const CHAR_CODE_PAREN_CLOSE = 41;
const CHAR_CODE_PAREN_OPEN = 40;
const CHAR_CODE_SEMICOLON = 59;

interface DelimiterFrame {
  charCode: OpeningDelimiterCode;
  eventIndex: number;
  index: number;
}

interface NavigationEvent {
  index: number;
  isSemicolon: boolean;
}

interface BraceScopeTransition {
  boundaryIndex: number;
  openIndex: number;
}

interface ClosedDelimiter {
  eventIndex: number;
}

export interface SourceNavigationIndex {
  enclosingBraceOpen: (targetIndex: number) => number;
  matchingBrace: (openIndex: number) => number;
  matchingCall: (openIndex: number) => number;
  statementEnd: (startIndex: number) => number;
}

const cache: SourceWeightedCache<SourceNavigationIndex> = createWeightedCache({
  maxEntries: NAVIGATION_CACHE_MAX_ENTRIES,
  maxWeight: NAVIGATION_CACHE_MAX_WEIGHT,
});

const lowerBound = (events: readonly NavigationEvent[], targetIndex: number): number => {
  let low = 0;
  let high = events.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if ((events[middle]?.index ?? Number.POSITIVE_INFINITY) < targetIndex) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return low;
};

interface IndexData {
  braceScopeTransitions: BraceScopeTransition[];
  eventAfterCloseIndexes: number[];
  events: NavigationEvent[];
  firstSemicolonIndex: number;
  matchingDelimiters: Map<number, number>;
  statementEndIndexes: number[];
}

interface BuiltNavigationIndex {
  index: SourceNavigationIndex;
  weight: number;
}

type OpeningDelimiterCode =
  | typeof CHAR_CODE_BRACE_OPEN
  | typeof CHAR_CODE_BRACKET_OPEN
  | typeof CHAR_CODE_PAREN_OPEN;

interface ScanState {
  braceStack: number[];
  data: IndexData;
  delimiterStack: DelimiterFrame[];
  closedDelimiters: ClosedDelimiter[];
  statementDelimiterStack: number[];
  sourceLength: number;
}

const finalizeClosedDelimiters = (data: IndexData, closedDelimiters: ClosedDelimiter[]): void => {
  const { eventAfterCloseIndexes, events } = data;
  const eventCount = events.length;
  while (closedDelimiters.length > 0) {
    const closedDelimiter = closedDelimiters.pop();
    if (closedDelimiter !== undefined) {
      eventAfterCloseIndexes[closedDelimiter.eventIndex] = eventCount;
    }
  }
};

const recordNavigationEvent = (state: ScanState, index: number, isSemicolon: boolean): number => {
  finalizeClosedDelimiters(state.data, state.closedDelimiters);
  const eventIndex = state.data.events.length;
  state.data.events.push({ index, isSemicolon });
  state.data.eventAfterCloseIndexes.push(-1);
  return eventIndex;
};

const recordOpeningDelimiter = (
  state: ScanState,
  charCode: OpeningDelimiterCode,
  index: number,
): void => {
  const eventIndex = recordNavigationEvent(state, index, false);
  state.delimiterStack.push({ charCode, eventIndex, index });
  state.statementDelimiterStack.push(eventIndex);
  if (charCode !== CHAR_CODE_BRACE_OPEN) {
    return;
  }
  state.braceStack.push(index);
  state.data.braceScopeTransitions.push({ boundaryIndex: index + 1, openIndex: index });
};

const closeDelimiter = (state: ScanState, frame: DelimiterFrame, index: number): void => {
  state.delimiterStack.pop();
  state.data.matchingDelimiters.set(frame.index, index);
};

const recordBraceClose = (state: ScanState, index: number): void => {
  const openIndex = state.braceStack.pop();
  if (openIndex === undefined) {
    return;
  }
  state.data.braceScopeTransitions.push({
    boundaryIndex: index + 1,
    openIndex: state.braceStack.at(-1) ?? -1,
  });
};

const recordStatementDelimiterClose = (state: ScanState, charCode: number): void => {
  if (matchingOpeningCode(charCode) === undefined) {
    return;
  }
  const eventIndex = state.statementDelimiterStack.pop();
  if (eventIndex !== undefined) {
    state.closedDelimiters.push({ eventIndex });
  }
};

const recordClosingDelimiter = (state: ScanState, charCode: number, index: number): void => {
  const openingCode = matchingOpeningCode(charCode);
  if (openingCode === undefined) {
    return;
  }
  const frame = state.delimiterStack.at(-1);
  if (frame === undefined || frame.charCode !== openingCode) {
    return;
  }
  closeDelimiter(state, frame, index);
};

const createIndexData = (): IndexData => ({
  braceScopeTransitions: [],
  eventAfterCloseIndexes: [],
  events: [],
  firstSemicolonIndex: -1,
  matchingDelimiters: new Map(),
  statementEndIndexes: [],
});

const openingDelimiterCode = (charCode: number): OpeningDelimiterCode | undefined => {
  if (charCode === CHAR_CODE_BRACE_OPEN) {
    return CHAR_CODE_BRACE_OPEN;
  }
  if (charCode === CHAR_CODE_BRACKET_OPEN) {
    return CHAR_CODE_BRACKET_OPEN;
  }
  if (charCode === CHAR_CODE_PAREN_OPEN) {
    return CHAR_CODE_PAREN_OPEN;
  }
  return undefined;
};

const matchingOpeningCode = (charCode: number): OpeningDelimiterCode | undefined => {
  if (charCode === CHAR_CODE_BRACE_CLOSE) {
    return CHAR_CODE_BRACE_OPEN;
  }
  if (charCode === CHAR_CODE_BRACKET_CLOSE) {
    return CHAR_CODE_BRACKET_OPEN;
  }
  if (charCode === CHAR_CODE_PAREN_CLOSE) {
    return CHAR_CODE_PAREN_OPEN;
  }
  return undefined;
};

const recordNonOpeningCodePoint = (state: ScanState, charCode: number, index: number): void => {
  recordStatementDelimiterClose(state, charCode);
  recordClosingDelimiter(state, charCode, index);
  if (charCode === CHAR_CODE_BRACE_CLOSE) {
    recordBraceClose(state, index);
  }
};

const recordCodePoint = (state: ScanState, charCode: number, index: number): void => {
  if (charCode === CHAR_CODE_SEMICOLON) {
    recordNavigationEvent(state, index, true);
    return;
  }
  const openingCode = openingDelimiterCode(charCode);
  if (openingCode !== undefined) {
    recordOpeningDelimiter(state, openingCode, index);
    return;
  }
  recordNonOpeningCodePoint(state, charCode, index);
};

const scanCodeIndex = (source: string, state: ScanState, index: number): number => {
  const charCode = source.charCodeAt(index);
  const nextIndex = nextSourceLexicalIndex(source, index, state.sourceLength, charCode);
  if (nextIndex !== index) {
    return nextIndex;
  }
  recordCodePoint(state, charCode, index);
  return index + 1;
};

const statementEndForEvent = (
  event: NavigationEvent | undefined,
  afterCloseEventIndex: number,
  statementEndIndexes: readonly number[],
  eventCount: number,
  fallbackEndIndex: number,
): number => {
  if (event === undefined) {
    return fallbackEndIndex;
  }
  if (event.isSemicolon) {
    return event.index;
  }
  if (afterCloseEventIndex >= 0 && afterCloseEventIndex < eventCount) {
    return statementEndIndexes[afterCloseEventIndex] ?? fallbackEndIndex;
  }
  return fallbackEndIndex;
};

const buildStatementEndIndexes = (
  events: readonly NavigationEvent[],
  eventAfterCloseIndexes: readonly number[],
  sourceLength: number,
): number[] => {
  const statementEndIndexes: number[] = [];
  const fallbackEndIndex = sourceLength - 1;
  for (let eventIndex = events.length - 1; eventIndex >= 0; eventIndex -= 1) {
    const event = events[eventIndex];
    statementEndIndexes[eventIndex] = statementEndForEvent(
      event,
      eventAfterCloseIndexes[eventIndex] ?? -1,
      statementEndIndexes,
      events.length,
      fallbackEndIndex,
    );
  }
  return statementEndIndexes;
};

const scanSource = (source: string): IndexData => {
  const state: ScanState = {
    braceStack: [],
    closedDelimiters: [],
    data: createIndexData(),
    delimiterStack: [],
    sourceLength: source.length,
    statementDelimiterStack: [],
  };
  let index = 0;
  while (index < state.sourceLength) {
    index = scanCodeIndex(source, state, index);
  }
  finalizeClosedDelimiters(state.data, state.closedDelimiters);
  state.data.firstSemicolonIndex =
    state.data.events.find((event): boolean => event.isSemicolon)?.index ?? -1;
  state.data.statementEndIndexes = buildStatementEndIndexes(
    state.data.events,
    state.data.eventAfterCloseIndexes,
    state.sourceLength,
  );
  return state.data;
};

const statementEndFor = (
  firstSemicolonIndex: number,
  events: readonly NavigationEvent[],
  statementEndIndexes: readonly number[],
  sourceLength: number,
  startIndex: number,
): number => {
  if (startIndex < 0) {
    if (firstSemicolonIndex >= 0) {
      return firstSemicolonIndex;
    }
    return sourceLength - 1;
  }
  const eventIndex = lowerBound(events, Math.max(0, startIndex));
  return statementEndIndexes[eventIndex] ?? sourceLength - 1;
};

const lastBraceScopeTransition = (
  transitions: readonly BraceScopeTransition[],
  targetIndex: number,
): number => {
  let low = 0;
  let high = transitions.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    const transition = transitions[middle];
    if (transition !== undefined && transition.boundaryIndex <= targetIndex) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return low - 1;
};

const enclosingBraceFor = (data: IndexData, targetIndex: number): number => {
  const transitionIndex = lastBraceScopeTransition(data.braceScopeTransitions, targetIndex);
  return data.braceScopeTransitions[transitionIndex]?.openIndex ?? -1;
};

const matchingBraceFor = (source: string, data: IndexData, openIndex: number): number => {
  if (source.charCodeAt(openIndex) !== CHAR_CODE_BRACE_OPEN) {
    return -1;
  }
  return data.matchingDelimiters.get(openIndex) ?? -1;
};

const matchingCallFor = (source: string, data: IndexData, openIndex: number): number => {
  if (source.charCodeAt(openIndex) !== CHAR_CODE_PAREN_OPEN) {
    return source.length - 1;
  }
  return data.matchingDelimiters.get(openIndex) ?? source.length - 1;
};

const buildIndex = (source: string): BuiltNavigationIndex => {
  const data = scanSource(source);
  const index: SourceNavigationIndex = {
    enclosingBraceOpen: (targetIndex): number => enclosingBraceFor(data, targetIndex),
    matchingBrace: (openIndex): number => matchingBraceFor(source, data, openIndex),
    matchingCall: (openIndex): number => matchingCallFor(source, data, openIndex),
    statementEnd: (startIndex): number =>
      statementEndFor(
        data.firstSemicolonIndex,
        data.events,
        data.statementEndIndexes,
        source.length,
        startIndex,
      ),
  };
  return {
    index,
    weight: navigationIndexCacheWeight(source.length, {
      braceScopeTransitionCount: data.braceScopeTransitions.length,
      eventAfterCloseIndexCount: data.eventAfterCloseIndexes.length,
      eventCount: data.events.length,
      matchingDelimiterCount: data.matchingDelimiters.size,
      statementEndIndexCount: data.statementEndIndexes.length,
    }),
  };
};

const cacheIndex = (source: string, built: BuiltNavigationIndex): SourceNavigationIndex =>
  cache.set(source, built.index, built.weight);

export const sourceNavigationIndex = (source: string): SourceNavigationIndex =>
  cache.get(source) ?? cacheIndex(source, buildIndex(source));
