/* -------------------------------------------------------------------------- */
/* Repository Oxlint configuration using the published TypeScript package.    */
/* -------------------------------------------------------------------------- */
import theThracian from '@thethracian/oxlint-config';

const config = theThracian({
  effect: true,
  typeAware: true,
});

const repositoryConfig = {
  ...config,
  ignorePatterns: [
    'oxlint.workspace.config.mjs',
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
};

export default repositoryConfig;
