import { isAbsolute } from 'node:path';
import { describe, expect, it } from 'vitest';
import theThracianOxlint from '../src/index.js';

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
});
