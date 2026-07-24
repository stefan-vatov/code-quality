import { describe, expect, it } from 'vitest';
import { runRule } from './effect-rule-test-utils';

interface SourceCase {
  name: string;
  source: string;
}

const runRecursionRule = (source: string): number =>
  runRule('effect-require-suspend-for-recursion', source).length;

const eagerCombinatorCases: readonly SourceCase[] = [
  {
    name: 'root flatMapEager success continuation',
    source: `
      import { Effect } from "effect";
      function loop() {
        return Effect.flatMapEager(Effect.succeed(1), () => loop());
      }
    `,
  },
  {
    name: 'aliased-root mapEager success mapper',
    source: `
      import { Effect as Fx } from "effect";
      function loop() {
        return Fx.mapEager(Fx.succeed(1), () => loop());
      }
    `,
  },
  {
    name: 'named catchEager failure handler',
    source: `
      import { catchEager as recoverNow, fail } from "effect/Effect";
      function loop() {
        return recoverNow(fail("retry"), () => loop());
      }
    `,
  },
  {
    name: 'module-namespace matchCauseEffectEager success handler',
    source: `
      import * as Fx from "effect/Effect";
      function loop() {
        return Fx.matchCauseEffectEager(Fx.succeed(1), {
          onFailure: () => Fx.fail("failed"),
          onSuccess: () => loop(),
        });
      }
    `,
  },
  {
    name: 'named matchCauseEffectEager failure handler',
    source: `
      import {
        fail,
        matchCauseEffectEager as matchNow,
        succeed,
      } from "effect/Effect";
      function loop() {
        return matchNow(fail("retry"), {
          onFailure: () => loop(),
          onSuccess: () => succeed(1),
        });
      }
    `,
  },
  {
    name: 'curried flatMapEager continuation',
    source: `
      import { Effect } from "effect";
      function loop() {
        return Effect.flatMapEager(() => loop())(Effect.succeed(1));
      }
    `,
  },
  {
    name: 'root fnUntracedEager generator',
    source: `
      import { Effect } from "effect";
      const loop = Effect.fnUntracedEager(function* () {
        yield* Effect.succeed(undefined);
        return yield* loop();
      });
    `,
  },
  {
    name: 'named fnUntracedEager generator',
    source: `
      import {
        fnUntracedEager as eagerEffect,
        succeed,
      } from "effect/Effect";
      const loop = eagerEffect(function* () {
        yield* succeed(undefined);
        return yield* loop();
      });
    `,
  },
];

const lazyCombinatorControls: readonly SourceCase[] = [
  {
    name: 'v3 root flatMap continuation',
    source: `
      import { Effect } from "effect";
      function loop() {
        return Effect.flatMap(Effect.succeed(1), () => loop());
      }
    `,
  },
  {
    name: 'v3 aliased-root map continuation',
    source: `
      import { Effect as Fx } from "effect";
      function loop() {
        return Fx.map(Fx.succeed(1), () => loop());
      }
    `,
  },
  {
    name: 'v4 named catch handler',
    source: `
      import { catch as recover, fail } from "effect/Effect";
      function loop() {
        return recover(fail("retry"), () => loop());
      }
    `,
  },
  {
    name: 'v4 module-namespace matchCauseEffect handler',
    source: `
      import * as Fx from "effect/Effect";
      function loop() {
        return Fx.matchCauseEffect(Fx.succeed(1), {
          onFailure: () => Fx.fail("failed"),
          onSuccess: () => loop(),
        });
      }
    `,
  },
  {
    name: 'v3 Effect.gen continuation',
    source: `
      import { Effect } from "effect";
      function loop() {
        return Effect.gen(function* () {
          yield* Effect.succeed(undefined);
          return yield* loop();
        });
      }
    `,
  },
  {
    name: 'v4 named fnUntraced generator',
    source: `
      import { fnUntraced, succeed } from "effect/Effect";
      const loop = fnUntraced(function* () {
        yield* succeed(undefined);
        return yield* loop();
      });
    `,
  },
];

describe('Effect v4 eager recursion phases', (): void => {
  it.each(eagerCombinatorCases)('reports $name exactly once', ({ source }): void => {
    expect(runRecursionRule(source)).toBe(1);
  });

  it.each(lazyCombinatorControls)('accepts lazy $name', ({ source }): void => {
    expect(runRecursionRule(source)).toBe(0);
  });
});

describe('executed helper default parameters', (): void => {
  it('does not execute a recursive default when its argument is supplied', (): void => {
    const source = `
      import { Effect } from "effect";
      function loop() {
        const recurseNow = (value = loop()) => Effect.succeed(value);
        return recurseNow(Effect.succeed(1));
      }
    `;

    expect(runRecursionRule(source)).toBe(0);
  });

  it('executes a recursive default when its argument is omitted', (): void => {
    const source = `
      import { Effect } from "effect";
      function loop() {
        const recurseNow = (value = loop()) => Effect.succeed(value);
        return recurseNow();
      }
    `;

    expect(runRecursionRule(source)).toBe(1);
  });

  it('executes a recursive default when its argument is void', (): void => {
    const source = `
      import { Effect } from "effect";
      function loop() {
        const recurseNow = (value = loop()) => Effect.succeed(value);
        return recurseNow(void 0);
      }
    `;

    expect(runRecursionRule(source)).toBe(1);
  });
});

describe('block-scoped local helper resolution', (): void => {
  it('resolves an invoked recursive helper before a same-named sibling helper', (): void => {
    const source = `
      import { Effect } from "effect";
      function loop() {
        let result = Effect.succeed(0);
        {
          const recurseNow = () => loop();
          result = Effect.succeed(recurseNow());
        }
        {
          const recurseNow = () => Effect.succeed(1);
          void recurseNow;
        }
        return result;
      }
    `;

    expect(runRecursionRule(source)).toBe(1);
  });

  it('does not resolve an invoked safe helper to an uninvoked sibling homonym', (): void => {
    const source = `
      import { Effect } from "effect";
      function loop() {
        let result = Effect.succeed(0);
        {
          const recurseNow = () => Effect.succeed(1);
          result = recurseNow();
        }
        {
          const recurseNow = () => loop();
          void recurseNow;
        }
        return result;
      }
    `;

    expect(runRecursionRule(source)).toBe(0);
  });
});

describe('executed helper aliases', (): void => {
  it('follows an invoked alias to a recursive local helper', (): void => {
    const source = `
      import { Effect } from "effect";
      function loop() {
        const recurseNow = () => loop();
        const alias = recurseNow;
        return Effect.succeed(alias());
      }
    `;

    expect(runRecursionRule(source)).toBe(1);
  });

  it('follows a multi-hop alias to a recursive local helper', (): void => {
    const source = `
      import { Effect } from "effect";
      function loop() {
        const recurseNow = () => loop();
        const firstAlias = recurseNow;
        const secondAlias = firstAlias;
        return Effect.succeed(secondAlias());
      }
    `;

    expect(runRecursionRule(source)).toBe(1);
  });

  it('keeps an invoked safe helper alias non-recursive', (): void => {
    const source = `
      import { Effect } from "effect";
      function loop() {
        const makeValue = () => Effect.succeed(1);
        const alias = makeValue;
        return alias();
      }
    `;

    expect(runRecursionRule(source)).toBe(0);
  });
});

describe('direct named Effect.suspend thunks', (): void => {
  it('reports direct recursion in an aliased-root named thunk', (): void => {
    const source = `
      import { Effect as Fx } from "effect";
      const task = Fx.suspend(function recurseNow() {
        return recurseNow();
      });
    `;

    expect(runRecursionRule(source)).toBe(1);
  });

  it('reports direct recursion through a named suspend import alias', (): void => {
    const source = `
      import { suspend as defer } from "effect/Effect";
      const task = defer(function recurseNow() {
        return recurseNow();
      });
    `;

    expect(runRecursionRule(source)).toBe(1);
  });

  it('accepts outer recursion deferred by a named suspend thunk', (): void => {
    const source = `
      import { Effect } from "effect";
      function loop() {
        return Effect.suspend(function recurseLater() {
          return loop();
        });
      }
    `;

    expect(runRecursionRule(source)).toBe(0);
  });
});
