export const repositoryConfig = (factory) => {
  const config = factory({ effect: true, typeAware: true });
  return {
    ...config,
    ignorePatterns: [
      '**/*.{js,mjs,cjs,jsx}',
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/coverage/**',
      '**/target/**',
      '**/_build/**',
      '**/deps/**',
      'ts/codemod-quality-output/**',
      '**/test/**',
      '**/tests/**',
      '**/__tests__/**',
      '**/*.test.{ts,tsx,mts,cts}',
      '**/*.spec.{ts,tsx,mts,cts}',
      '**/scripts/**',
      '**/bench/**',
      '**/benchmarks/**',
      '**/*.bench.{ts,tsx,mts,cts}',
      '**/*.benchmark.{ts,tsx,mts,cts}',
      '**/.next/**',
      '**/.nuxt/**',
      '**/out/**',
      '**/out-tsc/**',
      '**/.turbo/**',
      '**/.cache/**',
    ],
    options: { ...config.options, denyWarnings: true },
  };
};
