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
      ],
    },
  }),
);
