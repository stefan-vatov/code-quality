import { describe, expect, it } from 'vitest';
import factory from '../../src/index';
import plugin from '../../src/rules/plugin';
import { readFileSync } from 'node:fs';

describe('comment-free preset', () => {
  it.each([{}, { typeAware: true }, { effect: true }])(
    'bans comments with options %j',
    (options) => {
      const rules = factory(options).rules;
      expect(rules).toHaveProperty('thethracian/no-comments', 'error');
      expect(rules).not.toHaveProperty('thethracian/require-safety-comment-for-type-assertion');
    },
  );

  it('does not register contradictory comment requirements or automatic comment deletion', () => {
    expect(plugin.rules).not.toHaveProperty('require-safety-comment-for-type-assertion');
    expect(plugin.rules).not.toHaveProperty('effect-require-effect-suppression-reason-and-ticket');
    expect(plugin.rules).toHaveProperty('no-comments');
  });

  it('runs cross-language linting in CI and pre-push', () => {
    const ci = readFileSync(new URL('../../../.github/workflows/ci.yml', import.meta.url), 'utf8');
    const hook = readFileSync(new URL('../../../.husky/pre-push', import.meta.url), 'utf8');
    expect(ci).toContain('run: pnpm run lint:projects');
    expect(hook).toMatch(/^pnpm run lint:projects$/mu);
  });
});
