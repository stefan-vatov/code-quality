import { afterEach, describe, expect, it, vi } from 'vitest';

const activeMutantEnvironmentVariable = '__STRYKER_ACTIVE_MUTANT__';
const adapterSpecifier = './stryker-vitest-reload-safe.mjs';
const originalActiveMutant = process.env[activeMutantEnvironmentVariable];

const restoreOriginalActiveMutant = () => {
  if (originalActiveMutant === undefined) {
    Reflect.deleteProperty(process.env, activeMutantEnvironmentVariable);
    return;
  }
  process.env[activeMutantEnvironmentVariable] = originalActiveMutant;
};

const importAdapterWithRunner = async (mutantRun) => {
  vi.resetModules();
  const runner = {
    capabilities: vi.fn(() => ({ reloadEnvironment: true })),
    mutantRun,
  };
  const officialFactory = vi.fn(() => runner);
  officialFactory.inject = Object.freeze(['$injector']);
  const officialSchema = Object.freeze({
    properties: Object.freeze({ vitest: Object.freeze({ type: 'object' }) }),
    type: 'object',
  });
  vi.doMock('@stryker-mutator/vitest-runner', () => ({
    strykerPlugins: [
      {
        factory: vi.fn(),
        kind: 'testRunner',
        name: 'unrelated-runner',
      },
      {
        factory: officialFactory,
        kind: 'testRunner',
        name: 'vitest',
      },
    ],
    strykerValidationSchema: officialSchema,
  }));

  const adapter = await import(adapterSpecifier);
  const plugin = adapter.strykerPlugins[0];

  return {
    adapter,
    officialFactory,
    officialSchema,
    plugin,
    runner,
  };
};

const mutationRunOptions = (id, ...reloadEnvironmentValues) => ({
  activeMutant: { id },
  hitLimit: 17,
  mutantActivation: 'static',
  reloadEnvironment: reloadEnvironmentValues.length === 0 ? true : reloadEnvironmentValues[0],
  sandboxFileName: '/sandbox/source.ts',
  testFilter: ['adapter contract'],
});

afterEach(() => {
  vi.doUnmock('@stryker-mutator/vitest-runner');
  vi.restoreAllMocks();
  vi.resetModules();
  restoreOriginalActiveMutant();
});

describe('reload-safe Stryker Vitest adapter', () => {
  it('publishes the official schema and delegates factory construction to the official runner', async () => {
    const officialMutantRun = vi.fn();
    const injector = Object.freeze({ token: 'injector' });
    const { adapter, officialFactory, officialSchema, plugin, runner } =
      await importAdapterWithRunner(officialMutantRun);

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
      let runner;
      const officialMutantRun = vi.fn(function () {
        expect(this).toBe(runner);
        expect(process.env[activeMutantEnvironmentVariable]).toBe('outer-mutant');
        return Promise.resolve(result);
      });
      const imported = await importAdapterWithRunner(officialMutantRun);
      runner = imported.runner;
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
      const observations = [];
      const officialMutantRun = vi.fn(async () => {
        observations.push(process.env[activeMutantEnvironmentVariable]);
        await Promise.resolve();
        observations.push(process.env[activeMutantEnvironmentVariable]);
        if (outcome === 'rejection') {
          throw failure;
        }
        return result;
      });
      const { plugin, runner } = await importAdapterWithRunner(officialMutantRun);
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
    const initializedMutants = [];
    let moduleSequence = 0;
    const officialMutantRun = vi.fn(async ({ activeMutant }) => {
      const moduleSource = 'export default process.env.__STRYKER_ACTIVE_MUTANT__;';
      const moduleURL =
        `data:text/javascript,${encodeURIComponent(moduleSource)}` +
        `#adapter-contract-${moduleSequence}`;
      moduleSequence += 1;
      const initialized = await import(moduleURL);
      initializedMutants.push(initialized.default);
      return Object.freeze({
        activeMutant: activeMutant.id,
        initializedMutant: initialized.default,
      });
    });
    const { plugin, runner } = await importAdapterWithRunner(officialMutantRun);
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

  it('fails fast when the official Vitest plugin cannot be resolved', async () => {
    vi.resetModules();
    vi.doMock('@stryker-mutator/vitest-runner', () => ({
      strykerPlugins: [],
      strykerValidationSchema: Object.freeze({ type: 'object' }),
    }));

    await expect(import(adapterSpecifier)).rejects.toThrow(
      'The official Stryker Vitest test-runner plugin is unavailable.',
    );
  });
});
