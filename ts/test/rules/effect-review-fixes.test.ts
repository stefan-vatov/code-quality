import { describe, expect, it } from 'vitest';
import theThracianOxlint from '../../src/index';
import { effectStrictRuleNames } from '../../src/rules/effect-rule-names';
import { runConfiguredRules, runRule, strictEffectTestPaths } from './effect-rule-test-utils';

describe('Effect review fix regressions', () => {
  it('recognizes aliased Effect imports for default and strict rules', () => {
    expect(
      runRule('effect-no-floating-effect', 'import { Effect as E } from "effect";\nE.succeed(1);'),
    ).toHaveLength(1);
    expect(
      runRule(
        'effect-require-platform-runmain-at-entrypoints',
        'import * as E from "effect/Effect";\nE.runPromise(program);',
        'src/main.ts',
      ),
    ).toHaveLength(1);
  });

  it('recognizes current Effect.Service self and key declarations', () => {
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
    expect(
      runRule(
        'effect-require-deterministic-service-keys',
        'class UserRepo extends Effect.Service<UserRepo>()("Repo", {}) {}',
      ),
    ).toHaveLength(1);
    expect(
      runRule(
        'effect-require-deterministic-service-keys',
        'class UserRepo extends Effect.Service<UserRepo>()("UserRepo", {}) {}',
      ),
    ).toHaveLength(0);
  });

  it('keeps AST-converted rules as broad as their source-backed contracts', () => {
    expect(
      runRule(
        'effect-prefer-effect-void',
        'import { Effect } from "effect";\nconst done = Effect.succeed(void 0);',
      ),
    ).toHaveLength(1);
  });

  it('assigns fetch ownership to one strict rule without adapter inversion', () => {
    const strictConfig = theThracianOxlint({
      effect: { strict: { ...strictEffectTestPaths, rules: effectStrictRuleNames } },
    });
    expect(
      runConfiguredRules(
        strictConfig,
        'const program = Effect.tryPromise({ try: () => fetch(url), catch: toError });',
        'src/domain/user.ts',
      ).map((report) => report.ruleName),
    ).toContain('effect-no-global-fetch');
    expect(
      runConfiguredRules(strictConfig, 'const response = fetch(url);', 'src/domain/user.ts').map(
        (report) => report.ruleName,
      ),
    ).toContain('effect-no-direct-http-fs-outside-platform-services');
    expect(
      runRule(
        'effect-no-global-fetch',
        'const program = Effect.tryPromise({ try: () => fetch(url), catch: toError });',
        'src/adapters/http.ts',
      ),
    ).toHaveLength(0);
    expect(
      runRule('effect-no-global-fetch', 'const response = fetch(url);', 'src/adapters/http.ts'),
    ).toHaveLength(0);
  });

  it('honors adapter and config path allowances consistently', () => {
    expect(
      runRule(
        'effect-no-node-builtins-when-effect-platform-exists',
        'import { readFileSync } from "node:fs";\nconst text = readFileSync(path);',
        'src/adapters/file-system.ts',
      ),
    ).toHaveLength(0);
    expect(
      runRule(
        'effect-no-node-builtins-when-effect-platform-exists',
        'import { readFileSync } from "node:fs";\nconst text = readFileSync(path);',
        'src/domain/user.ts',
      ),
    ).toHaveLength(1);
    expect(
      runRule(
        'effect-no-direct-process-env-outside-config-layer',
        'process.env.API_TOKEN;',
        'src/config/env.ts',
      ),
    ).toHaveLength(0);
  });

  it('handles aliases and tagged object keys without losing Effect coverage', () => {
    expect(
      runRule(
        'effect-prefer-effect-void',
        'import { succeed as ok } from "effect/Effect";\nconst done = ok(undefined);',
      ),
    ).toHaveLength(1);
    expect(
      runRule(
        'effect-prefer-schema-tagged-struct',
        'import { Schema as S } from "effect";\nconst User = S.Struct({ _tag: S.Literal("User") });',
      ),
    ).toHaveLength(1);
    expect(
      runRule(
        'effect-prefer-single-schema-literal-union',
        'import { Schema as S } from "effect";\nconst Status = S.Union(S.Literal("A"), S.Literal("B"));',
      ),
    ).toHaveLength(1);
  });

  it('does not apply Effect policies as broad JavaScript bans', () => {
    expect(
      runRule(
        'effect-require-schema-is-over-instanceof',
        'if (error instanceof TypeError) { throw error; }',
      ),
    ).toHaveLength(0);
    expect(theThracianOxlint().rules).not.toHaveProperty(
      'thethracian/effect-no-expected-error-as-defect',
    );
  });
});
