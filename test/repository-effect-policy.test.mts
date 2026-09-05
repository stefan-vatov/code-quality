import publishedFactory from '@thethracian/oxlint-config';
import { describe, expect, it } from 'vitest';
import { repositoryConfig } from '../oxlint.repository.mjs';
import localFactory from '../ts/src/index';

describe('repository-wide TypeScript policy', () => {
  it.each([
    ['local', localFactory],
    ['published', publishedFactory],
  ] as const)(
    'preserves the complete error-only %s preset with Effect and type-aware checks enabled',
    (_name, factory) => {
      const calls: unknown[] = [];
      const config = repositoryConfig((options) => {
        calls.push(options);
        return factory(options);
      });
      const selected = factory({ effect: true, typeAware: true });

      expect(calls).toEqual([{ effect: true, typeAware: true }]);
      expect(config.rules).toEqual(selected.rules);
      expect(config.jsPlugins).toEqual(selected.jsPlugins);
      expect(config.plugins).toEqual(selected.plugins);
      expect(config.options.denyWarnings).toBe(true);
      for (const [rule, setting] of Object.entries(config.rules)) {
        expect(['error', 2], rule).toContain(Array.isArray(setting) ? setting[0] : setting);
      }
    },
  );
});
