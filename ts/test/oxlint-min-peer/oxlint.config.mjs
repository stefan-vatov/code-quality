import theThracianOxlint from '../../dist/index.js';

const packageConfig = theThracianOxlint({
  effect: {
    strict: true,
  },
});

export default {
  jsPlugins: packageConfig.jsPlugins,
  rules: {
    'thethracian/effect-no-global-fetch': 'error',
    'thethracian/effect-no-sync-for-promise': 'error',
    'thethracian/effect-prefer-map-over-flatMap-succeed': 'error',
    'thethracian/no-commented-out-code': 'error',
  },
};
