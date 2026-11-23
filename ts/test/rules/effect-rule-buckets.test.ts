import { describe, expect, it } from 'vitest';
import { expectedRuleCounts } from '../../../scripts/rule-counts.mjs';
import theThracianOxlint from '../../src/index';
import effectDefaultRules from '../../src/rules/internal/effect-default';
import {
  effectDefaultRuleNames,
  effectSafetyRuleNames,
  effectStrictRuleNames,
} from '../../src/internal/effect-rule-names';
import effectStrictRules from '../../src/rules/internal/effect-strict';
import plugin from '../../src/rules/plugin';

describe('Effect rule buckets', () => {
  it('keeps names, implementations, and registration in exact sync', () => {
    expect(effectSafetyRuleNames).toHaveLength(18);
    expect(effectDefaultRuleNames).toHaveLength(expectedRuleCounts.effect - 1);
    expect(effectStrictRuleNames).toStrictEqual(['effect-no-runSync-in-server-request-handlers']);
    const names = [...effectDefaultRuleNames, ...effectStrictRuleNames];
    expect(new Set(names).size).toBe(expectedRuleCounts.effect);
    expect(Object.keys(effectDefaultRules).sort()).toEqual([...effectDefaultRuleNames].sort());
    expect(Object.keys(effectStrictRules).sort()).toEqual([...effectStrictRuleNames].sort());
    expect(
      Object.keys(plugin.rules)
        .filter((name) => name.startsWith('effect-'))
        .sort(),
    ).toEqual(names.sort());
  });

  it('enables all retained Effect rules with one boolean option', () => {
    const enabled = theThracianOxlint({ effect: true });
    const disabled = theThracianOxlint({ effect: false });
    const base = theThracianOxlint();
    for (const name of [...effectDefaultRuleNames, ...effectStrictRuleNames]) {
      expect(enabled.rules).toHaveProperty(`thethracian/${name}`, 'error');
      expect(disabled.rules).not.toHaveProperty(`thethracian/${name}`);
      expect(base.rules).not.toHaveProperty(`thethracian/${name}`);
    }
  });
});
