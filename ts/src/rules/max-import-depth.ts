/* -------------------------------------------------------------------------- */
/*           Import-depth helper for detecting parent path climbs.            */
/* -------------------------------------------------------------------------- */
import { Match, Predicate } from 'effect';

/**
 * Count leading `../` segments in an import path. Returns 0 for non-relative imports (no leading
 * `..`).
 */
const countImportDepth = (path: string): number =>
  Match.value(path).pipe(
    Match.when(Predicate.not(isParentRelativePath), () => NO_PARENT_IMPORT_DEPTH),
    Match.orElse(countParentDirectorySegments),
  );

export default countImportDepth;

const CHAR_DOT = 46;
const CHAR_SLASH = 47;
const FIRST_CHAR_INDEX = 0;
const SECOND_CHAR_INDEX = 1;
const THIRD_CHAR_INDEX = 2;
const NO_PARENT_IMPORT_DEPTH = 0;
const PARENT_DIRECTORY_SEGMENT_LENGTH = 3;
const PARENT_DIRECTORY_TOKEN_LENGTH = 2;

const countParentDirectorySegments = (path: string): number => {
  let depth = NO_PARENT_IMPORT_DEPTH;
  let index = FIRST_CHAR_INDEX;

  while (hasParentDirectorySegment(path, index)) {
    depth += 1;
    index += PARENT_DIRECTORY_SEGMENT_LENGTH;
  }

  if (hasTrailingParentDirectory(path, index)) {
    return depth + 1;
  }

  return depth;
};

const isParentRelativePath = (path: string): boolean => {
  if (path.length < PARENT_DIRECTORY_TOKEN_LENGTH) {
    return false;
  }
  if (path.charCodeAt(FIRST_CHAR_INDEX) !== CHAR_DOT) {
    return false;
  }
  if (path.charCodeAt(SECOND_CHAR_INDEX) !== CHAR_DOT) {
    return false;
  }
  return path.charCodeAt(THIRD_CHAR_INDEX) !== CHAR_DOT;
};

const hasParentDirectorySegment = (path: string, index: number): boolean => {
  if (index + PARENT_DIRECTORY_TOKEN_LENGTH >= path.length) {
    return false;
  }
  if (path.charCodeAt(index) !== CHAR_DOT) {
    return false;
  }
  if (path.charCodeAt(index + SECOND_CHAR_INDEX) !== CHAR_DOT) {
    return false;
  }
  return path.charCodeAt(index + THIRD_CHAR_INDEX) === CHAR_SLASH;
};

const hasTrailingParentDirectory = (path: string, index: number): boolean => {
  if (index + PARENT_DIRECTORY_TOKEN_LENGTH !== path.length) {
    return false;
  }
  if (path.charCodeAt(index) !== CHAR_DOT) {
    return false;
  }
  return path.charCodeAt(index + SECOND_CHAR_INDEX) === CHAR_DOT;
};
