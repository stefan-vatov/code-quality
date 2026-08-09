import theThracianOxlint from '../../dist/index.js';

const packageConfig = theThracianOxlint({
  effect: {
    enabled: true,
  },
});

export default {
  jsPlugins: packageConfig.jsPlugins,
  rules: {
    'thethracian/effect-no-floating-effect': 'error',
    'thethracian/effect-require-yield-star': 'error',
    'thethracian/effect-no-global-fetch': 'error',
  },
};
