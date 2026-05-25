/** @internal Shared Vitest config for repository unit tests and coverage thresholds. */
import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      exclude: [
        ...configDefaults.exclude,
        'test/**',
        'tests/**',
        '**/.stryker-tmp/**',
        '**/*.d.ts',
        '**/*.config.{js,mjs,cjs,ts,mts,cts}',
      ],
      include: ['ts/src/**/*.ts'],
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      thresholds: {
        branches: 75,
        functions: 80,
        lines: 80,
        statements: 80,
      },
    },
    environment: 'node',
    exclude: [
      ...configDefaults.exclude,
      '**/dist/**',
      '**/build/**',
      '**/coverage/**',
      '**/.stryker-tmp/**',
      '**/.next/**',
      '**/.nuxt/**',
      '**/out/**',
      '**/out-tsc/**',
    ],
    globals: true,
    setupFiles: ['./test/setup.ts'],
  },
});
