/* -------------------------------------------------------------------------- */
/*      Compact canonical-to-original source mapping for Effect aliases.      */
/* -------------------------------------------------------------------------- */
const INDEX_MAP_STRIDE = 5;
const ORIGINAL_START_OFFSET = 1;
const CANONICAL_LENGTH_OFFSET = 2;
const ORIGINAL_LENGTH_OFFSET = 3;
const SHIFT_OFFSET = 4;

/**
 * Holds canonical source text and its compact original-position map.
 *
 * @internal
 */
export interface CanonicalizedEffectSource {
  readonly indexMap: readonly number[];
  readonly source: string;
}

const replaceCanonicalAlias = (
  aliases: ReadonlyMap<string, string>,
  indexMap: number[],
  prefix: string,
  localName: string,
  originalOffset: number,
): string => {
  const canonicalName = aliases.get(localName) ?? localName;
  const previousShift = indexMap.at(-1) ?? 0;
  const originalStart = originalOffset + prefix.length;
  const canonicalStart = originalStart + previousShift;
  const nextShift = previousShift + canonicalName.length - localName.length;
  indexMap.push(canonicalStart, originalStart, canonicalName.length, localName.length, nextShift);
  return `${prefix}${canonicalName}`;
};

/**
 * Canonicalizes identifiers with a compact source-position map.
 *
 * @param source - Original TypeScript source.
 * @param aliases - Local-to-canonical identifier bindings.
 * @param aliasPattern - Pattern capturing the prefix and local identifier.
 * @returns Canonical source and its flat positional map.
 */
export const buildCanonicalizedEffectSource = (
  source: string,
  aliases: ReadonlyMap<string, string>,
  aliasPattern: RegExp,
): CanonicalizedEffectSource => {
  const indexMap: number[] = [];
  const canonicalSource = source.replace(
    aliasPattern,
    (_match: string, prefix: string, localName: string, offset: number): string =>
      replaceCanonicalAlias(aliases, indexMap, prefix, localName, offset),
  );
  return { indexMap, source: canonicalSource };
};

const mappedAliasIndex = (
  indexMap: readonly number[],
  mapIndex: number,
  canonicalIndex: number,
): number => {
  const canonicalStart = indexMap[mapIndex];
  const originalStart = indexMap[mapIndex + ORIGINAL_START_OFFSET];
  const originalLength = indexMap[mapIndex + ORIGINAL_LENGTH_OFFSET];
  const offset = Math.min(canonicalIndex - canonicalStart, Math.max(0, originalLength - 1));
  return originalStart + offset;
};

/**
 * Maps a canonical source offset back to the original source.
 *
 * @param canonicalized - Canonical source and compact positional map.
 * @param canonicalIndex - Offset measured in canonical source text.
 * @returns Corresponding offset in original source text.
 */
export const canonicalIndexToOriginal = (
  canonicalized: CanonicalizedEffectSource,
  canonicalIndex: number,
): number => {
  let shift = 0;
  for (let mapIndex = 0; mapIndex < canonicalized.indexMap.length; mapIndex += INDEX_MAP_STRIDE) {
    const canonicalStart = canonicalized.indexMap[mapIndex];
    const canonicalLength = canonicalized.indexMap[mapIndex + CANONICAL_LENGTH_OFFSET];
    if (canonicalIndex < canonicalStart) {
      break;
    }
    if (canonicalIndex < canonicalStart + canonicalLength) {
      return mappedAliasIndex(canonicalized.indexMap, mapIndex, canonicalIndex);
    }
    shift = canonicalized.indexMap[mapIndex + SHIFT_OFFSET];
  }
  return canonicalIndex - shift;
};
