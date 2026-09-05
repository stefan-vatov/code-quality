import { describe, expect, it } from 'vitest';
import plugin from '../../src/rules/plugin';
import { runRule } from './effect-rule-test-utils';

const registerResourceAndFiberOverlapTests = (): void => {
  it('does not let one scoped acquireRelease hide another unscoped acquireRelease', (): void => {
    const source = `
      const scoped = Effect.scoped(Effect.acquireRelease(openOne, closeOne));
      const unscoped = Effect.acquireRelease(openTwo, closeTwo);
    `;

    expect(runRule('effect-require-scoped-for-acquireRelease', source)).toHaveLength(1);
  });

  it('does not let one acquireRelease hide a separate unreleased resource acquisition', (): void => {
    const source = `
      const managed = Effect.acquireRelease(openConnection, closeConnection);
      const raw = Effect.sync(() => openSocket());
    `;

    expect(runRule('effect-require-acquire-release', source)).toHaveLength(1);
  });

  it('checks runFork observation per fork instead of per file', (): void => {
    const source = `
      const observed = Effect.runFork(program);
      observed.addObserver(() => undefined);
      Effect.runFork(otherProgram);
    `;

    expect(runRule('effect-no-runfork-without-observer', source)).toHaveLength(1);
  });

  it('allows current HttpClient request effects without requiring per-request scoping', (): void => {
    const source = 'const response = yield* HttpClient.get(url);';

    expect(runRule('effect-require-scoped-for-resources', source)).toHaveLength(0);
  });

  it('requires typed catch handlers for object-form tryPromise', (): void => {
    const source = 'const task = Effect.tryPromise({ try: () => fetch("/users") });';

    expect(runRule('effect-require-typed-error-in-trypromise', source)).toHaveLength(1);
  });

  it('allows returned fibers as explicit ownership transfer', (): void => {
    const source = `
      const program = Effect.gen(function* () {
        return yield* Effect.fork(worker);
      });
    `;

    expect(runRule('effect-no-floating-fiber', source)).toHaveLength(0);
  });
};

const registerLayerAndSchemaOverlapTests = (): void => {
  it('uses current Schema.parseJson naming for JSON string decoding guidance', (): void => {
    expect(plugin.rules).not.toHaveProperty(
      'effect-schema-require-fromJsonString-for-json-strings',
    );
  });
};

describe('Effect review overlap regressions', (): void => {
  registerResourceAndFiberOverlapTests();
  registerLayerAndSchemaOverlapTests();
});
