/* -------------------------------------------------------------------------- */
/*       Oxlint JavaScript plugin entry for The Thracian Effect rules.        */
/* -------------------------------------------------------------------------- */
import { eslintCompatPlugin } from '@oxlint/plugins';
import effectDefaultRules from './effect-default';
import effectStrictRules from './effect-strict';

type OxlintPlugin = Parameters<typeof eslintCompatPlugin>[0];

const plugin = {
  meta: {
    name: 'thethracian',
  },
  rules: {
    ...effectDefaultRules,
    ...effectStrictRules,
  },
};

const isPlugin = (value: unknown): value is OxlintPlugin => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const rules: unknown = Reflect.get(value, 'rules');
  return typeof rules === 'object' && rules !== null;
};

if (!isPlugin(plugin)) {
  throw new TypeError('Invalid The Thracian Oxlint plugin shape.');
}

/**
 * Oxlint-compatible JavaScript plugin containing The Thracian Effect rules.
 *
 * @internal
 */
export default eslintCompatPlugin(plugin);
