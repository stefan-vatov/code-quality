/** @internal Vitest config trimmed for Stryker mutation dry-runs. */
import { configDefaults, defineConfig, mergeConfig } from 'vitest/config';
import baseConfig from './vitest.config.mts';

export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      exclude: [
        ...configDefaults.exclude,
        '**/dist/**',
        '**/build/**',
        '**/coverage/**',
        '**/.next/**',
        '**/.nuxt/**',
        '**/out/**',
        '**/out-tsc/**',
        'ts/test/rules/*performance.test.ts',
        'ts/test/rules/effect-default-bucket-cases.test.ts',
        'ts/test/rules/max-line-length.test.ts',
        'ts/test/rules/require-function-doc.test.ts',
      ],
    },
  }),
);
