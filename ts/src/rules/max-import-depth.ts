/**
 * Count leading `../` segments in an import path.
 * Returns 0 for non-relative imports (no leading `..`).
 */
export default function countImportDepth(path: string): number {
  const len = path.length;
  if (len < 2 || path.charCodeAt(0) !== 46 || path.charCodeAt(1) !== 46) {
    return 0;
  }
  // `.../` is not a relative path — skip triple+ dot
  if (len > 2 && path.charCodeAt(2) === 46) {
    return 0;
  }

  let depth = 0;
  let idx = 0;

  while (
    idx + 2 < len &&
    path.charCodeAt(idx) === 46 &&
    path.charCodeAt(idx + 1) === 46 &&
    path.charCodeAt(idx + 2) === 47
  ) {
    depth++;
    idx += 3;
  }

  // Trailing `..` at end-of-string
  if (idx + 2 === len && path.charCodeAt(idx) === 46 && path.charCodeAt(idx + 1) === 46) {
    depth++;
  }

  return depth;
}
