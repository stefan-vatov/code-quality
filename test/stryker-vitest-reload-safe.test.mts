import { afterEach, describe, expect, it, vi } from 'vitest';
import { createReloadSafePlugins } from './stryker-vitest-reload-safe-factory.mjs';
import * as adapter from './stryker-vitest-reload-safe.mjs';
import { strykerValidationSchema as officialSchema } from '@stryker-mutator/vitest-runner';

interface MutationRunOptions {
  activeMutant: { id: number };
  hitLimit: number;
  mutantActivation: string;
  reloadEnvironment: boolean | undefined;
  sandboxFileName: string;
  testFilter: string[];
}

const activeMutantEnvironmentVariable = '__STRYKER_ACTIVE_MUTANT__';
const originalActiveMutant = process.env[activeMutantEnvironmentVariable];

const restoreOriginalActiveMutant = () => {
  if (originalActiveMutant === undefined) {
    Reflect.deleteProperty(process.env, activeMutantEnvironmentVariable);
    return;
  }
  process.env[activeMutantEnvironmentVariable] = originalActiveMutant;
};

const adapterWithRunner = <Result extends object>(
  mutantRun: (options: MutationRunOptions) => Promise<Result>,
) => {
  const runner = {
    capabilities: vi.fn(() => ({ reloadEnvironment: true })),
    mutantRun,
  };
  const officialFactory = Object.assign(
    vi.fn((_injector: { token?: string }) => runner),
    {
      inject: Object.freeze(['$injector']),
    },
  );
  const plugins = createReloadSafePlugins([
    {
      factory: Object.assign(
        vi.fn(() => runner),
        { inject: officialFactory.inject },
      ),
      kind: 'testRunner',
      name: 'unrelated-runner',
    },
    {
      factory: officialFactory,
      kind: 'testRunner',
      name: 'vitest',
    },
  ]);
  const plugin = plugins[0];

  return {
    officialFactory,
    plugin,
    runner,
  };
};

const mutationRunOptions = (
  id: number,
  ...reloadEnvironmentValues: (boolean | undefined)[]
): MutationRunOptions => ({
  activeMutant: { id },
  hitLimit: 17,
  mutantActivation: 'static',
  reloadEnvironment: reloadEnvironmentValues.length === 0 ? true : reloadEnvironmentValues[0],
  sandboxFileName: '/sandbox/source.ts',
  testFilter: ['adapter contract'],
});

afterEach(() => {
  vi.restoreAllMocks();
  restoreOriginalActiveMutant();
});

describe('reload-safe Stryker Vitest adapter', () => {
  it('publishes the official schema and delegates factory construction to the official runner', () => {
    const officialMutantRun = vi.fn(() => Promise.resolve({ status: 'survived' }));
    const injector = Object.freeze({ token: 'injector' });
    const { officialFactory, plugin, runner } = adapterWithRunner(officialMutantRun);

    expect(adapter.strykerValidationSchema).toBe(officialSchema);
    expect(adapter.strykerPlugins).toHaveLength(1);
    expect(plugin).toMatchObject({
      kind: 'testRunner',
      name: 'vitest-reload-safe',
    });
    expect(plugin.factory.inject).toBe(officialFactory.inject);
    expect(plugin.factory(injector)).toBe(runner);
    expect(officialFactory).toHaveBeenCalledOnce();
    expect(officialFactory).toHaveBeenCalledWith(injector);
    expect(runner.capabilities()).toStrictEqual({ reloadEnvironment: true });
  });

  it.each([false, undefined])(
    'forwards the exact options and result without changing the environment when reloadEnvironment is %s',
    async (reloadEnvironment) => {
      process.env[activeMutantEnvironmentVariable] = 'outer-mutant';
      const result = Object.freeze({ status: 'killed' });
      const officialMutantRun = vi.fn(
        function (this: { mutantRun: (options: MutationRunOptions) => Promise<object> }) {
          expect(this).toBe(runner);
          expect(process.env[activeMutantEnvironmentVariable]).toBe('outer-mutant');
          return Promise.resolve(result);
        },
      );
      const imported = adapterWithRunner(officialMutantRun);
      const runner = imported.runner;
      imported.plugin.factory(Object.freeze({}));
      const options = mutationRunOptions(23, reloadEnvironment);

      await expect(runner.mutantRun(options)).resolves.toBe(result);

      expect(officialMutantRun).toHaveBeenCalledOnce();
      expect(officialMutantRun).toHaveBeenCalledWith(options);
      expect(process.env[activeMutantEnvironmentVariable]).toBe('outer-mutant');
    },
  );

  it.each([
    {
      initialValue: undefined,
      mutantId: 0,
      outcome: 'success',
    },
    {
      initialValue: 'outer-success',
      mutantId: 41,
      outcome: 'success',
    },
    {
      initialValue: undefined,
      mutantId: 42,
      outcome: 'rejection',
    },
    {
      initialValue: 'outer-rejection',
      mutantId: 43,
      outcome: 'rejection',
    },
  ])(
    'exposes mutant $mutantId during a reload $outcome and restores initial value $initialValue',
    async ({ initialValue, mutantId, outcome }) => {
      if (initialValue === undefined) {
        Reflect.deleteProperty(process.env, activeMutantEnvironmentVariable);
      } else {
        process.env[activeMutantEnvironmentVariable] = initialValue;
      }
      const failure = new Error(`mutant ${mutantId} failed`);
      const result = Object.freeze({ status: 'survived' });
      const observations: (string | undefined)[] = [];
      const officialMutantRun = vi.fn(async () => {
        observations.push(process.env[activeMutantEnvironmentVariable]);
        await Promise.resolve();
        observations.push(process.env[activeMutantEnvironmentVariable]);
        if (outcome === 'rejection') {
          throw failure;
        }
        return result;
      });
      const { plugin, runner } = adapterWithRunner(officialMutantRun);
      plugin.factory(Object.freeze({}));
      const run = runner.mutantRun(mutationRunOptions(mutantId));

      if (outcome === 'rejection') {
        await expect(run).rejects.toBe(failure);
      } else {
        await expect(run).resolves.toBe(result);
      }

      expect(observations).toStrictEqual([String(mutantId), String(mutantId)]);
      expect(process.env[activeMutantEnvironmentVariable]).toBe(initialValue);
      expect(Object.hasOwn(process.env, activeMutantEnvironmentVariable)).toBe(
        initialValue !== undefined,
      );
    },
  );

  it('reevaluates alternating mutant IDs at module initialization without leaking state', async () => {
    process.env[activeMutantEnvironmentVariable] = 'outer-mutant';
    const initializedMutants: (string | undefined)[] = [];
    let moduleSequence = 0;
    const officialMutantRun = vi.fn(async ({ activeMutant }: MutationRunOptions) => {
      const moduleSource = 'export default process.env.__STRYKER_ACTIVE_MUTANT__;';
      const moduleURL =
        `data:text/javascript,${encodeURIComponent(moduleSource)}` +
        `#adapter-contract-${moduleSequence}`;
      moduleSequence += 1;
      const initialized = (await import(moduleURL)) as { default: string | undefined };
      initializedMutants.push(initialized.default);
      return Object.freeze({
        activeMutant: activeMutant.id,
        initializedMutant: initialized.default,
      });
    });
    const { plugin, runner } = adapterWithRunner(officialMutantRun);
    plugin.factory(Object.freeze({}));

    const results = [];
    for (const mutantId of [7, 19, 7, 31]) {
      results.push(await runner.mutantRun(mutationRunOptions(mutantId)));
      expect(process.env[activeMutantEnvironmentVariable]).toBe('outer-mutant');
    }

    expect(initializedMutants).toStrictEqual(['7', '19', '7', '31']);
    expect(results).toStrictEqual([
      { activeMutant: 7, initializedMutant: '7' },
      { activeMutant: 19, initializedMutant: '19' },
      { activeMutant: 7, initializedMutant: '7' },
      { activeMutant: 31, initializedMutant: '31' },
    ]);
    expect(officialMutantRun).toHaveBeenCalledTimes(4);
    expect(process.env[activeMutantEnvironmentVariable]).toBe('outer-mutant');
  });

  it('fails fast when the official Vitest plugin cannot be resolved', () => {
    expect(() => createReloadSafePlugins([])).toThrow(
      'The official Stryker Vitest test-runner plugin is unavailable.',
    );
  });
});
