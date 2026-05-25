/* -------------------------------------------------------------------------- */
/*           Import-depth helper for detecting parent path climbs.            */
/* -------------------------------------------------------------------------- */
import { Match, Predicate } from 'effect';

interface ImportDepthState {
  depth: number;
  index: number;
  path: string;
}

/**
 * Count leading `../` segments in an import path. Returns 0 for non-relative imports (no leading
 * `..`).
 */
const countImportDepth = (path: string): number =>
  Match.value(path).pipe(
    Match.when(Predicate.not(isParentRelativePath), () => NO_PARENT_IMPORT_DEPTH),
    Match.orElse((parentPath) =>
      countParentDirectorySegments({
        depth: NO_PARENT_IMPORT_DEPTH,
        index: FIRST_CHAR_INDEX,
        path: parentPath,
      }),
    ),
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

const nextParentDirectorySegment = (state: ImportDepthState): ImportDepthState => ({
  ...state,
  depth: state.depth + 1,
  index: state.index + PARENT_DIRECTORY_SEGMENT_LENGTH,
});

const countParentDirectorySegments = (state: ImportDepthState): number =>
  Match.value(state).pipe(
    Match.when(
      ({ index, path }): boolean => hasParentDirectorySegment(path, index),
      (currentState) => countParentDirectorySegments(nextParentDirectorySegment(currentState)),
    ),
    Match.when(
      ({ index, path }): boolean => hasTrailingParentDirectory(path, index),
      ({ depth }) => depth + 1,
    ),
    Match.orElse(({ depth }) => depth),
  );

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
