/* -------------------------------------------------------------------------- */
/* Local Oxlint configuration for validating unpublished TypeScript changes.  */
/* -------------------------------------------------------------------------- */
import { existsSync } from 'node:fs';

const packageModule = existsSync(new URL('./ts/dist/index.js', import.meta.url))
  ? await import('./ts/dist/index.js')
  : await import('@thethracian/oxlint-config');
const theThracian = packageModule.default;

const config = theThracian({
  effect: true,
  typeAware: true,
});

const localRepositoryConfig = {
  ...config,
  ignorePatterns: [
    'oxlint.workspace.config.mjs',
    '**/node_modules/**',
    '**/dist/**',
    '**/build/**',
    '**/coverage/**',
    '**/scripts/**',
    // Deliberately invalid programs are checked by the minimum-peer harness.
    'ts/test/oxlint-min-peer/{invalid,safe,native-apis}.ts',
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

export default localRepositoryConfig;
