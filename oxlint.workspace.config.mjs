import { existsSync } from 'node:fs';
import { repositoryConfig } from './oxlint.repository.mjs';

const packageModule = existsSync(new URL('./ts/dist/index.js', import.meta.url))
  ? await import('./ts/dist/index.js')
  : await import('@thethracian/oxlint-config');

export default repositoryConfig(packageModule.default);
