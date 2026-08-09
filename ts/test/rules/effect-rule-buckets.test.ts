import { describe, expect, it } from 'vitest';
import {
  effectDefaultRuleNames,
  effectSafetyRuleNames,
  effectStrictRuleNames,
} from '../../src/rules/effect-rule-names';
import effectDefaultRules from '../../src/rules/effect-default';
import effectStrictRules from '../../src/rules/effect-strict';
import plugin from '../../src/rules/plugin';
import { sorted, strictEffectTestPaths } from './effect-rule-test-utils';
import theThracianOxlint from '../../src/index';

describe('Effect rule buckets', (): void => {
  it('keeps bucket names, implementations, and plugin registration in exact sync', (): void => {
    expect(effectDefaultRuleNames).toHaveLength(37);
    expect(effectStrictRuleNames).toHaveLength(60);
    expect(new Set([...effectDefaultRuleNames, ...effectStrictRuleNames]).size).toBe(97);
    expect(sorted(Object.keys(effectDefaultRules))).toEqual(sorted(effectDefaultRuleNames));
    expect(sorted(Object.keys(effectStrictRules))).toEqual(sorted(effectStrictRuleNames));

    for (const ruleName of [...effectDefaultRuleNames, ...effectStrictRuleNames]) {
      expect(plugin.rules, `${ruleName} must be registered`).toHaveProperty(ruleName);
    }
    expect(plugin.rules).not.toHaveProperty('complexity');
  });

  it('keeps published config bucket enablement in exact sync', (): void => {
    const defaultConfig = theThracianOxlint();
    const safetyConfig = theThracianOxlint({ effect: true });
    const disabledConfig = theThracianOxlint({ effect: false });
    const strictOptions = { ...strictEffectTestPaths, rules: effectStrictRuleNames };
    const strictConfig = theThracianOxlint({ effect: { strict: strictOptions } });
    const strictObjectConfig = theThracianOxlint({
      effect: { strict: { enabled: true, ...strictOptions } },
    });

    for (const ruleName of effectSafetyRuleNames) {
      expect(defaultConfig.rules).not.toHaveProperty(`thethracian/${ruleName}`);
      expect(safetyConfig.rules).toHaveProperty(`thethracian/${ruleName}`, 'error');
      expect(strictConfig.rules).toHaveProperty(`thethracian/${ruleName}`, 'error');
      expect(disabledConfig.rules).not.toHaveProperty(`thethracian/${ruleName}`);
    }
    for (const ruleName of effectDefaultRuleNames) {
      if (!effectSafetyRuleNames.includes(ruleName)) {
        expect(defaultConfig.rules).not.toHaveProperty(`thethracian/${ruleName}`);
        expect(safetyConfig.rules).not.toHaveProperty(`thethracian/${ruleName}`);
      }
    }
    for (const ruleName of effectStrictRuleNames) {
      expect(defaultConfig.rules).not.toHaveProperty(`thethracian/${ruleName}`);
      expect(safetyConfig.rules).not.toHaveProperty(`thethracian/${ruleName}`);
      expect(disabledConfig.rules).not.toHaveProperty(`thethracian/${ruleName}`);
      const strictSetting = strictConfig.rules?.[`thethracian/${ruleName}`];
      const strictObjectSetting = strictObjectConfig.rules?.[`thethracian/${ruleName}`];
      expect(Array.isArray(strictSetting) ? strictSetting[0] : strictSetting).toBe('error');
      expect(
        Array.isArray(strictObjectSetting) ? strictObjectSetting[0] : strictObjectSetting,
      ).toBe('error');
    }
  });

  it('declares options schemas for strict rules that receive project path configuration', (): void => {
    for (const ruleName of effectStrictRuleNames) {
      const rule = plugin.rules[ruleName as keyof typeof plugin.rules] as {
        meta?: { schema?: unknown };
      };

      expect(rule.meta?.schema, `${ruleName} must accept strict path options`).toBeDefined();
    }
  });

  it('keeps the strict path option schema keys stable', (): void => {
    const rule = plugin.rules['effect-no-run-outside-entrypoints'] as {
      meta?: { schema?: Array<{ properties?: Record<string, unknown> }> };
    };

    expect(Object.keys(rule.meta?.schema?.[0]?.properties ?? {}).sort()).toStrictEqual([
      'adapterLayers',
      'compositionRoots',
      'configLayers',
      'domain',
      'entrypoints',
      'integrationTests',
      'unitTests',
    ]);
  });
});
