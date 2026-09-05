interface ReloadOptions {
  reloadEnvironment?: boolean;
  activeMutant: { id: string | number };
}

interface ReloadableRunner {
  mutantRun(options: ReloadOptions): Promise<object>;
}

interface RunnerPlugin<Injector, Runner, Kind, Inject> {
  name: string;
  kind: Kind;
  factory: ((injector: Injector) => Runner) & { inject: Inject };
}

const activeMutantEnvironmentVariable = '__STRYKER_ACTIVE_MUTANT__';

export function createReloadSafePlugins<Injector, Runner extends ReloadableRunner, Kind, Inject>(
  plugins: readonly RunnerPlugin<Injector, Runner, Kind, Inject>[],
) {
  const officialVitestPlugin = plugins.find(({ name }) => name === 'vitest');
  if (!officialVitestPlugin) {
    throw new Error('The official Stryker Vitest test-runner plugin is unavailable.');
  }

  const reloadSafeVitestFactory = (injector: Injector) => {
    const runner = officialVitestPlugin.factory(injector);
    const officialMutantRun = runner.mutantRun.bind(runner);
    Object.defineProperty(runner, 'mutantRun', {
      value: async (options: Parameters<Runner['mutantRun']>[0]) => {
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

  return [
    {
      factory: Object.assign(reloadSafeVitestFactory, {
        inject: officialVitestPlugin.factory.inject,
      }),
      kind: officialVitestPlugin.kind,
      name: 'vitest-reload-safe',
    },
  ];
}
