import { isAbsolute } from 'node:path';
import { describe, expect, it } from 'vitest';
import theThracianOxlint from '../src/index.js';
import { effectDefaultRuleNames, effectStrictRuleNames } from '../src/rules/effect-rule-names.js';
import type { TheThracianEffectStrictOptions } from '../src/index.js';

function effectRuleKeys(config: ReturnType<typeof theThracianOxlint>): string[] {
  return Object.keys(config.rules ?? {}).filter((ruleName) =>
    ruleName.startsWith('thethracian/effect-'),
  );
}

describe('theThracianOxlint', () => {
  it('uses an absolute path for its package-local Oxlint plugin', () => {
    const config = theThracianOxlint();
    const pluginPath = config.jsPlugins?.find((path) => path.endsWith('/rules/plugin.js'));

    expect(pluginPath).toBeDefined();
    expect(isAbsolute(pluginPath ?? '')).toBe(true);
  });

  it('uses the package custom rule for maximum line length', () => {
    const config = theThracianOxlint();

    expect(config.rules).not.toHaveProperty('max-len');
    expect(config.rules).toHaveProperty('thethracian/max-line-length', 'error');
  });

  it('uses Oxlint native complexity instead of a JavaScript plugin rule', () => {
    const config = theThracianOxlint();

    expect(config.jsPlugins).not.toContain('oxlint-plugin-complexity');
    expect(config.rules).not.toHaveProperty('complexity/complexity');
    expect(config.rules).not.toHaveProperty('thethracian/complexity');
    expect(config.rules).toHaveProperty('complexity', ['error', { max: 10 }]);
  });

  it('enables the default Effect bucket by default', () => {
    const config = theThracianOxlint();

    expect(config.rules).toHaveProperty('thethracian/effect-no-floating-effect', 'error');
    expect(config.rules).toHaveProperty('thethracian/effect-prefer-effect-is', 'error');
    expect(config.rules).not.toHaveProperty('thethracian/effect-no-run-outside-entrypoints');
    expect(effectRuleKeys(config).sort()).toStrictEqual(
      effectDefaultRuleNames.map((ruleName) => `thethracian/${ruleName}`).sort(),
    );
  });

  it('can disable Effect rules for non-Effect consumers', () => {
    const config = theThracianOxlint({ effect: false });

    expect(config.rules).not.toHaveProperty('thethracian/effect-no-floating-effect');
    expect(config.rules).not.toHaveProperty('thethracian/effect-no-run-outside-entrypoints');
    expect(effectRuleKeys(config)).toHaveLength(0);
  });

  it('enables opt-in Effect strict project rules as errors when requested', () => {
    const config = theThracianOxlint({
      effect: {
        strict: true,
      },
    });

    expect(config.rules).toHaveProperty('thethracian/effect-no-floating-effect', 'error');
    expect(config.rules).toHaveProperty('thethracian/effect-no-run-outside-entrypoints', 'error');
    expect(config.rules).toHaveProperty(
      'thethracian/effect-require-effect-suppression-reason-and-ticket',
      'error',
    );
    expect(effectRuleKeys(config).sort()).toStrictEqual(
      [...effectDefaultRuleNames, ...effectStrictRuleNames]
        .map((ruleName) => `thethracian/${ruleName}`)
        .sort(),
    );
  });

  it('enables opt-in Effect strict project rules with the object form', () => {
    const strictOptions = {
      adapterLayers: ['platform/adapters/**'],
      compositionRoots: ['apps/api/main.ts'],
      configLayers: ['settings/**'],
      domain: ['features/**'],
      entrypoints: ['workers/main.ts'],
      integrationTests: ['tests/integration/**/*.ts'],
      unitTests: ['tests/unit/**/*.ts'],
    };
    const config = theThracianOxlint({
      effect: {
        strict: strictOptions,
      },
    });

    expect(effectRuleKeys(config).sort()).toStrictEqual(
      [...effectDefaultRuleNames, ...effectStrictRuleNames]
        .map((ruleName) => `thethracian/${ruleName}`)
        .sort(),
    );
    for (const ruleName of effectStrictRuleNames) {
      expect(config.rules).toHaveProperty(`thethracian/${ruleName}`, ['error', strictOptions]);
    }
  });

  it('keeps strict object form explicitly disableable', () => {
    const config = theThracianOxlint({
      effect: {
        strict: {
          enabled: false,
          entrypoints: ['workers/main.ts'],
        },
      },
    });

    expect(config.rules).not.toHaveProperty('thethracian/effect-no-run-outside-entrypoints');
  });

  it('does not forward unsupported strict path keys that are absent from rule schemas', () => {
    const unsupportedStrictOptions = {
      enabled: true,
      loggerLayers: ['observability/**'],
    } satisfies TheThracianEffectStrictOptions & { loggerLayers: readonly string[] };
    const config = theThracianOxlint({ effect: { strict: unsupportedStrictOptions } });

    expect(config.rules).toHaveProperty('thethracian/effect-no-run-outside-entrypoints', 'error');
  });

  it('filters unsupported strict path keys when supported keys are present', () => {
    const mixedStrictOptions = {
      enabled: true,
      entrypoints: ['workers/main.ts'],
      loggerLayers: ['observability/**'],
    } satisfies TheThracianEffectStrictOptions & { loggerLayers: readonly string[] };
    const config = theThracianOxlint({ effect: { strict: mixedStrictOptions } });

    expect(config.rules).toHaveProperty('thethracian/effect-no-run-outside-entrypoints', [
      'error',
      { entrypoints: ['workers/main.ts'] },
    ]);
  });

  it('exports silent catch blocking as an error', () => {
    const config = theThracianOxlint();

    expect(config.rules).toHaveProperty('no-empty', ['error', { allowEmptyCatch: false }]);
  });

  it('turns on Oxlint type-aware execution when type-aware rules are requested', () => {
    const config = theThracianOxlint({ typeAware: true });

    expect(config.options).toStrictEqual({
      typeAware: true,
      typeCheck: true,
    });
    expect(config.rules).toHaveProperty('typescript/no-floating-promises', 'error');
    expect(config.rules).toHaveProperty('typescript/switch-exhaustiveness-check', 'error');
  });
});
