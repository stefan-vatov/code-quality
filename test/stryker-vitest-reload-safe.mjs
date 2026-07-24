import {
  strykerPlugins as officialStrykerPlugins,
  strykerValidationSchema,
} from '@stryker-mutator/vitest-runner';

const officialVitestPlugin = officialStrykerPlugins.find(({ name }) => name === 'vitest');
const activeMutantEnvironmentVariable = '__STRYKER_ACTIVE_MUTANT__';

if (!officialVitestPlugin) {
  throw new Error('The official Stryker Vitest test-runner plugin is unavailable.');
}

const reloadSafeVitestFactory = (injector) => {
  const runner = officialVitestPlugin.factory(injector);
  const officialMutantRun = runner.mutantRun.bind(runner);
  Object.defineProperty(runner, 'mutantRun', {
    value: async (options) => {
      if (!options.reloadEnvironment) {
        return officialMutantRun(options);
      }
      const previousActiveMutant = process.env[activeMutantEnvironmentVariable];
      process.env[activeMutantEnvironmentVariable] = String(options.activeMutant.id);
      try {
        return await officialMutantRun(options);
      } finally {
        if (previousActiveMutant === undefined) {
          Reflect.deleteProperty(process.env, activeMutantEnvironmentVariable);
        } else {
          process.env[activeMutantEnvironmentVariable] = previousActiveMutant;
        }
      }
    },
  });
  return runner;
};

reloadSafeVitestFactory.inject = officialVitestPlugin.factory.inject;

export const strykerPlugins = [
  {
    factory: reloadSafeVitestFactory,
    kind: officialVitestPlugin.kind,
    name: 'vitest-reload-safe',
  },
];

export { strykerValidationSchema };
