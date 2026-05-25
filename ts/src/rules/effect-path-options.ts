/* -------------------------------------------------------------------------- */
/*          Path option schema helpers for strict Effect lint rules.          */
/* -------------------------------------------------------------------------- */
import type { Context } from './effect-rule-core';

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export type StrictPathOptionKey =
  | 'adapterLayers'
  | 'compositionRoots'
  | 'configLayers'
  | 'domain'
  | 'entrypoints'
  | 'integrationTests'
  | 'unitTests';

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export type StrictPathOptions = Partial<Record<StrictPathOptionKey, readonly string[]>>;

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const strictPathOptionKeys = [
  'adapterLayers',
  'compositionRoots',
  'configLayers',
  'domain',
  'entrypoints',
  'integrationTests',
  'unitTests',
] as const satisfies readonly StrictPathOptionKey[];

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const strictPathOptionsSchema = [
  {
    additionalProperties: false,
    properties: {
      adapterLayers: { items: { type: 'string' }, type: 'array' },
      compositionRoots: { items: { type: 'string' }, type: 'array' },
      configLayers: { items: { type: 'string' }, type: 'array' },
      domain: { items: { type: 'string' }, type: 'array' },
      entrypoints: { items: { type: 'string' }, type: 'array' },
      integrationTests: { items: { type: 'string' }, type: 'array' },
      unitTests: { items: { type: 'string' }, type: 'array' },
    },
    type: 'object',
  },
] as const;

const defaultPathOptions = {
  adapterLayers: ['src/adapters/**', 'src/platform/**', 'src/infrastructure/**'],
  compositionRoots: ['src/main.ts', 'src/server.ts', 'src/cli.ts', '**/*.entry.ts'],
  configLayers: ['src/config/**', 'src/layers/**', 'src/infrastructure/**'],
  domain: ['src/domain/**', 'src/core/**', 'src/features/**'],
  entrypoints: ['src/main.ts', 'src/server.ts', 'src/cli.ts', '**/*.entry.ts'],
  integrationTests: ['**/*.integration.test.ts', '**/*.integration.spec.ts'],
  unitTests: ['**/*.test.ts', '**/*.spec.ts', '**/*.test.tsx', '**/*.spec.tsx'],
} satisfies Readonly<Record<StrictPathOptionKey, readonly string[]>>;

const testFilePattern = /\.(?:test|spec)\.tsx?$/;

const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);

const globCache = new Map<string, RegExp>();

const globToken = (pattern: string, index: number): { index: number; text: string } => {
  const char = pattern[index];
  const nextChar = pattern[index + 1];
  const afterNextChar = pattern[index + 2];

  if (char === '*' && nextChar === '*' && afterNextChar === '/') {
    return { index: index + 2, text: '(?:.*/)?' };
  }
  if (char === '*' && nextChar === '*') {
    return { index: index + 1, text: '.*' };
  }
  if (char === '*') {
    return { index, text: '[^/]*' };
  }
  return { index, text: escapeRegExp(char ?? '') };
};

const globBody = (normalizedPattern: string): string => {
  let body = '';
  for (let index = 0; index < normalizedPattern.length; index++) {
    const token = globToken(normalizedPattern, index);
    const { index: nextIndex, text } = token;
    body += text;
    index = nextIndex;
  }
  return body;
};

const globPrefix = (normalizedPattern: string): string => {
  if (normalizedPattern.startsWith('/')) {
    return '^';
  }
  return '(?:^|/)';
};

const globToRegExp = (pattern: string): RegExp => {
  const cached = globCache.get(pattern);
  if (cached) {
    return cached;
  }

  const normalizedPattern = pattern.replace(/\\/g, '/').replace(/^\.\//, '');
  const matcher = new RegExp(`${globPrefix(normalizedPattern)}${globBody(normalizedPattern)}$`);
  globCache.set(pattern, matcher);
  return matcher;
};

const matchesPath = (filename: string | undefined, pattern: string): boolean => {
  if (!filename) {
    return false;
  }
  return globToRegExp(pattern).test(filename.replace(/\\/g, '/'));
};

const getStrictOptions = (context: Pick<Context, 'options'>): StrictPathOptions => {
  const options = context.options?.[0];
  if (!options || typeof options !== 'object') {
    return {};
  }
  return options as StrictPathOptions;
};

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const sanitizeStrictPathOptions = (
  options: StrictPathOptions | undefined,
): StrictPathOptions | undefined => {
  if (!options) {
    return undefined;
  }

  const sanitized: StrictPathOptions = {};
  for (const optionKey of strictPathOptionKeys) {
    if (Object.hasOwn(options, optionKey)) {
      sanitized[optionKey] = options[optionKey];
    }
  }

  if (Object.keys(sanitized).length === 0) {
    return undefined;
  }
  return sanitized;
};

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const isConfiguredPath = (
  context: Pick<Context, 'filename' | 'options'>,
  key: StrictPathOptionKey,
): boolean => {
  const configuredPatterns = getStrictOptions(context)[key];
  const patterns = configuredPatterns ?? defaultPathOptions[key];

  return patterns.some((pattern) => matchesPath(context.filename, pattern));
};

const isTestFile = (filename: string | undefined): boolean =>
  Boolean(filename && testFilePattern.test(filename));

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const isUnitTestPath = (context: Pick<Context, 'filename' | 'options'>): boolean =>
  (isTestFile(context.filename) || isConfiguredPath(context, 'unitTests')) &&
  !isConfiguredPath(context, 'integrationTests');

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const isEffectTestPath = (context: Pick<Context, 'filename' | 'options'>): boolean =>
  isTestFile(context.filename) ||
  isConfiguredPath(context, 'unitTests') ||
  isConfiguredPath(context, 'integrationTests');
