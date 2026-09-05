import { describe, expect, it } from 'vitest';
import { effectStrictRuleNames } from '../src/rules/effect-rule-names';
import { effectStrictCoreSpecs } from '../src/rules/effect-strict-core-specs';
import config from '../src/index';
import { effectDefaultRuleNames } from '../src/rules/effect-rule-names';
import plugin from '../src/rules/plugin';

describe('retained Effect policy', () => {
  it('retains the server-handler safety check instead of textual architecture heuristics', () => {
    expect(effectStrictCoreSpecs.map(({ name }) => name)).toEqual([
      'effect-no-runSync-in-server-request-handlers',
    ]);
  });

  it('deletes rejected heuristic and boundary rules without keeping optional registrations', () => {
    const retained = ['effect-no-runSync-in-server-request-handlers'];
    expect([...effectStrictRuleNames]).toEqual(retained);
    for (const name of retained) expect(plugin.rules).toHaveProperty(name);
    for (const name of [
      'effect-require-onExit-for-cleanup',
      'effect-require-ref-for-shared-mutable-state',
      'effect-avoid-layer-explosion',
      'effect-require-retry-policy-for-idempotent-external-effects',
      'effect-schema-require-validation-at-input-boundaries',
      'effect-no-global-fetch',
      'no-comments',
    ])
      expect(plugin.rules).not.toHaveProperty(name);
  });

  it('enables every retained Effect rule together at error severity', () => {
    const rules = config({ effect: true, typeAware: true }).rules;
    expect(effectDefaultRuleNames).toHaveLength(34);
    for (const name of [...effectDefaultRuleNames, ...effectStrictRuleNames]) {
      expect(rules).toHaveProperty(`thethracian/${name}`, 'error');
    }
    expect(Object.keys(rules ?? {})).toHaveLength(210);
  });

  it('rejects the removed object configuration rather than silently ignoring old selections', () => {
    expect(() => Reflect.apply(config, undefined, [{ effect: { strict: { rules: [] } } }])).toThrow(
      'effect must be a boolean',
    );
  });
});
