/* -------------------------------------------------------------------------- */
/*           TypeScript binding-pattern names for export indexing.            */
/* -------------------------------------------------------------------------- */
import { bindingPatternIndex } from './effect-export-binding-pattern-index';

const CHAR_CODE_BRACE_OPEN = 123;
const CHAR_CODE_BRACKET_OPEN = 91;
const CHAR_CODE_COLON = 58;
const CHAR_CODE_DOT = 46;
const REST_DOT_COUNT = 3;
const {
  bindingPatternEnd: indexedBindingPatternEnd,
  createPatternDelimiterIndex,
  identifierEnd,
  indexedPatternEnd,
  isIdentifierStart,
  nextPatternTokenIndex,
  patternEntryEnd,
} = bindingPatternIndex;
type PatternDelimiterIndex = ReturnType<typeof createPatternDelimiterIndex>;

interface PatternWorkItem {
  readonly endIndex: number;
  readonly isObjectPattern: boolean;
  nextEntryIndex: number;
  readonly startIndex: number;
}

interface PatternEntry {
  readonly code: string;
  readonly delimiterIndex: PatternDelimiterIndex;
  readonly endIndex: number;
  readonly names: string[];
  readonly startIndex: number;
}

const createPatternWorkItem = (
  code: string,
  startIndex: number,
  endIndex: number,
): PatternWorkItem => ({
  endIndex,
  isObjectPattern: code.charCodeAt(startIndex) === CHAR_CODE_BRACE_OPEN,
  nextEntryIndex: startIndex + 1,
  startIndex,
});

const restBindingStart = (code: string, startIndex: number, endIndex: number): number => {
  const tokenStart = nextPatternTokenIndex(code, startIndex, endIndex);
  if (code.charCodeAt(tokenStart) === CHAR_CODE_DOT) {
    return nextPatternTokenIndex(code, tokenStart + REST_DOT_COUNT, endIndex);
  }
  return tokenStart;
};

const addObjectPatternValue = (
  entry: PatternEntry,
  separatorIndex: number,
  workStack: PatternWorkItem[],
): void => {
  const valueStart = nextPatternTokenIndex(entry.code, separatorIndex + 1, entry.endIndex);
  workStack.push(
    createPatternWorkItem(
      entry.code,
      valueStart,
      indexedPatternEnd(entry.delimiterIndex, valueStart, entry.endIndex),
    ),
  );
};

const addIdentifierObjectEntry = (
  entry: PatternEntry,
  identifierStart: number,
  workStack: PatternWorkItem[],
): void => {
  const { code, endIndex, names } = entry;
  const nameEnd = Math.min(identifierEnd(code, identifierStart), endIndex);
  const separatorIndex = nextPatternTokenIndex(code, nameEnd, endIndex);
  if (code.charCodeAt(separatorIndex) === CHAR_CODE_COLON) {
    addObjectPatternValue(entry, separatorIndex, workStack);
    return;
  }
  names.push(code.slice(identifierStart, nameEnd));
};

const addObjectPatternEntry = (entry: PatternEntry, workStack: PatternWorkItem[]): void => {
  const identifierStart = restBindingStart(entry.code, entry.startIndex, entry.endIndex);
  if (isIdentifierStart(entry.code.charCodeAt(identifierStart))) {
    addIdentifierObjectEntry(entry, identifierStart, workStack);
  }
};

const addArrayPatternEntry = (entry: PatternEntry, workStack: PatternWorkItem[]): void => {
  const { code, delimiterIndex, endIndex, startIndex } = entry;
  const patternStart = restBindingStart(code, startIndex, endIndex);
  if (patternStart < endIndex) {
    workStack.push(
      createPatternWorkItem(
        code,
        patternStart,
        indexedPatternEnd(delimiterIndex, patternStart, endIndex),
      ),
    );
  }
};

const addPatternEntryBindings = (
  entry: PatternEntry,
  isObjectPattern: boolean,
  workStack: PatternWorkItem[],
): void => {
  if (isObjectPattern) {
    addObjectPatternEntry(entry, workStack);
    return;
  }
  addArrayPatternEntry(entry, workStack);
};

const isPatternWorkItemFinished = (
  code: string,
  workItem: PatternWorkItem,
  names: string[],
): boolean => {
  const firstCode = code.charCodeAt(workItem.startIndex);
  if (isIdentifierStart(firstCode)) {
    names.push(
      code.slice(
        workItem.startIndex,
        Math.min(identifierEnd(code, workItem.startIndex), workItem.endIndex),
      ),
    );
    return true;
  }
  if (firstCode !== CHAR_CODE_BRACE_OPEN && firstCode !== CHAR_CODE_BRACKET_OPEN) {
    return true;
  }
  return workItem.nextEntryIndex >= workItem.endIndex - 1;
};

const processPatternWorkItem = (
  code: string,
  delimiterIndex: PatternDelimiterIndex,
  names: string[],
  workStack: PatternWorkItem[],
): void => {
  const workItem = workStack[workStack.length - 1];
  if (workItem === undefined) {
    return;
  }
  if (isPatternWorkItemFinished(code, workItem, names)) {
    workStack.pop();
    return;
  }
  const entryStart = workItem.nextEntryIndex;
  const entryEnd = patternEntryEnd(code, delimiterIndex, entryStart, workItem.endIndex - 1);
  workItem.nextEntryIndex = Math.min(entryEnd + 1, workItem.endIndex);
  addPatternEntryBindings(
    {
      code,
      delimiterIndex,
      endIndex: entryEnd,
      names,
      startIndex: entryStart,
    },
    workItem.isObjectPattern,
    workStack,
  );
};

const addPatternBindings = (
  code: string,
  startIndex: number,
  endIndex: number,
  names: string[],
): void => {
  const patternStart = nextPatternTokenIndex(code, startIndex, endIndex);
  if (patternStart >= endIndex) {
    return;
  }
  if (isIdentifierStart(code.charCodeAt(patternStart))) {
    names.push(code.slice(patternStart, Math.min(identifierEnd(code, patternStart), endIndex)));
    return;
  }
  const delimiterIndex = createPatternDelimiterIndex(code, patternStart, endIndex);
  const workStack: PatternWorkItem[] = [createPatternWorkItem(code, patternStart, endIndex)];
  while (workStack.length > 0) {
    processPatternWorkItem(code, delimiterIndex, names, workStack);
  }
};

/**
 * Finds the end-exclusive range of an identifier or destructuring binding pattern.
 */
export const bindingPatternEnd = indexedBindingPatternEnd;

/**
 * Collects every local binding name owned by one binding pattern.
 */
export const bindingPatternNames = (
  code: string,
  startIndex: number,
  endIndex: number,
): readonly string[] => {
  const names: string[] = [];
  addPatternBindings(code, startIndex, endIndex, names);
  return names;
};
