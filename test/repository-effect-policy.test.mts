import publishedFactory from '@thethracian/oxlint-config';
import { describe, expect, it } from 'vitest';
import { repositoryConfig } from '../oxlint.repository.mjs';
import localFactory from '../ts/src/index';
import {
  effectDefaultRuleNames,
  effectSafetyRuleNames,
  effectStrictRuleNames,
} from '../ts/src/rules/effect-rule-names';

describe('repository-wide TypeScript policy', () => {
  it.each([
    ['local', localFactory, 210],
    ['published', publishedFactory, 193],
  ] as const)(
    'enables every retained Effect rule as an error in %s',
    (name, factory, ruleCount) => {
      const config = repositoryConfig(factory);
      for (const rule of name === 'local'
        ? [...effectDefaultRuleNames, ...effectStrictRuleNames]
        : effectSafetyRuleNames) {
        const setting = config.rules[`thethracian/${rule}`];
        expect(Array.isArray(setting) ? setting[0] : setting, rule).toBe('error');
      }
      expect(Object.keys(config.rules)).toHaveLength(ruleCount);
    },
  );
});
