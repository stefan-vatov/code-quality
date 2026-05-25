import { describe, expect, it } from 'vitest';
import { runRule } from './effect-rule-test-utils';

describe('Effect cycle 10 regression coverage', () => {
  it('detects exported const block bodies that return Effect.gen', () => {
    const invalid = `
      export const loadUser = (id: string) => {
        return Effect.gen(function* () {
          return yield* UserRepo.load(id);
        });
      };
    `;

    expect(runRule('effect-no-function-returning-gen', invalid)).toHaveLength(1);
  });

  it('detects exported const block bodies that return raw Effect values', () => {
    const invalid = `
      export const loadUser = (id: string) => {
        return Effect.succeed(id);
      };
    `;

    expect(runRule('effect-prefer-effect-fn-for-exported-effects', invalid)).toHaveLength(1);
  });

  it('detects exported async const block bodies that hide runPromise', () => {
    const invalid = `
      export const loadUser = async (id: string) => {
        return Effect.runPromise(loadUserEffect(id));
      };
    `;

    expect(runRule('effect-no-runpromise-in-exported-api', invalid)).toHaveLength(1);
  });

  it('does not treat service method properties as resource allocation calls', () => {
    const source = 'Layer.effect(UserService, Effect.succeed({ openProfile }));';

    expect(runRule('effect-require-scoped-for-resource-layers', source)).toHaveLength(0);
  });

  it('keeps Array.forEach Effect detection inside the callback body', () => {
    const valid = `
      users.forEach((user) => user.id);
      const program = Effect.succeed(1);
    `;

    const invalid = `
      users.forEach((user) => Effect.succeed(user));
    `;

    expect(runRule('effect-no-effect-in-array-foreach', valid)).toHaveLength(0);
    expect(runRule('effect-no-effect-in-array-foreach', invalid)).toHaveLength(1);
  });

  it('keeps Promise callback Effect detection inside the callback body', () => {
    const valid = `
      promise.then((value) => value);
      const program = Effect.succeed(1);
    `;

    const invalid = `
      promise.then((value) => Effect.succeed(value));
    `;

    expect(runRule('effect-no-effect-in-promise-callback', valid)).toHaveLength(0);
    expect(runRule('effect-no-effect-in-promise-callback', invalid)).toHaveLength(1);
  });

  it('keeps fiber observation in the enclosing block when local helpers appear first', () => {
    const forked = `
      function first() {
        const fiber = yield* Effect.fork(worker);
        const helper = () => value;
        return yield* Fiber.join(fiber);
      }
    `;

    const runForked = `
      function first() {
        const fiber = Effect.runFork(program);
        const helper = () => value;
        fiber.addObserver(() => undefined);
      }
    `;

    expect(runRule('effect-no-floating-fiber', forked)).toHaveLength(0);
    expect(runRule('effect-no-runfork-without-observer', runForked)).toHaveLength(0);
  });
});
