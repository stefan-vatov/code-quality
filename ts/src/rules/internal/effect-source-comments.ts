import { createWeightedCache } from './source-cache';
import { isLineTerminatorCode } from './effect-source-line-terminators';
import { scanSource } from './effect-source-jsx-scanner';

const CACHE_MAX_ENTRIES = 32;
const BYTES_PER_MEBIBYTE = 1_048_576;
const CACHE_MAX_MEBIBYTES = 14;
const CACHE_MAX_WEIGHT = CACHE_MAX_MEBIBYTES * BYTES_PER_MEBIBYTE;
const UTF16_CODE_UNIT_BYTES = 2;
const CACHE_ENTRY_BYTES = 128;
type SourceProjectionCache = ReturnType<typeof createWeightedCache<string, string>>;
const commentCache: SourceProjectionCache = createWeightedCache({
  maxEntries: CACHE_MAX_ENTRIES,
  maxWeight: CACHE_MAX_WEIGHT,
});

const sourceProjectionWeight = (source: string, projected: string): number =>
  source.length * UTF16_CODE_UNIT_BYTES +
  projected.length * UTF16_CODE_UNIT_BYTES +
  CACHE_ENTRY_BYTES * 2;

type BlankCharacter = (index: number) => void;

const blankComment = (
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

const cacheResult = (source: string, value: string): string =>
  commentCache.set(source, value, sourceProjectionWeight(source, value));

const stripSourceComments = (source: string): string => {
  const output = source.split('');
  const blankCharacter = (index: number): void => {
    output[index] = ' ';
  };
  scanSource(source, {
    onComment: (startIndex, endIndex): void =>
      blankComment(source, startIndex, endIndex, blankCharacter),
    onLiteralContent: (): void => undefined,
    onREGEX: (): void => undefined,
    onRawJSXText: (): void => undefined,
    onTemplateDelimiter: (): void => undefined,
  });
  return output.join('');
};

export const stripComments = (source: string): string => {
  const cached = commentCache.get(source);
  return cached ?? cacheResult(source, stripSourceComments(source));
};
