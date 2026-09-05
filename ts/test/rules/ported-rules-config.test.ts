import { isAbsolute, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import theThracianOxlint from '../../src/index';
import { Predicate } from 'effect';

type PluginEntry = NonNullable<ReturnType<typeof theThracianOxlint>['jsPlugins']>[number];

const pluginSpecifier = (entry: PluginEntry): string =>
  Predicate.isString(entry) ? entry : entry.specifier;

const genericRuleNames = [
  'no-chained-type-assertions',
  'no-conditional-empty-object-spread',
  'no-known-value-widening',
  'no-module-mocking',
  'no-object-parameters',
  'no-reflect-apply',
  'no-reflect-get',
  'no-runtime-typeof',
  'no-shape-in-symbol-names',
  'no-unknown-parameters',
  'no-unknown-returns',
  'no-unknown-type-aliases',
  'no-unsafe-dictionary-type',
  'no-widen-then-assert',
  'no-comments',
] as const;

describe('ported rule integration', (): void => {
  it('enables every upstream generic rule as an error', (): void => {
    const config = theThracianOxlint();

    for (const ruleName of genericRuleNames) {
      const setting = config.rules?.[`thethracian/${ruleName}`];
      expect(Array.isArray(setting) ? setting[0] : setting).toBe('error');
    }
    expect(config.rules).toHaveProperty('thethracian/no-runtime-typeof', [
      'error',
      { allowInTypeGuards: true },
    ]);

    const pluginPath = config.jsPlugins
      ?.map(pluginSpecifier)
      .find((path) => path.endsWith(join('rules', 'plugin.js')));
    expect(pluginPath).toBeDefined();
    expect(isAbsolute(pluginPath ?? '')).toBe(true);
  });

  it('adds the upstream Effect rule only when Effect linting is enabled', (): void => {
    const baseConfig = theThracianOxlint();
    const effectConfig = theThracianOxlint({ effect: true });

    expect(baseConfig.rules).not.toHaveProperty('thethracian/no-service-constructor-imports');
    expect(effectConfig.rules).toHaveProperty(
      'thethracian/no-service-constructor-imports',
      'error',
    );
    expect(
      effectConfig.jsPlugins
        ?.map(pluginSpecifier)
        .some((path) => path.endsWith(join('rules', 'plugin.js'))),
    ).toBe(true);
  });
});
