/* -------------------------------------------------------------------------- */
/*          Path option schema helpers for strict Effect lint rules.          */
/* -------------------------------------------------------------------------- */
import { Array, Match, Option, Predicate, pipe } from 'effect';
import type { Context } from './effect-rule-core';
import { isASTObject } from './effect-ast';
import type { ASTObject } from './effect-ast';
import { createWeightedCache } from './source-cache';

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

const GLOB_CACHE_MAX = 128;
const BYTES_PER_MEBIBYTE = 1_048_576;
const GLOB_CACHE_MAX_MEBIBYTES = 5;
const GLOB_CACHE_MAX_WEIGHT = GLOB_CACHE_MAX_MEBIBYTES * BYTES_PER_MEBIBYTE;
const UTF16_CODE_UNIT_BYTES = 2;
const CACHE_ENTRY_BYTES = 128;
const STRING_CONTAINER_BYTES = 128;
const REGEXP_BYTES = 128;

const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);

type GlobCache = ReturnType<typeof createWeightedCache<string, RegExp>>;

interface GlobToken {
  readonly index: number;
  readonly text: string;
}

const globCache: GlobCache = createWeightedCache({
  maxEntries: GLOB_CACHE_MAX,
  maxWeight: GLOB_CACHE_MAX_WEIGHT,
});

const bytesForUTF16 = (value: string): number => value.length * UTF16_CODE_UNIT_BYTES;

const globCacheWeight = (pattern: string, matcher: RegExp): number =>
  bytesForUTF16(pattern) +
  STRING_CONTAINER_BYTES +
  bytesForUTF16(matcher.source) +
  STRING_CONTAINER_BYTES +
  REGEXP_BYTES +
  CACHE_ENTRY_BYTES;

const globToken = (pattern: string, index: number): GlobToken => {
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
  const parts: string[] = [];
  let index = 0;
  while (index < normalizedPattern.length) {
    const token = globToken(normalizedPattern, index);
    parts.push(token.text);
    index = token.index + 1;
  }
  return parts.join('');
};

const globPrefix = (normalizedPattern: string): string =>
  Match.value(normalizedPattern.startsWith('/')).pipe(
    Match.when(true, (): string => '^'),
    Match.orElse((): string => '(?:^|/)'),
  );

const globToRegExp = (pattern: string): RegExp => {
  const cached = globCache.get(pattern);
  return pipe(
    Option.fromNullable(cached),
    Option.match({
      onNone: (): RegExp => {
        const normalizedPattern = pattern.replace(/\\/g, '/').replace(/^\.\//, '');
        const matcher = new RegExp(
          `${globPrefix(normalizedPattern)}${globBody(normalizedPattern)}$`,
        );
        return globCache.set(pattern, matcher, globCacheWeight(pattern, matcher));
      },
      onSome: (matcher): RegExp => matcher,
    }),
  );
};

const matchesPath = (filename: string | undefined, pattern: string): boolean =>
  pipe(
    Option.fromNullable(filename),
    Option.exists((value): boolean => globToRegExp(pattern).test(value.replace(/\\/g, '/'))),
  );

const isReadonlyStringArray = (value: unknown): value is readonly string[] =>
  Array.isArray(value) && pipe(value, Array.every(Predicate.isString));

const emptyStrictPathOptions: StrictPathOptions = {};

const strictOptionsFromUnknown = (options: ASTObject): StrictPathOptions =>
  pipe(
    strictPathOptionKeys,
    Array.reduce(emptyStrictPathOptions, (current, optionKey): StrictPathOptions => {
      const optionValue = options[optionKey];
      return pipe(
        Option.fromNullable(optionValue),
        Option.filter(isReadonlyStringArray),
        Option.match({
          onNone: (): StrictPathOptions => current,
          onSome: (optionArray): StrictPathOptions => {
            const next = { ...current };
            next[optionKey] = optionArray;
            return next;
          },
        }),
      );
    }),
  );

const getStrictOptions = (context: Pick<Context, 'options'>): StrictPathOptions => {
  const options = context.options?.[0];
  return pipe(
    Option.fromNullable(options),
    Option.filter(isASTObject),
    Option.map(strictOptionsFromUnknown),
    Option.getOrElse((): StrictPathOptions => ({})),
  );
};

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const sanitizeStrictPathOptions = (
  options: StrictPathOptions | undefined,
): StrictPathOptions | undefined =>
  pipe(
    Option.fromNullable(options),
    Option.flatMap((value) => {
      const sanitized = pipe(
        strictPathOptionKeys,
        Array.reduce(
          emptyStrictPathOptions,
          (current, optionKey): StrictPathOptions =>
            Match.value(Object.hasOwn(value, optionKey)).pipe(
              Match.when(
                (hasOption): boolean => hasOption,
                (): StrictPathOptions => {
                  const next = { ...current };
                  next[optionKey] = value[optionKey];
                  return next;
                },
              ),
              Match.orElse((): StrictPathOptions => current),
            ),
        ),
      );
      return Match.value(Object.keys(sanitized).length).pipe(
        Match.when(
          (length): boolean => length === 0,
          () => Option.none(),
        ),
        Match.orElse(() => Option.some(sanitized)),
      );
    }),
    Option.getOrUndefined,
  );

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

  return pipe(
    patterns,
    Array.some((pattern): boolean => matchesPath(context.filename, pattern)),
  );
};

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const isUnitTestPath = (context: Pick<Context, 'filename' | 'options'>): boolean =>
  isConfiguredPath(context, 'unitTests') && !isConfiguredPath(context, 'integrationTests');

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const isEffectTestPath = (context: Pick<Context, 'filename' | 'options'>): boolean =>
  isConfiguredPath(context, 'unitTests') || isConfiguredPath(context, 'integrationTests');
