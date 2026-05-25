/* -------------------------------------------------------------------------- */
/* Local Oxlint configuration for validating unpublished TypeScript changes.  */
/* -------------------------------------------------------------------------- */
import { existsSync } from 'node:fs';

const packageModule = existsSync(new URL('./ts/dist/index.js', import.meta.url))
  ? await import('./ts/dist/index.js')
  : await import('@thethracian/oxlint-config');
const theThracian = packageModule.default;

const config = theThracian({
  effect: {
    strict: {
      adapterLayers: ['ts/src/codemod-fix/**', 'ts/src/index.ts', 'ts/src/rules/source-cache.ts'],
      configLayers: ['ts/src/index.ts'],
    },
  },
  typeAware: true,
});

const localRepositoryConfig = {
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

export default localRepositoryConfig;
