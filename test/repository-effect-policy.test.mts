import { describe, expect, it } from 'vitest';
import { effectDefaultRuleNames, effectStrictRuleNames } from '../ts/src/rules/effect-rule-names';
import localFactory from '../ts/src/index';
import publishedFactory from '@thethracian/oxlint-config';
import { repositoryConfig } from '../oxlint.repository.mjs';

describe('repository-wide TypeScript policy', () => {
  it.each([
    ['local', localFactory],
    ['published', publishedFactory],
  ] as const)('enables every retained Effect rule as an error in %s', (_name, factory) => {
    const config = repositoryConfig(factory);
    for (const rule of [...effectDefaultRuleNames, ...effectStrictRuleNames]) {
      const setting = config.rules[`thethracian/${rule}`];
      expect(Array.isArray(setting) ? setting[0] : setting, rule).toBe('error');
    }
    expect(Object.keys(config.rules)).toHaveLength(271);
  });
});
