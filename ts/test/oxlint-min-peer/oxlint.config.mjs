import theThracianOxlint from '../../dist/index.js';

const packageConfig = theThracianOxlint({
  effect: true,
});

export default {
  jsPlugins: packageConfig.jsPlugins,
  rules: {
    'thethracian/effect-no-floating-effect': 'error',
    'thethracian/effect-require-yield-star': 'error',
    'thethracian/effect-no-runSync-in-server-request-handlers': 'error',
  },
};
