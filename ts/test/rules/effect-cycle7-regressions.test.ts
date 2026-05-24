import { describe, expect, it } from 'vitest';
import { runAllRules, runRule } from './effect-rule-test-utils.js';

function reportedEffectRules(source: string, filename = 'src/domain/user.ts'): string[] {
  return runAllRules(source, filename)
    .map((report) => report.ruleName)
    .filter((ruleName): ruleName is string => Boolean(ruleName?.startsWith('effect-')));
}

describe('Effect cycle 7 regression coverage', () => {
  it('allows pipeable scoped acquireRelease resources', () => {
    const source = 'Effect.acquireRelease(openConnection, closeConnection).pipe(Effect.scoped);';

    expect(runRule('effect-require-scoped-for-acquireRelease', source)).toHaveLength(0);
  });

  it('keeps exported API checks inside the exported declaration body', () => {
    const source = `
      export function healthCheck() {
        return "ok";
      }

      function localProgram() {
        return Effect.gen(function* () {
          return yield* loadUser;
        });
      }

      function runLocal() {
        return Effect.runPromise(localProgram());
      }
    `;

    expect(runRule('effect-no-function-returning-gen', source)).toHaveLength(0);
    expect(runRule('effect-no-runpromise-in-exported-api', source)).toHaveLength(0);
  });

  it('accepts data-first timeout and retry wrappers around external calls', () => {
    expect(
      runRule(
        'effect-require-timeout-on-external-effects',
        'const response = Effect.timeout(HttpClient.get(url), Duration.seconds(5));',
      ),
    ).toHaveLength(0);
    expect(
      runRule(
        'effect-require-retry-policy-for-idempotent-external-effects',
        'const response = Effect.retry(HttpClient.get(url), policy);',
      ),
    ).toHaveLength(0);
  });

  it('keeps fiber observation inside the same function body', () => {
    const floatingFork = `
      function first() {
        const fiber = yield* Effect.fork(worker);
      }

      function second() {
        return yield* Fiber.join(fiber);
      }
    `;

    const floatingRunFork = `
      function first() {
        const fiber = Effect.runFork(program);
      }

      function second() {
        return Fiber.interrupt(fiber);
      }
    `;

    expect(runRule('effect-no-floating-fiber', floatingFork)).toHaveLength(1);
    expect(runRule('effect-no-runfork-without-observer', floatingRunFork)).toHaveLength(1);
  });

  it('does not treat service method names as resource allocation', () => {
    const source = 'Layer.effect(UserService, Effect.succeed({ openProfile: () => profile }));';

    expect(runRule('effect-require-scoped-for-resource-layers', source)).toHaveLength(0);
  });

  it('does not duplicate legacy Context.Tag diagnostics across buckets', () => {
    const source = 'const UserRepo = Context.Tag<UserRepo>("UserRepo");';

    expect(reportedEffectRules(source)).toStrictEqual([
      'effect-no-deprecated-context-tag-function',
    ]);
  });
});
