import { describe, expect, it } from 'vitest';
import { runRule } from './effect-rule-test-utils';

describe('Effect cycle 8 regression coverage', (): void => {
  it('treats recursion inside Effect.gen as a deferred continuation', (): void => {
    const valid = `
      function loadUser() {
        return Effect.gen(function* () {
          return yield* getUser();
        });
      }
    `;

    const recursive = `
      function loadUser(id) {
        return Effect.gen(function* () {
          return yield* loadUser(id);
        });
      }
    `;

    expect(runRule('effect-require-suspend-for-recursion', valid)).toHaveLength(0);
    expect(runRule('effect-require-suspend-for-recursion', recursive)).toHaveLength(0);
  });

  it('does not let resource detection span from an unrelated Effect into acquireRelease', (): void => {
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

  it('does not let resource detection span from one Layer.effect into a scoped layer', (): void => {
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
});
