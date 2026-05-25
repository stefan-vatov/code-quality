/* -------------------------------------------------------------------------- */
/*          Path option schema helpers for strict Effect lint rules.          */
/* -------------------------------------------------------------------------- */
import { Array, Match, Option, pipe } from 'effect';
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

  return Match.value(char).pipe(
    Match.when(
      (character): boolean => character === '*' && nextChar === '*' && afterNextChar === '/',
      (): { index: number; text: string } => ({ index: index + 2, text: '(?:.*/)?' }),
    ),
    Match.when(
      (character): boolean => character === '*' && nextChar === '*',
      (): { index: number; text: string } => ({ index: index + 1, text: '.*' }),
    ),
    Match.when(
      (character): boolean => character === '*',
      (): { index: number; text: string } => ({ index, text: '[^/]*' }),
    ),
    Match.orElse((character): { index: number; text: string } => ({
      index,
      text: escapeRegExp(character ?? ''),
    })),
  );
};

const globBody = (normalizedPattern: string): string => {
  const appendToken = (index: number, body: string): string =>
    Match.value(index).pipe(
      Match.when(
        (currentIndex): boolean => currentIndex >= normalizedPattern.length,
        (): string => body,
      ),
      Match.orElse((currentIndex): string => {
        const token = globToken(normalizedPattern, currentIndex);
        return appendToken(token.index + 1, body + token.text);
      }),
    );
  return appendToken(0, '');
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
        globCache.set(pattern, matcher);
        return matcher;
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
  Array.isArray(value) &&
  pipe(
    value,
    Array.every((entry): boolean => typeof entry === 'string'),
  );

const strictOptionsFromUnknown = (options: object): StrictPathOptions =>
  pipe(
    strictPathOptionKeys,
    Array.reduce({} as StrictPathOptions, (current, optionKey): StrictPathOptions => {
      const optionValue: unknown = Reflect.get(options, optionKey);
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
    Option.filter((value): value is object => typeof value === 'object'),
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
          {} as StrictPathOptions,
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

const isTestFile = (filename: string | undefined): boolean =>
  pipe(
    Option.fromNullable(filename),
    Option.exists((value): boolean => testFilePattern.test(value)),
  );

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
