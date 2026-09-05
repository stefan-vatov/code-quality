/* -------------------------------------------------------------------------- */
/*              Source scanning utilities for Effect lint rules.              */
/* -------------------------------------------------------------------------- */
import { createWeightedCache } from './source-cache';
import { isLineTerminatorCode } from './effect-source-line-terminators';
import { scanSource } from './effect-source-jsx-scanner';
import { sourceNavigationIndex } from './effect-source-navigation-index';

export { findREGEXLiteralEnd, isREGEXLiteralStart } from './effect-source-regex-scan';

const CACHE_MAX_ENTRIES = 32;
const BYTES_PER_MEBIBYTE = 1_048_576;
const CACHE_MAX_MEBIBYTES = 14;
const CACHE_MAX_WEIGHT = CACHE_MAX_MEBIBYTES * BYTES_PER_MEBIBYTE;
const UTF16_CODE_UNIT_BYTES = 2;
const CACHE_ENTRY_BYTES = 128;
type SourceProjectionCache = ReturnType<typeof createWeightedCache<string, string>>;
const codeOnlyCache: SourceProjectionCache = createWeightedCache({
  maxEntries: CACHE_MAX_ENTRIES,
  maxWeight: CACHE_MAX_WEIGHT,
});

const sourceProjectionWeight = (source: string, projected: string): number =>
  source.length * UTF16_CODE_UNIT_BYTES +
  projected.length * UTF16_CODE_UNIT_BYTES +
  CACHE_ENTRY_BYTES * 2;

type BlankCharacter = (index: number) => void;

const blankRange = (
  source: string,
  startIndex: number,
  endIndex: number,
  blankCharacter: BlankCharacter,
): void => {
  for (let index = startIndex; index < endIndex; index += 1) {
    if (!isLineTerminatorCode(source.charCodeAt(index))) {
      blankCharacter(index);
    }
  }
};

const stripSource = (source: string): string => {
  const output = source.split('');
  const blankCharacter = (index: number): void => {
    output[index] = ' ';
  };
  scanSource(source, {
    onComment: (startIndex, endIndex): void =>
      blankRange(source, startIndex, endIndex, blankCharacter),
    onLiteralContent: (startIndex, endIndex): void =>
      blankRange(source, startIndex, endIndex, blankCharacter),
    onREGEX: (startIndex, endIndex): void =>
      blankRange(source, startIndex, endIndex, blankCharacter),
    onRawJSXText: (startIndex, endIndex): void =>
      blankRange(source, startIndex, endIndex, blankCharacter),
    onTemplateDelimiter: (startIndex, endIndex): void =>
      blankRange(source, startIndex, endIndex, blankCharacter),
  });
  return output.join('');
};

const cacheResult = (source: string, value: string): string =>
  codeOnlyCache.set(source, value, sourceProjectionWeight(source, value));

/**
 * Return the matching call parenthesis, or the final source index for an unmatched call.
 *
 * @param source - Complete source text.
 * @param openParenIndex - Offset of the opening parenthesis.
 * @returns The matching closing offset or the final source offset.
 * @throws Does not throw.
 * @internal
 */
export const findBalancedCallEnd = (source: string, openParenIndex: number): number =>
  sourceNavigationIndex(source).matchingCall(openParenIndex);

/**
 * Blank comments, strings, template text, JSX literals, and regular expressions without changing
 * source offsets.
 *
 * @param source - Complete source text.
 * @returns A coordinate-preserving code-only projection.
 * @throws Does not throw.
 * @internal
 */
export const stripCommentsAndStrings = (source: string): string => {
  const cached = codeOnlyCache.get(source);
  return cached ?? cacheResult(source, stripSource(source));
};

/**
 * Return the matching brace from the shared lexical boundary index.
 *
 * @param source - Complete source text.
 * @param openIndex - Offset of the opening brace.
 * @returns The matching closing offset, or `-1` when unmatched.
 * @throws Does not throw.
 * @internal
 */
export const findMatchingBrace = (source: string, openIndex: number): number =>
  sourceNavigationIndex(source).matchingBrace(openIndex);
