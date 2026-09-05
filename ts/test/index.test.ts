import { isAbsolute } from 'node:path';
import { Predicate } from 'effect';
import { describe, expect, it } from 'vitest';
import theThracianOxlint from '../src/index';
import { effectSafetyRuleNames, effectStrictRuleNames } from '../src/rules/effect-rule-names';
import type { TheThracianEffectStrictOptions } from '../src/index';

function effectRuleKeys(config: ReturnType<typeof theThracianOxlint>): string[] {
  return Object.keys(config.rules ?? {}).filter((ruleName) =>
    ruleName.startsWith('thethracian/effect-'),
  );
}

describe('theThracianOxlint', () => {
  it('uses an absolute path for its package-local Oxlint plugin', () => {
    const config = theThracianOxlint();
    const pluginPath = config.jsPlugins
      ?.filter(Predicate.isString)
      .find((path) => path.endsWith('/rules/plugin.js'));

    expect(pluginPath).toBeDefined();
    expect(isAbsolute(pluginPath ?? '')).toBe(true);
  });

  it('delegates line length to the formatter instead of a blocking lint rule', () => {
    const config = theThracianOxlint();

    expect(config.rules).not.toHaveProperty('max-len');
    expect(config.rules).not.toHaveProperty('thethracian/max-line-length');
  });

  it('uses Oxlint native complexity instead of a JavaScript plugin rule', () => {
    const config = theThracianOxlint();

    expect(config.jsPlugins).not.toContain('oxlint-plugin-complexity');
    expect(config.rules).not.toHaveProperty('complexity/complexity');
    expect(config.rules).not.toHaveProperty('thethracian/complexity');
    expect(config.rules).toHaveProperty('complexity', ['error', { max: 20 }]);
  });

  it('does not enable Effect rules unless explicitly requested', () => {
    const config = theThracianOxlint();

    expect(effectRuleKeys(config)).toHaveLength(0);
  });

  it('enables only the high-confidence Effect safety bucket when requested', () => {
    const config = theThracianOxlint({ effect: true });

    expect(config.rules).toHaveProperty('thethracian/effect-no-floating-effect', 'error');
    expect(config.rules).not.toHaveProperty('thethracian/effect-no-known-fake-api');
    expect(config.rules).not.toHaveProperty('thethracian/effect-no-run-outside-entrypoints');
    expect(effectRuleKeys(config).sort()).toStrictEqual(
      effectSafetyRuleNames.map((ruleName) => `thethracian/${ruleName}`).sort(),
    );
  });

  it('can disable Effect rules for non-Effect consumers', () => {
    const config = theThracianOxlint({ effect: false });

    expect(config.rules).not.toHaveProperty('thethracian/effect-no-floating-effect');
    expect(config.rules).not.toHaveProperty('thethracian/effect-no-run-outside-entrypoints');
    expect(effectRuleKeys(config)).toHaveLength(0);
  });

  it('enables only individually selected path-independent strict Effect rules', () => {
    const config = theThracianOxlint({
      effect: {
        strict: { rules: ['effect-require-effect-suppression-reason-and-ticket'] },
      },
    });

    expect(config.rules).toHaveProperty('thethracian/effect-no-floating-effect', 'error');
    expect(config.rules).toHaveProperty(
      'thethracian/effect-require-effect-suppression-reason-and-ticket',
      'error',
    );
    expect(config.rules).not.toHaveProperty('thethracian/effect-no-run-outside-entrypoints');
  });
});

describe('strict Effect configuration', () => {
  it('enables opt-in Effect strict project rules with the object form', () => {
    const strictOptions = {
      adapterLayers: ['platform/adapters/**'],
      compositionRoots: ['apps/api/main.ts'],
      configLayers: ['settings/**'],
      domain: ['features/**'],
      entrypoints: ['workers/main.ts'],
      integrationTests: ['tests/integration/**/*.ts'],
      unitTests: ['tests/unit/**/*.ts'],
      rules: effectStrictRuleNames,
    };
    const config = theThracianOxlint({
      effect: {
        strict: strictOptions,
      },
    });

    expect(effectRuleKeys(config).sort()).toStrictEqual(
      [...effectSafetyRuleNames, ...effectStrictRuleNames]
        .map((ruleName) => `thethracian/${ruleName}`)
        .sort(),
    );
    for (const ruleName of effectStrictRuleNames) {
      const setting = config.rules?.[`thethracian/${ruleName}`];
      expect(Array.isArray(setting) ? setting[0] : setting).toBe('error');
    }
    expect(config.rules).toHaveProperty('thethracian/effect-no-run-outside-entrypoints', [
      'error',
      {
        entrypoints: ['workers/main.ts'],
        integrationTests: ['tests/integration/**/*.ts'],
        unitTests: ['tests/unit/**/*.ts'],
      },
    ]);
    expect(config.rules).toHaveProperty('thethracian/effect-no-global-fetch', [
      'error',
      { adapterLayers: ['platform/adapters/**'] },
    ]);
    expect(config.rules).toHaveProperty('thethracian/effect-no-crypto-randomUUID', 'error');
  });

  it('keeps the entire Effect profile explicitly disableable', () => {
    const config = theThracianOxlint({
      effect: {
        enabled: false,
        strict: { entrypoints: ['workers/main.ts'], rules: effectStrictRuleNames },
      },
    });

    expect(config.rules).not.toHaveProperty('thethracian/effect-no-run-outside-entrypoints');
  });

  it('does not forward unsupported strict path keys that are absent from rule schemas', () => {
    const unsupportedStrictOptions = {
      enabled: true,
      loggerLayers: ['observability/**'],
      rules: ['effect-no-crypto-randomUUID'],
    } satisfies TheThracianEffectStrictOptions & { loggerLayers: readonly string[] };
    const config = theThracianOxlint({ effect: { strict: unsupportedStrictOptions } });

    expect(config.rules).toHaveProperty('thethracian/effect-no-crypto-randomUUID', 'error');
  });

  it('filters unsupported strict path keys when supported keys are present', () => {
    const mixedStrictOptions = {
      adapterLayers: ['platform/**'],
      enabled: true,
      loggerLayers: ['observability/**'],
      rules: ['effect-no-global-fetch'],
    } satisfies TheThracianEffectStrictOptions & { loggerLayers: readonly string[] };
    const config = theThracianOxlint({ effect: { strict: mixedStrictOptions } });

    expect(config.rules).toHaveProperty('thethracian/effect-no-global-fetch', [
      'error',
      { adapterLayers: ['platform/**'] },
    ]);
  });
});

describe('native and type-aware configuration', () => {
  it('exports silent catch blocking as an error', () => {
    const config = theThracianOxlint();

    expect(config.rules).toHaveProperty('no-empty', ['error', { allowEmptyCatch: false }]);
  });

  it('omits fixers that rewrite ES2022-compatible code into newer runtime APIs', () => {
    const config = theThracianOxlint();

    expect(config.rules).not.toHaveProperty('unicorn/no-array-sort');
  });

  it('does not enable rules that conflict with explicit no-ternary control flow', () => {
    const config = theThracianOxlint();

    expect(config.rules).not.toHaveProperty('unicorn/prefer-ternary');
  });

  it('does not ban Node builtins globally outside the Effect platform boundary rule', () => {
    const config = theThracianOxlint();

    expect(config.rules).not.toHaveProperty('import/no-nodejs-modules');
  });

  it('does not force single-default-export module shapes for TypeScript library APIs', () => {
    const config = theThracianOxlint();

    expect(config.rules).not.toHaveProperty('import/no-named-export');
    expect(config.rules).not.toHaveProperty('import/prefer-default-export');
    expect(config.rules).not.toHaveProperty('import/group-exports');
    expect(config.rules).not.toHaveProperty('import/exports-last');
  });

  it('does not conflict with top-level type-only imports', () => {
    const config = theThracianOxlint();

    expect(config.rules).not.toHaveProperty('no-duplicate-imports');
  });

  it('allows runtime-specific JavaScript extensions in TypeScript imports', () => {
    const config = theThracianOxlint();

    expect(config.rules).not.toHaveProperty('import/extensions');
    expect(config.rules).not.toHaveProperty('thethracian/no-dynamic-js-extension-imports');
  });

  it('allows local bottom export lists in implementation modules', () => {
    const config = theThracianOxlint();

    expect(config.rules).not.toHaveProperty('thethracian/no-local-export-list');
  });

  it('allows contextual numeric literals instead of forcing constant extraction', () => {
    const config = theThracianOxlint();

    expect(config.rules).not.toHaveProperty('no-magic-numbers');
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
