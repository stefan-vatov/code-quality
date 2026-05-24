/* -------------------------------------------------------------------------- */
/*              Source text cache shared by custom Oxlint rules.              */
/* -------------------------------------------------------------------------- */
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

const readSourceCodeText = (sourceCode: NonNullable<SourceContext['sourceCode']>): string => {
  if (sourceCode.text !== undefined) {
    return sourceCode.text;
  }

  const cachedSource = sourceCodeTextCache.get(sourceCode);
  if (cachedSource !== undefined) {
    return cachedSource;
  }
  const source = sourceCode.getText?.() ?? '';
  sourceCodeTextCache.set(sourceCode, source);
  return source;
};

const readFileSource = (filename: string): string => {
  try {
    const stats = statSync(filename);
    const cachedSource = fileSourceCache.get(filename);
    if (
      cachedSource !== undefined &&
      cachedSource.size === stats.size &&
      cachedSource.mtimeMs === stats.mtimeMs
    ) {
      return cachedSource.source;
    }
    return cacheFileSource(filename, {
      mtimeMs: stats.mtimeMs,
      size: stats.size,
      source: readFileSync(filename, 'utf8'),
    });
  } catch {
    return '';
  }
};

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const readCachedSource = (context: SourceContext): string => {
  if (context.sourceCode) {
    return readSourceCodeText(context.sourceCode);
  }
  if (!context.filename) {
    return '';
  }
  return readFileSource(context.filename);
};
