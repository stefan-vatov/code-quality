import { describe, expect, it } from 'vitest';
import theThracianOxlint from '../../src/index';
import { effectStrictRuleNames } from '../../src/rules/effect-rule-names';
import { runConfiguredRules, runRule, strictEffectTestPaths } from './effect-rule-test-utils';

describe('Effect safety and strict rule coverage', () => {
  it('keeps strict architecture and style rules out of the default safety preset', () => {
    const config = theThracianOxlint();
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
      expect(config.rules).not.toHaveProperty(`thethracian/${ruleName}`);
    }
  });

  it('keeps selected strict rules error-only when explicitly enabled', () => {
    const defaultConfig = theThracianOxlint();
    const strictConfig = theThracianOxlint({
      effect: { strict: { ...strictEffectTestPaths, rules: effectStrictRuleNames } },
    });

    for (const ruleName of effectStrictRuleNames) {
      expect(defaultConfig.rules).not.toHaveProperty(`thethracian/${ruleName}`);
      const setting = strictConfig.rules?.[`thethracian/${ruleName}`];
      expect(Array.isArray(setting) ? setting[0] : setting).toBe('error');
    }
  });

  it('reports retained Effect safety hazards without broad JavaScript bans', () => {
    expect(
      runRule(
        'effect-require-typed-error-in-trypromise',
        'const task = Effect.tryPromise({ try: () => fetch("/users") });',
      ),
    ).toHaveLength(1);
    expect(runRule('effect-no-unbounded-queue', 'const queue = Queue.unbounded();')).toHaveLength(
      1,
    );
    expect(
      runRule(
        'effect-no-silent-error-swallowing',
        'const ignored = Effect.ignore(Effect.succeed(undefined));',
      ),
    ).toHaveLength(1);
  });

  it('reports schema boundary hazards through retained specialized analyzers', () => {
    expect(
      runRule(
        'effect-schema-require-parse-error-handling',
        'const user = Schema.decodeUnknown(User)(payload).pipe(Effect.orDie);',
      ),
    ).toHaveLength(1);
    expect(
      runRule(
        'effect-schema-use-decodeUnknown-for-external-data',
        'const user = Schema.decode(User)(response.json());',
      ),
    ).toHaveLength(1);
    expect(
      runRule(
        'effect-schema-use-decodeUnknown-for-external-data',
        'const user = Schema.decodeUnknown(User)(payload);',
      ),
    ).toHaveLength(0);
  });

  it('recognizes service self matching in the default compatibility rules', () => {
    expect(
      runRule(
        'effect-require-service-self-match',
        'class UserRepo extends Effect.Service<OrderRepo>()("UserRepo", {}) {}',
      ),
    ).toHaveLength(1);
    expect(
      runRule(
        'effect-require-service-self-match',
        'class UserRepo extends Effect.Service<UserRepo>()("UserRepo", {}) {}',
      ),
    ).toHaveLength(0);
  });

  it('reports strict Effect-native platform and Schema style rules only in strict config', () => {
    const strictConfig = theThracianOxlint({
      effect: { strict: { ...strictEffectTestPaths, rules: effectStrictRuleNames } },
    });

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
