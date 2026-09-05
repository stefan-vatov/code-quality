import {
  strykerPlugins as officialStrykerPlugins,
  strykerValidationSchema,
} from '@stryker-mutator/vitest-runner';

import { createReloadSafePlugins } from './stryker-vitest-reload-safe-factory.mts';

export const strykerPlugins = createReloadSafePlugins(officialStrykerPlugins);

export { strykerValidationSchema };
