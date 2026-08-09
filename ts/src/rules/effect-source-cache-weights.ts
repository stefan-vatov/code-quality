/* -------------------------------------------------------------------------- */
/*               Conservative weights for source-backed caches.               */
/* -------------------------------------------------------------------------- */
import type { createWeightedCache } from './source-cache';

const UTF16_CODE_UNIT_BYTES = 2;
const CACHE_ENTRY_BYTES = 128;
const ARRAY_BASE_BYTES = 128;
const MAP_BASE_BYTES = 256;
const LINE_START_VALUE_BYTES = 32;
const TOKEN_MAP_ENTRY_BYTES = 96;
const NAVIGATION_NUMBER_BYTES = 32;
const NAVIGATION_EVENT_BYTES = 96;
const NAVIGATION_TRANSITION_BYTES = 96;
const NAVIGATION_MAP_ENTRY_BYTES = 128;
const NAVIGATION_INDEX_OBJECT_BYTES = 256;
const NAVIGATION_CLOSURE_BYTES = 256;
const NAVIGATION_CLOSURE_COUNT = 4;
const REGEX_INDEX_OBJECT_BYTES = 256;
const REGEX_MAP_ENTRY_BYTES = 128;
const REGEX_SET_BASE_BYTES = 256;
const REGEX_SET_ENTRY_BYTES = 96;
const CACHE_MEBIBYTE_BYTES = 1_048_576;
const LINE_START_CACHE_MAX_MEBIBYTES = 7;
const NAVIGATION_CACHE_MAX_MEBIBYTES = 9;
const REGEX_INDEX_CACHE_MAX_MEBIBYTES = 5;
const SOURCE_TOKEN_PRESENCE_CACHE_MAX_MEBIBYTES = 4;

/**
 * Maximum retained weight for line-start indexes in bytes.
 *
 * @internal
 */
export const LINE_START_CACHE_MAX_WEIGHT = LINE_START_CACHE_MAX_MEBIBYTES * CACHE_MEBIBYTE_BYTES;
/**
 * Maximum retained weight for navigation indexes in bytes.
 *
 * @internal
 */
export const NAVIGATION_CACHE_MAX_WEIGHT = NAVIGATION_CACHE_MAX_MEBIBYTES * CACHE_MEBIBYTE_BYTES;
/**
 * Maximum retained weight for regex indexes in bytes.
 *
 * @internal
 */
export const REGEX_INDEX_CACHE_MAX_WEIGHT = REGEX_INDEX_CACHE_MAX_MEBIBYTES * CACHE_MEBIBYTE_BYTES;
/**
 * Maximum retained weight for token-presence facts in bytes.
 *
 * @internal
 */
export const SOURCE_TOKEN_PRESENCE_CACHE_MAX_WEIGHT =
  SOURCE_TOKEN_PRESENCE_CACHE_MAX_MEBIBYTES * CACHE_MEBIBYTE_BYTES;

/**
 * Counts retained navigation index structures for weight estimation.
 *
 * @internal
 */
export interface NavigationIndexWeightInput {
  braceScopeTransitionCount: number;
  eventAfterCloseIndexCount: number;
  eventCount: number;
  matchingDelimiterCount: number;
  statementEndIndexCount: number;
}

/**
 * Counts retained regex index structures for weight estimation.
 *
 * @internal
 */
export interface RegexIndexWeightInput {
  endCount: number;
  startCount: number;
}

/**
 * String-keyed weighted cache type used by source-backed indexes.
 *
 * @internal
 */
export type SourceWeightedCache<Value> = ReturnType<typeof createWeightedCache<string, Value>>;

const sourceTextBytes = (sourceLength: number): number => sourceLength * UTF16_CODE_UNIT_BYTES;

/**
 * Estimate line-start cache bytes from the source key and retained offsets.
 *
 * @internal
 */
export const lineStartCacheWeight = (sourceLength: number, lineStartCount: number): number =>
  sourceTextBytes(sourceLength) +
  CACHE_ENTRY_BYTES +
  ARRAY_BASE_BYTES +
  lineStartCount * LINE_START_VALUE_BYTES;

/**
 * Estimate token-presence cache bytes from the source key and retained token keys.
 *
 * @internal
 */
export const sourceTokenPresenceCacheWeight = (
  sourceLength: number,
  tokens: Iterable<string>,
): number => {
  let tokenEntriesWeight = 0;
  for (const token of tokens) {
    tokenEntriesWeight += sourceTextBytes(token.length) + TOKEN_MAP_ENTRY_BYTES;
  }
  return sourceTextBytes(sourceLength) + CACHE_ENTRY_BYTES + MAP_BASE_BYTES + tokenEntriesWeight;
};

/**
 * Estimate navigation cache bytes from the source key and retained index structures.
 *
 * @internal
 */
export const navigationIndexCacheWeight = (
  sourceLength: number,
  input: NavigationIndexWeightInput,
): number =>
  sourceTextBytes(sourceLength) +
  CACHE_ENTRY_BYTES +
  NAVIGATION_INDEX_OBJECT_BYTES +
  NAVIGATION_CLOSURE_BYTES * NAVIGATION_CLOSURE_COUNT +
  ARRAY_BASE_BYTES +
  input.braceScopeTransitionCount * NAVIGATION_TRANSITION_BYTES +
  ARRAY_BASE_BYTES +
  input.eventAfterCloseIndexCount * NAVIGATION_NUMBER_BYTES +
  ARRAY_BASE_BYTES +
  input.eventCount * NAVIGATION_EVENT_BYTES +
  MAP_BASE_BYTES +
  input.matchingDelimiterCount * NAVIGATION_MAP_ENTRY_BYTES +
  ARRAY_BASE_BYTES +
  input.statementEndIndexCount * NAVIGATION_NUMBER_BYTES;

/**
 * Estimate regex cache bytes from the source key and retained map/set entries.
 *
 * @internal
 */
export const regexIndexCacheWeight = (sourceLength: number, input: RegexIndexWeightInput): number =>
  sourceTextBytes(sourceLength) +
  CACHE_ENTRY_BYTES +
  REGEX_INDEX_OBJECT_BYTES +
  MAP_BASE_BYTES +
  input.endCount * REGEX_MAP_ENTRY_BYTES +
  REGEX_SET_BASE_BYTES +
  input.startCount * REGEX_SET_ENTRY_BYTES;
