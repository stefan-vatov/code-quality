import { describe, expect, it } from 'vitest';
import theThracianOxlint from '../../src/index.js';
import effectDefaultRules from '../../src/rules/effect-default.js';
import {
  effectDefaultRuleNames,
  effectStrictRuleNames,
} from '../../src/rules/effect-rule-names.js';
import effectStrictRules from '../../src/rules/effect-strict.js';
import plugin from '../../src/rules/plugin.js';
import { sorted } from './effect-rule-test-utils.js';

describe('Effect rule buckets', () => {
  it('keeps bucket names, implementations, and plugin registration in exact sync', () => {
    expect(effectDefaultRuleNames).toHaveLength(81);
    expect(effectStrictRuleNames).toHaveLength(60);
    expect(new Set([...effectDefaultRuleNames, ...effectStrictRuleNames]).size).toBe(141);
    expect(sorted(Object.keys(effectDefaultRules))).toEqual(sorted(effectDefaultRuleNames));
    expect(sorted(Object.keys(effectStrictRules))).toEqual(sorted(effectStrictRuleNames));

    for (const ruleName of [...effectDefaultRuleNames, ...effectStrictRuleNames]) {
      expect(plugin.rules, `${ruleName} must be registered`).toHaveProperty(ruleName);
    }
    expect(plugin.rules).not.toHaveProperty('complexity');
  });

  it('keeps published config bucket enablement in exact sync', () => {
    const defaultConfig = theThracianOxlint();
    const disabledConfig = theThracianOxlint({ effect: false });
    const strictConfig = theThracianOxlint({ effect: { strict: true } });
    const strictObjectConfig = theThracianOxlint({ effect: { strict: { enabled: true } } });

    for (const ruleName of effectDefaultRuleNames) {
      expect(defaultConfig.rules).toHaveProperty(`thethracian/${ruleName}`, 'error');
      expect(strictConfig.rules).toHaveProperty(`thethracian/${ruleName}`, 'error');
      expect(disabledConfig.rules).not.toHaveProperty(`thethracian/${ruleName}`);
    }
    for (const ruleName of effectStrictRuleNames) {
      expect(defaultConfig.rules).not.toHaveProperty(`thethracian/${ruleName}`);
      expect(disabledConfig.rules).not.toHaveProperty(`thethracian/${ruleName}`);
      expect(strictConfig.rules).toHaveProperty(`thethracian/${ruleName}`, 'error');
      expect(strictObjectConfig.rules).toHaveProperty(`thethracian/${ruleName}`, 'error');
    }
  });

  it('declares options schemas for strict rules that receive project path configuration', () => {
    for (const ruleName of effectStrictRuleNames) {
      const rule = plugin.rules[ruleName as keyof typeof plugin.rules] as {
        meta?: { schema?: unknown };
      };

      expect(rule.meta?.schema, `${ruleName} must accept strict path options`).toBeDefined();
    }
  });

  it('keeps the strict path option schema keys stable', () => {
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
