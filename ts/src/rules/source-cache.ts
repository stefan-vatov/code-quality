import { readFileSync, statSync } from 'node:fs';

type SourceContext = {
  filename?: string;
  sourceCode?: {
    getText?: () => string;
    text?: string;
  };
};

const SOURCE_CACHE_MAX = 512;
type CachedFileSource = {
  mtimeMs: number;
  size: number;
  source: string;
};

const fileSourceCache = new Map<string, CachedFileSource>();
const sourceCodeTextCache = new WeakMap<NonNullable<SourceContext['sourceCode']>, string>();

function cacheFileSource(filename: string, cachedFileSource: CachedFileSource): string {
  if (fileSourceCache.size >= SOURCE_CACHE_MAX) {
    const firstKey = fileSourceCache.keys().next().value;
    if (firstKey !== undefined) {
      fileSourceCache.delete(firstKey);
    }
  }
  fileSourceCache.set(filename, cachedFileSource);
  return cachedFileSource.source;
}

function readCachedSource(context: SourceContext): string {
  if (context.sourceCode?.text !== undefined) {
    return context.sourceCode.text;
  }
  if (context.sourceCode?.getText) {
    const cachedSource = sourceCodeTextCache.get(context.sourceCode);
    if (cachedSource !== undefined) {
      return cachedSource;
    }
    const source = context.sourceCode.getText();
    sourceCodeTextCache.set(context.sourceCode, source);
    return source;
  }
  if (!context.filename) {
    return '';
  }

  try {
    const stats = statSync(context.filename);
    const cachedSource = fileSourceCache.get(context.filename);
    if (
      cachedSource !== undefined &&
      cachedSource.size === stats.size &&
      cachedSource.mtimeMs === stats.mtimeMs
    ) {
      return cachedSource.source;
    }
    return cacheFileSource(context.filename, {
      mtimeMs: stats.mtimeMs,
      size: stats.size,
      source: readFileSync(context.filename, 'utf-8'),
    });
  } catch {
    return '';
  }
}

export { readCachedSource };
export type { SourceContext };
