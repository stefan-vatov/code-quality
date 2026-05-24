import type { Context } from './effect-rule-core.js';

type StrictPathOptionKey =
  | 'adapterLayers'
  | 'compositionRoots'
  | 'configLayers'
  | 'domain'
  | 'entrypoints'
  | 'integrationTests'
  | 'unitTests';

type StrictPathOptions = Partial<Record<StrictPathOptionKey, readonly string[]>>;

const strictPathOptionKeys = [
  'adapterLayers',
  'compositionRoots',
  'configLayers',
  'domain',
  'entrypoints',
  'integrationTests',
  'unitTests',
] as const satisfies readonly StrictPathOptionKey[];

const strictPathOptionsSchema = [
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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const globCache = new Map<string, RegExp>();

function globToRegExp(pattern: string): RegExp {
  const cached = globCache.get(pattern);
  if (cached) {
    return cached;
  }

  const normalizedPattern = pattern.replace(/\\/g, '/').replace(/^\.\//, '');
  let body = '';
  for (let index = 0; index < normalizedPattern.length; index++) {
    const char = normalizedPattern[index];
    const nextChar = normalizedPattern[index + 1];
    const afterNextChar = normalizedPattern[index + 2];

    if (char === '*' && nextChar === '*' && afterNextChar === '/') {
      body += '(?:.*/)?';
      index += 2;
      continue;
    }
    if (char === '*' && nextChar === '*') {
      body += '.*';
      index++;
      continue;
    }
    if (char === '*') {
      body += '[^/]*';
      continue;
    }

    body += escapeRegExp(char);
  }
  const prefix = normalizedPattern.startsWith('/') ? '^' : '(?:^|/)';
  const matcher = new RegExp(`${prefix}${body}$`);
  globCache.set(pattern, matcher);
  return matcher;
}

function matchesPath(filename: string | undefined, pattern: string): boolean {
  if (!filename) {
    return false;
  }
  return globToRegExp(pattern).test(filename.replace(/\\/g, '/'));
}

function getStrictOptions(context: Pick<Context, 'options'>): StrictPathOptions {
  const options = context.options?.[0];
  if (!options || typeof options !== 'object') {
    return {};
  }
  return options as StrictPathOptions;
}

function sanitizeStrictPathOptions(
  options: StrictPathOptions | undefined,
): StrictPathOptions | undefined {
  if (!options) {
    return undefined;
  }

  const sanitized: StrictPathOptions = {};
  for (const optionKey of strictPathOptionKeys) {
    if (Object.hasOwn(options, optionKey)) {
      sanitized[optionKey] = options[optionKey];
    }
  }

  return Object.keys(sanitized).length === 0 ? undefined : sanitized;
}

function isConfiguredPath(
  context: Pick<Context, 'filename' | 'options'>,
  key: StrictPathOptionKey,
): boolean {
  const configuredPatterns = getStrictOptions(context)[key];
  const patterns = configuredPatterns ?? defaultPathOptions[key];

  return patterns.some((pattern) => matchesPath(context.filename, pattern));
}

function isTestFile(filename: string | undefined): boolean {
  return Boolean(filename && testFilePattern.test(filename));
}

function isUnitTestPath(context: Pick<Context, 'filename' | 'options'>): boolean {
  return (
    (isTestFile(context.filename) || isConfiguredPath(context, 'unitTests')) &&
    !isConfiguredPath(context, 'integrationTests')
  );
}

function isEffectTestPath(context: Pick<Context, 'filename' | 'options'>): boolean {
  return (
    isTestFile(context.filename) ||
    isConfiguredPath(context, 'unitTests') ||
    isConfiguredPath(context, 'integrationTests')
  );
}

export {
  isConfiguredPath,
  isEffectTestPath,
  isUnitTestPath,
  sanitizeStrictPathOptions,
  strictPathOptionKeys,
  strictPathOptionsSchema,
};

export type { StrictPathOptionKey, StrictPathOptions };
