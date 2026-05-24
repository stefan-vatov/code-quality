import { describe, expect, it } from 'vitest';
import { runRule } from './effect-rule-test-utils.js';

describe('Effect cycle 8 regression coverage', () => {
  it('does not treat ordinary helper calls inside Effect.gen as recursive construction', () => {
    const valid = `
      function loadUser() {
        return Effect.gen(function* () {
          return yield* getUser();
        });
      }
    `;

    const invalid = `
      function loadUser(id) {
        return Effect.gen(function* () {
          return yield* loadUser(id);
        });
      }
    `;

    expect(runRule('effect-require-suspend-for-recursion', valid)).toHaveLength(0);
    expect(runRule('effect-require-suspend-for-recursion', invalid)).toHaveLength(1);
  });

  it('does not let resource detection span from an unrelated Effect into acquireRelease', () => {
    const valid = `
      const pure = Effect.sync(() => value);
      const managed = Effect.acquireRelease(
        Effect.sync(() => openConnection()),
        closeConnection
      );
    `;

    const invalid = 'const raw = Effect.sync(() => openConnection());';

    expect(runRule('effect-require-acquire-release', valid)).toHaveLength(0);
    expect(runRule('effect-require-acquire-release', invalid)).toHaveLength(1);
  });

  it('does not let resource detection span from one Layer.effect into a scoped layer', () => {
    const valid = `
      const PureLayer = Layer.effect(Service, Effect.succeed(service));
      const ScopedLayer = Layer.scoped(
        SocketService,
        Effect.sync(() => openSocket())
      );
    `;

    const invalid =
      'const UnsafeLayer = Layer.effect(SocketService, Effect.sync(() => openSocket()));';

    expect(runRule('effect-require-scoped-for-resource-layers', valid)).toHaveLength(0);
    expect(runRule('effect-require-scoped-for-resource-layers', invalid)).toHaveLength(1);
  });

  it('flags naked millisecond durations in both unary and binary Effect duration APIs', () => {
    const unary = 'const delayed = Effect.sleep(1000);';
    const binaryTimeout = 'const timed = Effect.timeout(request, 1000);';
    const binaryDelay = 'const delayed = Effect.delay(request, 1000);';
    const valid = 'const timed = Effect.timeout(request, Duration.seconds(1));';

    expect(runRule('effect-use-duration-constructors', unary)).toHaveLength(1);
    expect(runRule('effect-use-duration-constructors', binaryTimeout)).toHaveLength(1);
    expect(runRule('effect-use-duration-constructors', binaryDelay)).toHaveLength(1);
    expect(runRule('effect-use-duration-constructors', valid)).toHaveLength(0);
  });

  it('detects Effect values created in function-form Array.forEach callbacks', () => {
    const invalid = `
      users.forEach(function (user) {
        return Effect.succeed(user);
      });
    `;

    const valid = `
      Effect.forEach(users, function (user) {
        return Effect.succeed(user);
      });
    `;

    expect(runRule('effect-no-effect-in-array-foreach', invalid)).toHaveLength(1);
    expect(runRule('effect-no-effect-in-array-foreach', valid)).toHaveLength(0);
  });

  it('detects Effect values created in function-form Promise callbacks', () => {
    const invalid = `
      promise.then(function (value) {
        return Effect.succeed(value);
      });
    `;

    const valid = 'const program = Effect.tryPromise({ try: () => promise, catch: toError });';

    expect(runRule('effect-no-effect-in-promise-callback', invalid)).toHaveLength(1);
    expect(runRule('effect-no-effect-in-promise-callback', valid)).toHaveLength(0);
  });

  it('detects function-form Effect.sync wrappers around Promise and throwing code', () => {
    const promiseInvalid = `
      const task = Effect.sync(function () {
        return fetch("/users");
      });
    `;
    const throwingInvalid = `
      const task = Effect.sync(function () {
        return JSON.parse(payload);
      });
    `;

    expect(runRule('effect-no-sync-for-promise', promiseInvalid)).toHaveLength(1);
    expect(runRule('effect-no-sync-for-throwing-ops', throwingInvalid)).toHaveLength(1);
  });
});
