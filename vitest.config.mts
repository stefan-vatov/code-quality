import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./test/setup.ts'],
    exclude: [
      ...configDefaults.exclude,
      '**/dist/**',
      '**/build/**',
      '**/coverage/**',
      '**/.next/**',
      '**/.nuxt/**',
      '**/out/**',
      '**/out-tsc/**',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      exclude: [
        ...configDefaults.exclude,
        'test/**',
        'tests/**',
        '**/*.d.ts',
        '**/*.config.{js,mjs,cjs,ts,mts,cts}',
      ],
    },
  },
});
