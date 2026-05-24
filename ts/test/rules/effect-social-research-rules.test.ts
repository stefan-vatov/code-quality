import { describe, expect, it } from 'vitest';
import theThracianOxlint from '../../src/index.js';
import { runConfiguredRules, runRule } from './effect-rule-test-utils.js';

describe('Effect social research rule coverage', () => {
  it('enables new source-detectable default rules by default', () => {
    const config = theThracianOxlint();
    const ruleNames = [
      'effect-no-try-catch-in-effect-gen',
      'effect-no-new-promise',
      'effect-no-global-timers',
      'effect-no-native-error-classes',
      'effect-no-unsafe-effect-type-assertion',
      'effect-require-service-self-match',
      'effect-no-effect-fn-iife',
    ];

    for (const ruleName of ruleNames) {
      expect(config.rules).toHaveProperty(`thethracian/${ruleName}`, 'error');
    }
  });

  it('keeps new source-detectable strict rules opt-in', () => {
    const defaultConfig = theThracianOxlint();
    const strictConfig = theThracianOxlint({ effect: { strict: true } });
    const ruleNames = [
      'effect-no-crypto-randomUUID',
      'effect-require-schema-is-over-instanceof',
      'effect-prefer-schema-tagged-struct',
      'effect-prefer-single-schema-literal-union',
      'effect-require-deterministic-service-keys',
      'effect-no-multiple-provide-chain',
      'effect-require-layer-scoped-when-scope-required',
      'effect-no-node-builtins-when-effect-platform-exists',
      'effect-no-global-fetch',
      'effect-prefer-effect-void',
      'effect-prefer-asVoid',
      'effect-prefer-flatMap-over-map-flatten',
    ];

    for (const ruleName of ruleNames) {
      expect(defaultConfig.rules).not.toHaveProperty(`thethracian/${ruleName}`);
      expect(strictConfig.rules).toHaveProperty(`thethracian/${ruleName}`, 'error');
    }
  });

  it('reports imperative and platform escape hatches in Effect modules', () => {
    expect(
      runRule(
        'effect-no-try-catch-in-effect-gen',
        'const program = Effect.gen(function* () { try { yield* load; } catch (error) { return yield* Effect.fail(error); } });',
      ),
    ).toHaveLength(1);
    expect(
      runRule(
        'effect-no-try-catch-in-effect-gen',
        'const program = Effect.gen(function* () { return yield* load.pipe(Effect.catchTag("Missing", recover)); });',
      ),
    ).toHaveLength(0);
    expect(
      runRule(
        'effect-no-new-promise',
        'import { Effect } from "effect"; const task = new Promise((resolve) => resolve(1));',
      ),
    ).toHaveLength(1);
    expect(
      runRule('effect-no-new-promise', 'const task = Effect.promise(() => load());'),
    ).toHaveLength(0);
    expect(
      runRule(
        'effect-no-global-timers',
        'import { Effect } from "effect"; setTimeout(() => Effect.runFork(task), 1000);',
      ),
    ).toHaveLength(1);
    expect(
      runRule('effect-no-global-timers', 'const task = Effect.sleep(Duration.seconds(1));'),
    ).toHaveLength(0);
  });

  it('reports unsafe Effect error and assertion patterns', () => {
    expect(
      runRule(
        'effect-no-native-error-classes',
        'import { Effect } from "effect"; class UserError extends Error {}',
      ),
    ).toHaveLength(1);
    expect(
      runRule(
        'effect-no-native-error-classes',
        'class UserError extends Schema.TaggedErrorClass<UserError>("UserError")("UserError", {}) {}',
      ),
    ).toHaveLength(0);
    expect(
      runRule(
        'effect-no-unsafe-effect-type-assertion',
        'const narrowed = program as Effect.Effect<User, never, never>;',
      ),
    ).toHaveLength(1);
    expect(
      runRule(
        'effect-no-unsafe-effect-type-assertion',
        'const program: Effect.Effect<User, UserError, UserRepo> = loadUser;',
      ),
    ).toHaveLength(0);
  });

  it('reports service self mismatch and Effect.fn IIFEs', () => {
    expect(
      runRule(
        'effect-require-service-self-match',
        'class UserRepo extends Context.Tag("UserRepo")<OrderRepo, Service>() {}',
      ),
    ).toHaveLength(1);
    expect(
      runRule(
        'effect-require-service-self-match',
        'class UserRepo extends Context.Tag("UserRepo")<UserRepo, Service>() {}',
      ),
    ).toHaveLength(0);
    expect(
      runRule(
        'effect-no-effect-fn-iife',
        'const program = Effect.fn("load")(function* () { return yield* load; })();',
      ),
    ).toHaveLength(1);
    expect(
      runRule(
        'effect-no-effect-fn-iife',
        'export const load = Effect.fn("load")(function* () { return yield* repo.load; });',
      ),
    ).toHaveLength(0);
  });

  it('reports strict Effect-native platform and Schema style rules only in strict config', () => {
    const strictConfig = theThracianOxlint({ effect: { strict: true } });

    expect(
      runConfiguredRules(strictConfig, 'const id = crypto.randomUUID();').map(
        (report) => report.ruleName,
      ),
    ).toContain('effect-no-crypto-randomUUID');
    expect(
      runConfiguredRules(strictConfig, 'if (value instanceof UserSchema) { return value; }').map(
        (report) => report.ruleName,
      ),
    ).toContain('effect-require-schema-is-over-instanceof');
    expect(
      runConfiguredRules(
        strictConfig,
        'const User = Schema.Struct({ _tag: Schema.Literal("User") });',
      ).map((report) => report.ruleName),
    ).toContain('effect-prefer-schema-tagged-struct');
    expect(
      runConfiguredRules(
        strictConfig,
        'const Status = Schema.Union(Schema.Literal("open"), Schema.Literal("closed"));',
      ).map((report) => report.ruleName),
    ).toContain('effect-prefer-single-schema-literal-union');
    expect(
      runConfiguredRules(
        strictConfig,
        'const response = Effect.tryPromise({ try: () => fetch("/users"), catch: (error) => error });',
        'src/domain/http.ts',
      ).map((report) => report.ruleName),
    ).toContain('effect-no-global-fetch');
  });

  it('reports strict layer and style rules from the research gap matrix', () => {
    expect(
      runRule(
        'effect-require-deterministic-service-keys',
        'class UserRepo extends Context.Tag("Repo")<UserRepo, Service>() {}',
      ),
    ).toHaveLength(1);
    expect(
      runRule(
        'effect-require-deterministic-service-keys',
        'class UserRepo extends Context.Tag("UserRepo")<UserRepo, Service>() {}',
      ),
    ).toHaveLength(0);
    expect(
      runRule(
        'effect-no-multiple-provide-chain',
        'const program = effect.pipe(Effect.provide(UserLayer), Effect.provide(DbLayer));',
      ),
    ).toHaveLength(1);
    expect(
      runRule(
        'effect-require-layer-scoped-when-scope-required',
        'const Live = Layer.effect(UserRepo, Effect.gen(function* () { yield* Scope.Scope; return repo; }));',
      ),
    ).toHaveLength(1);
    expect(
      runRule(
        'effect-no-node-builtins-when-effect-platform-exists',
        'import { readFileSync } from "node:fs"; const text = readFileSync(path);',
      ),
    ).toHaveLength(1);
  });

  it('reports strict Effect style cleanup rules without conflicting with valid forms', () => {
    expect(
      runRule('effect-prefer-effect-void', 'const done = Effect.succeed(undefined);'),
    ).toHaveLength(1);
    expect(runRule('effect-prefer-effect-void', 'const done = Effect.void;')).toHaveLength(0);
    expect(
      runRule('effect-prefer-asVoid', 'const done = task.pipe(Effect.map(() => undefined));'),
    ).toHaveLength(1);
    expect(runRule('effect-prefer-asVoid', 'const done = task.pipe(Effect.asVoid);')).toHaveLength(
      0,
    );
    expect(
      runRule(
        'effect-prefer-flatMap-over-map-flatten',
        'const value = task.pipe(Effect.map(load), Effect.flatten);',
      ),
    ).toHaveLength(1);
    expect(
      runRule(
        'effect-prefer-flatMap-over-map-flatten',
        'const value = task.pipe(Effect.flatMap(load));',
      ),
    ).toHaveLength(0);
  });
});
