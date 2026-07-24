import { describe, expect, it } from 'vitest';
import { hasRecursiveEffectWithoutSuspend } from '../../src/rules/effect-default-workflow-helpers';
import { runRule } from './effect-rule-test-utils';

interface RecursionCase {
  name: string;
  source: string;
}

const eagerRecursionCases: readonly RecursionCase[] = [
  {
    name: 'typed arrow return',
    source: `
      const loop = (remaining: number): Effect.Effect<number> => {
        Effect.succeed(undefined);
        return loop(remaining - 1);
      };
    `,
  },
  {
    name: 'generic typed arrow',
    source: `
      const loop = <Value>(value: Value): Effect.Effect<Value> => {
        Effect.succeed(undefined);
        return loop(value);
      };
    `,
  },
  {
    name: 'typed function return',
    source: `
      function loop(remaining: number): Effect.Effect<number> {
        Effect.succeed(undefined);
        return loop(remaining - 1);
      }
    `,
  },
  {
    name: 'generic typed function',
    source: `
      function loop<Value>(value: Value): Effect.Effect<Value> {
        Effect.succeed(undefined);
        return loop(value);
      }
    `,
  },
  {
    name: 'overload-adjacent implementation',
    source: `
      function loop(value: string): Effect.Effect<string>;
      function loop(value: number): Effect.Effect<number>;
      function loop(value: string | number): Effect.Effect<string | number> {
        Effect.succeed(undefined);
        return loop(value);
      }
    `,
  },
  {
    name: 'default parameter',
    source: `
      const loop = (remaining = loop(initial)): Effect.Effect<number> =>
        Effect.succeed(remaining);
    `,
  },
  {
    name: 'destructured typed parameter',
    source: `
      function loop({ head, tail }: State): Effect.Effect<Value> {
        Effect.succeed(head);
        return loop(tail);
      }
    `,
  },
];

const safeRecursionCases: readonly RecursionCase[] = [
  {
    name: 'flatMap continuation recursion',
    source: `
      function loop(remaining: number): Effect.Effect<number> {
        return Effect.flatMap(step, () => loop(remaining - 1));
      }
    `,
  },
  {
    name: 'map continuation recursion',
    source: `
      function loop(remaining: number) {
        return Effect.map(step, () => loop(remaining - 1));
      }
    `,
  },
  {
    name: 'Effect.gen continuation recursion',
    source: `
      function loop(remaining: number): Effect.Effect<number> {
        return Effect.gen(function* () {
          yield* step;
          return yield* loop(remaining - 1);
        });
      }
    `,
  },
  {
    name: 'Effect.fn continuation recursion',
    source: `
      const loop = Effect.fn("loop")(function* (remaining: number) {
        yield* step;
        return yield* loop(remaining - 1);
      });
    `,
  },
  {
    name: 'Effect.fnUntraced continuation recursion',
    source: `
      const loop = Effect.fnUntraced(function* (remaining: number) {
        yield* step;
        return yield* loop(remaining - 1);
      });
    `,
  },
  {
    name: 'bound recursive suspend thunk',
    source: `
      function loop(remaining: number): Effect.Effect<number> {
        return Effect.suspend(loop.bind(undefined, remaining - 1));
      }
    `,
  },
  {
    name: 'typed arrow suspended at construction boundary',
    source: `
      const loop = (remaining: number): Effect.Effect<number> =>
        Effect.flatMap(step, () => Effect.suspend(() => loop(remaining - 1)));
    `,
  },
  {
    name: 'generic function suspended at construction boundary',
    source: `
      function loop<Value>(value: Value): Effect.Effect<Value> {
        return Effect.flatMap(step, () => Effect.suspend(() => loop(value)));
      }
    `,
  },
  {
    name: 'async function recursion',
    source: `
      async function loop(): Promise<Value> {
        return Effect.flatMap(step, async () => loop());
      }
    `,
  },
  {
    name: 'async arrow recursion',
    source: `
      const loop = async (): Promise<Value> =>
        Effect.flatMap(step, async () => loop());
    `,
  },
  {
    name: 'generator recursion',
    source: `
      function* loop(): Generator<Effect.Effect<Value>> {
        yield Effect.gen(function* () { return yield* step; });
        yield* loop();
      }
    `,
  },
  {
    name: 'parameter shadows function declaration',
    source: `
      function loop(loop: () => Effect.Effect<Value>) {
        return Effect.flatMap(step, () => loop());
      }
    `,
  },
  {
    name: 'default parameter shadows function declaration',
    source: `
      function loop(loop = fallbackLoop) {
        return Effect.flatMap(step, () => loop());
      }
    `,
  },
  {
    name: 'destructured parameter shadows function declaration',
    source: `
      function loop({ loop }: Dependencies) {
        return Effect.flatMap(step, () => loop());
      }
    `,
  },
  {
    name: 'block-local constant shadows outer function',
    source: `
      function loop() {
        const loop = () => Effect.succeed(value);
        return Effect.flatMap(step, () => loop());
      }
    `,
  },
  {
    name: 'callback parameter shadows outer function',
    source: `
      function loop() {
        return Effect.flatMap(step, (loop) => loop());
      }
    `,
  },
  {
    name: 'nested function declaration shadows outer function',
    source: `
      function loop() {
        return Effect.gen(function* () {
          function loop() {
            return Effect.succeed(value);
          }
          return yield* loop();
        });
      }
    `,
  },
  {
    name: 'overloads with non-recursive implementation',
    source: `
      function loop(value: string): Effect.Effect<string>;
      function loop(value: number): Effect.Effect<number>;
      function loop(value: string | number): Effect.Effect<string | number> {
        return Effect.succeed(value);
      }
    `,
  },
  {
    name: 'ordinary recursive computation',
    source: `
      function factorial(value: number): number {
        return value <= 1 ? 1 : value * factorial(value - 1);
      }
    `,
  },
  {
    name: 'same-prefix helper call',
    source: `
      function loop() {
        return Effect.flatMap(step, () => loopLater());
      }
    `,
  },
  {
    name: 'comments and strings',
    source: `
      const docs = "function loop() { return Effect.flatMap(step, () => loop()); }";
      // const loop = () => Effect.gen(function* () { yield* loop(); });
    `,
  },
];

describe('hasRecursiveEffectWithoutSuspend declaration boundaries', (): void => {
  it.each(eagerRecursionCases)('detects eager recursion in $name', ({ source }): void => {
    expect(hasRecursiveEffectWithoutSuspend(source)).toBe(true);
  });

  it.each(safeRecursionCases)('accepts $name', ({ source }): void => {
    expect(hasRecursiveEffectWithoutSuspend(source)).toBe(false);
  });
});

describe('effect-require-suspend-for-recursion alias boundaries', (): void => {
  const aliasCases = [
    {
      eager: `
        import { Effect as Fx } from "effect";
        const loop = (value: number): Fx.Effect<number> => {
          Fx.succeed(undefined);
          return loop(value - 1);
        };
      `,
      name: 'aliased root Effect import',
      safe: `
        import { Effect as Fx } from "effect";
        const loop = (value: number): Fx.Effect<number> =>
          Fx.flatMap(step, () => loop(value - 1));
      `,
    },
    {
      eager: `
        import * as Fx from "effect/Effect";
        function loop<Value>(value: Value): Fx.Effect<Value> {
          Fx.succeed(undefined);
          return loop(value);
        }
      `,
      name: 'Effect module namespace',
      safe: `
        import * as Fx from "effect/Effect";
        function loop<Value>(value: Value): Fx.Effect<Value> {
          return Fx.flatMap(step, () => loop(value));
        }
      `,
    },
  ] as const;

  it.each(aliasCases)('canonicalizes $name', ({ eager, safe }): void => {
    expect(runRule('effect-require-suspend-for-recursion', eager)).toHaveLength(1);
    expect(runRule('effect-require-suspend-for-recursion', safe)).toHaveLength(0);
  });

  it('does not treat a local Effect homonym as the Effect API', (): void => {
    const source = `
      const Effect = localEffect;
      function loop() {
        return Effect.flatMap(step, () => loop());
      }
    `;
    expect(runRule('effect-require-suspend-for-recursion', source)).toHaveLength(0);
  });
});

describe('effect-require-suspend-for-recursion nested execution boundaries', (): void => {
  const deferredNestedCalls = [
    {
      name: 'ordinary recursion with an unrelated nested Effect helper',
      source: `
        import { Effect } from "effect";
        function factorial(value: number): number {
          function effectHelper() {
            return Effect.succeed(value);
          }
          void effectHelper;
          return value <= 1 ? 1 : value * factorial(value - 1);
        }
      `,
    },
    {
      name: 'self call returned through an arrow closure',
      source: `
        import { Effect } from "effect";
        function loop() {
          return Effect.succeed(() => loop());
        }
      `,
    },
    {
      name: 'self call returned through a function closure',
      source: `
        import { Effect } from "effect";
        function loop() {
          return Effect.succeed(function deferred() {
            return loop();
          });
        }
      `,
    },
    {
      name: 'self call behind a deep deferred closure chain',
      source: `
        import { Effect } from "effect";
        function loop() {
          return Effect.succeed(
            () => function levelTwo() {
              return () => function levelFour() {
                return loop();
              };
            },
          );
        }
      `,
    },
  ] as const;

  it.each(deferredNestedCalls)('accepts $name', ({ source }): void => {
    expect(runRule('effect-require-suspend-for-recursion', source)).toHaveLength(0);
  });

  it('analyzes an eager nested Effect declaration independently from its outer declaration', (): void => {
    const source = `
      import { Effect } from "effect";
      function outer() {
        function loop(remaining: number): Effect.Effect<number> {
          Effect.succeed(undefined);
          return loop(remaining - 1);
        }
        return loop(10);
      }
    `;
    expect(runRule('effect-require-suspend-for-recursion', source)).toHaveLength(1);
  });

  const eagerImmediateCalls = [
    {
      name: 'an arrow IIFE',
      source: `
        import { Effect } from "effect";
        function loop() {
          return Effect.succeed((() => loop())());
        }
      `,
    },
    {
      name: 'a function-expression IIFE',
      source: `
        import { Effect } from "effect";
        function loop() {
          return Effect.succeed((function recurseNow() {
            return loop();
          })());
        }
      `,
    },
    {
      name: 'a deep IIFE chain',
      source: `
        import { Effect } from "effect";
        function loop() {
          return Effect.succeed(
            (() => (() => (function recurseNow() {
              return loop();
            })())())(),
          );
        }
      `,
    },
  ] as const;

  it.each(eagerImmediateCalls)('reports eager recursion through $name', ({ source }): void => {
    expect(runRule('effect-require-suspend-for-recursion', source)).toHaveLength(1);
  });
});
