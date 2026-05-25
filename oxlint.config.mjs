/** @internal Repository dogfooding Oxlint config for The Thracian TypeScript package. */
import theThracian from '@thethracian/oxlint-config';

const config = theThracian({
  effect: {
    strict: {
      adapterLayers: ['ts/src/codemod-fix/**', 'ts/src/index.ts', 'ts/src/rules/source-cache.ts'],
      configLayers: ['ts/src/index.ts'],
    },
  },
  typeAware: true,
});

const dogfoodConfig = {
  ...config,
  ignorePatterns: [
    '**/node_modules/**',
    '**/dist/**',
    '**/build/**',
    '**/coverage/**',
    '**/scripts/**',
    '**/test/**',
    '**/fixtures/**',
    '**/bench/**',
    '**/.next/**',
    '**/.nuxt/**',
    '**/out/**',
    '**/out-tsc/**',
    '**/.turbo/**',
    '**/.cache/**',
  ],
  options: {
    ...config.options,
    denyWarnings: true,
  },
  rules: {
    ...config.rules,
    'unicorn/no-array-sort': 'off',
  },
};

export default dogfoodConfig;
