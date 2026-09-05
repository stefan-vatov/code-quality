import { effectDefaultRuleNames, effectStrictRuleNames } from './ts/src/rules/effect-rule-names.ts';

const entrypoints = ['ts/src/codemod-fix/cli.ts', 'ts/src/codemods/run.ts'];
const strict = {
  rules: effectStrictRuleNames,
  adapterLayers: ['ts/src/index.ts', 'ts/src/codemod-fix/index.ts', 'ts/src/rules/source-cache.ts'],
  compositionRoots: ['ts/src/index.ts', ...entrypoints],
  configLayers: ['ts/src/index.ts', 'vitest.config.mts', 'vitest.stryker.config.mts'],
  domain: ['ts/src/rules/**', 'ts/src/codemods/**'],
  entrypoints,
  unitTests: ['**/test/**', '**/tests/**', '**/*.test.*', '**/*.spec.*'],
  integrationTests: ['**/*.integration.test.*', '**/*.integration.spec.*'],
};

export const repositoryConfig = (factory) => {
  const config = factory({ effect: { strict }, typeAware: true });
  return {
    ...config,
    rules: {
      ...config.rules,
      ...Object.fromEntries(effectDefaultRuleNames.map((name) => [`thethracian/${name}`, 'error'])),
    },
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
