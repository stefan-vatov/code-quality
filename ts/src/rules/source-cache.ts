/* -------------------------------------------------------------------------- */
/*              Source text cache shared by custom Oxlint rules.              */
/* -------------------------------------------------------------------------- */
import { Either, Match, Option, pipe } from 'effect';
import { readFileSync, statSync } from 'node:fs';

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export interface SourceContext {
  filename?: string;
  sourceCode?: {
    getText?: () => string;
    text?: string;
  };
}

const SOURCE_CACHE_MAX = 512;
interface CachedFileSource {
  mtimeMs: number;
  size: number;
  source: string;
}

const fileSourceCache = new Map<string, CachedFileSource>();
const sourceCodeTextCache = new WeakMap<NonNullable<SourceContext['sourceCode']>, string>();

const cacheFileSource = (filename: string, cachedFileSource: CachedFileSource): string => {
  if (fileSourceCache.size >= SOURCE_CACHE_MAX) {
    const firstKey = fileSourceCache.keys().next().value;
    if (firstKey !== undefined) {
      fileSourceCache.delete(firstKey);
    }
  }
  fileSourceCache.set(filename, cachedFileSource);
  return cachedFileSource.source;
};

const uncachedSourceCodeText = (sourceCode: NonNullable<SourceContext['sourceCode']>): string => {
  const source = pipe(
    Option.fromNullable(sourceCode.getText),
    Option.match({
      onNone: (): string => '',
      onSome: (getText) => getText(),
    }),
  );
  sourceCodeTextCache.set(sourceCode, source);
  return source;
};

const readSourceCodeText = (sourceCode: NonNullable<SourceContext['sourceCode']>): string =>
  pipe(
    Option.fromNullable(sourceCode.text),
    Option.match({
      onNone: () =>
        pipe(
          Option.fromNullable(sourceCodeTextCache.get(sourceCode)),
          Option.match({
            onNone: () => uncachedSourceCodeText(sourceCode),
            onSome: (cachedSource) => cachedSource,
          }),
        ),
      onSome: (source) => source,
    }),
  );

const isFreshCachedSource = (
  cachedSource: CachedFileSource,
  stats: { mtimeMs: number; size: number },
): boolean => cachedSource.size === stats.size && cachedSource.mtimeMs === stats.mtimeMs;

const readFreshFileSource = (filename: string): string => {
  const stats = statSync(filename);
  return pipe(
    Option.fromNullable(fileSourceCache.get(filename)),
    Option.filter((cachedSource): boolean => isFreshCachedSource(cachedSource, stats)),
    Option.match({
      onNone: () =>
        cacheFileSource(filename, {
          mtimeMs: stats.mtimeMs,
          size: stats.size,
          source: readFileSync(filename, 'utf8'),
        }),
      onSome: (cachedSource) => cachedSource.source,
    }),
  );
};

const readFileSource = (filename: string): string =>
  pipe(
    Either.try(() => readFreshFileSource(filename)),
    Either.getOrElse((): string => ''),
  );

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const readCachedSource = (context: SourceContext): string =>
  Match.value(context).pipe(
    Match.when({ sourceCode: Match.defined }, ({ sourceCode }) => readSourceCodeText(sourceCode)),
    Match.when({ filename: Match.defined }, ({ filename }) => readFileSource(filename)),
    Match.orElse((): string => ''),
  );
