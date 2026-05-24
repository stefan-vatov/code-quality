import { describe, expect, it } from 'vitest';
import theThracianOxlint from '../../src/index.js';
import { runConfiguredRules, runRule } from './effect-rule-test-utils.js';

describe('Effect review fix regressions', () => {
  it('recognizes aliased Effect imports for default and strict rules', () => {
    expect(
      runRule('effect-no-floating-effect', 'import { Effect as E } from "effect";\nE.succeed(1);'),
    ).toHaveLength(1);
    expect(
      runRule(
        'effect-no-runpromise-in-exported-api',
        'import { Effect as E } from "effect";\nexport const load = () => E.runPromise(program);',
      ),
    ).toHaveLength(1);
    expect(
      runRule(
        'effect-require-platform-runmain-at-entrypoints',
        'import * as E from "effect/Effect";\nE.runPromise(program);',
        'src/main.ts',
      ),
    ).toHaveLength(1);
  });

  it('does not treat type-only imports or local Effect values as Effect modules', () => {
    expect(
      runRule(
        'effect-no-process-env-in-effect-code',
        'import type { Effect } from "effect";\nconst token = process.env.API_TOKEN;',
      ),
    ).toHaveLength(0);
    expect(
      runRule(
        'effect-no-console-log-in-effect-code',
        'import { Option } from "effect";\nconsole.log(Option.some(1));',
      ),
    ).toHaveLength(0);
    expect(
      runRule(
        'effect-no-console-log-in-effect-code',
        'import { type Effect } from "effect";\nconsole.log(1);',
      ),
    ).toHaveLength(0);
    expect(
      runRule(
        'effect-no-console-log-in-effect-code',
        'const Effect = { x: 1 };\nconsole.log(Effect.x);',
      ),
    ).toHaveLength(0);
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

  it('only reports try catch that is actually inside an Effect.gen body', () => {
    expect(
      runRule(
        'effect-no-try-catch-in-effect-gen',
        'const program = Effect.gen(function* () { return yield* load; });\ntry { recover(); } catch (error) { report(error); }',
      ),
    ).toHaveLength(0);
    expect(
      runRule(
        'effect-no-try-catch-in-effect-gen',
        'const program = Effect.gen(function* () { try { return yield* load; } catch (error) { return yield* Effect.fail(error); } });',
      ),
    ).toHaveLength(1);
  });

  it('keeps AST-converted rules as broad as their source-backed contracts', () => {
    expect(
      runRule(
        'effect-no-string-errors',
        'import { Effect } from "effect";\nconst failed = Effect.fail(`not found`);',
      ),
    ).toHaveLength(1);
    expect(
      runRule(
        'effect-no-try-catch-in-effect-gen',
        'import { Effect as E } from "effect";\nconst program = E.gen(function* () { try { return yield* load; } catch (error) { return yield* E.fail(error); } });',
      ),
    ).toHaveLength(1);
    expect(
      runRule(
        'effect-prefer-effect-void',
        'import { Effect } from "effect";\nconst done = Effect.succeed(void 0);',
      ),
    ).toHaveLength(1);
  });

  it('assigns fetch ownership to one strict rule without adapter inversion', () => {
    const strictConfig = theThracianOxlint({ effect: { strict: true } });
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
        'effect-no-process-env-in-effect-code',
        'import { Effect } from "effect";\nconst config = Effect.sync(() => process.env.API_TOKEN);',
        'src/config/env.ts',
      ),
    ).toHaveLength(0);
    expect(
      runRule(
        'effect-no-date-now-in-effect-code',
        'import { Effect } from "effect";\nconst now = Effect.sync(() => Date.now());',
        'src/adapters/clock.ts',
      ),
    ).toHaveLength(0);
  });

  it('handles aliases and tagged object keys without losing Effect coverage', () => {
    expect(
      runRule(
        'effect-no-string-errors',
        'import { fail as failEffect } from "effect/Effect";\nconst failed = failEffect("bad");',
      ),
    ).toHaveLength(1);
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
    expect(
      runRule(
        'effect-no-untagged-errors',
        'import { Effect } from "effect";\nconst failure = Effect.fail({ "_tag": "Oops" });',
      ),
    ).toHaveLength(0);
  });

  it('does not apply Effect policies as broad JavaScript bans', () => {
    expect(
      runRule('effect-no-new-promise', 'const task = new Promise(resolve => resolve(1));'),
    ).toHaveLength(0);
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
