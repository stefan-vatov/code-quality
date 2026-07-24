import { describe, expect, it } from 'vitest';
import { runRule } from './effect-rule-test-utils';

interface SourceCase {
  name: string;
  source: string;
}

const promiseImmediateInvocationCases: readonly SourceCase[] = [
  {
    name: 'an async arrow IIFE',
    source: `
      import { Effect } from "effect";
      const task = Effect.sync(() => (async () => user)());
    `,
  },
  {
    name: 'an async function-expression IIFE',
    source: `
      import { Effect } from "effect";
      const task = Effect.sync(() => (async function loadUser() {
        return user;
      })());
    `,
  },
  {
    name: 'an arrow IIFE invoked through call',
    source: `
      import { Effect } from "effect";
      const task = Effect.sync(() =>
        (() => Promise.resolve(user)).call(undefined),
      );
    `,
  },
  {
    name: 'a function-expression IIFE invoked through apply',
    source: `
      import { Effect } from "effect";
      const task = Effect.sync(() =>
        (function loadUser() {
          return fetch("/users/1");
        }).apply(undefined, []),
      );
    `,
  },
  {
    name: 'an async arrow IIFE invoked through bind',
    source: `
      import { Effect } from "effect";
      const task = Effect.sync(() => (async () => user).bind(undefined)());
    `,
  },
];

const promiseEagerHelperCases: readonly SourceCase[] = [
  {
    name: 'an invoked arrow default parameter',
    source: `
      import { Effect } from "effect";
      const task = Effect.sync(() =>
        ((value = Promise.resolve(user)) => value)(),
      );
    `,
  },
  {
    name: 'an invoked function-expression default parameter',
    source: `
      import { Effect } from "effect";
      const task = Effect.sync(() =>
        (function load(value = fetch("/users/1")) {
          return value;
        })(),
      );
    `,
  },
  {
    name: 'an invoked local function body',
    source: `
      import { Effect } from "effect";
      const task = Effect.sync(() => {
        function loadUser() {
          return Promise.resolve(user);
        }
        return loadUser();
      });
    `,
  },
  {
    name: 'an invoked local arrow default parameter',
    source: `
      import { Effect } from "effect";
      const task = Effect.sync(() => {
        const loadUser = (value = Promise.resolve(user)) => value;
        return loadUser();
      });
    `,
  },
];

const promiseDeferredControlCases: readonly SourceCase[] = [
  {
    name: 'an uninvoked arrow default parameter',
    source: `
      import { Effect } from "effect";
      const makeTask = Effect.sync(() =>
        (value = Promise.resolve(user)) => value,
      );
    `,
  },
  {
    name: 'an uninvoked local helper body',
    source: `
      import { Effect } from "effect";
      const makeTask = Effect.sync(() => {
        function loadUser() {
          return Promise.resolve(user);
        }
        return loadUser;
      });
    `,
  },
  {
    name: 'a bound async helper that is not called',
    source: `
      import { Effect } from "effect";
      const makeTask = Effect.sync(() =>
        (async () => user).bind(undefined),
      );
    `,
  },
];

const recursionImmediateInvocationCases: readonly SourceCase[] = [
  {
    name: 'an arrow invoked through call',
    source: `
      import { Effect } from "effect";
      function loop() {
        return Effect.succeed((() => loop()).call(undefined));
      }
    `,
  },
  {
    name: 'a function expression invoked through apply',
    source: `
      import { Effect } from "effect";
      function loop() {
        return Effect.succeed(
          (function recurseNow() {
            return loop();
          }).apply(undefined, []),
        );
      }
    `,
  },
  {
    name: 'an arrow invoked through bind',
    source: `
      import { Effect } from "effect";
      function loop() {
        return Effect.succeed((() => loop()).bind(undefined)());
      }
    `,
  },
];

const recursionEagerHelperCases: readonly SourceCase[] = [
  {
    name: 'an invoked arrow default parameter',
    source: `
      import { Effect } from "effect";
      function loop() {
        return Effect.succeed(((value = loop()) => value)());
      }
    `,
  },
  {
    name: 'an invoked local helper body',
    source: `
      import { Effect } from "effect";
      function loop() {
        function recurseNow() {
          return loop();
        }
        return Effect.succeed(recurseNow());
      }
    `,
  },
  {
    name: 'an invoked local helper default parameter',
    source: `
      import { Effect } from "effect";
      function loop() {
        const recurseNow = (value = loop()) => value;
        return Effect.succeed(recurseNow());
      }
    `,
  },
];

const recursionDeferredControlCases: readonly SourceCase[] = [
  {
    name: 'an uninvoked arrow default parameter',
    source: `
      import { Effect } from "effect";
      function loop() {
        return Effect.succeed((value = loop()) => value);
      }
    `,
  },
  {
    name: 'an uninvoked local helper body',
    source: `
      import { Effect } from "effect";
      function loop() {
        function recurseLater() {
          return loop();
        }
        return Effect.succeed(recurseLater);
      }
    `,
  },
  {
    name: 'a bound recursive helper that is not called',
    source: `
      import { Effect } from "effect";
      function loop() {
        return Effect.succeed((() => loop()).bind(undefined));
      }
    `,
  },
];

describe('effect-no-sync-for-promise execution boundaries', (): void => {
  it.each(promiseImmediateInvocationCases)('reports $name exactly once', ({ source }): void => {
    expect(runRule('effect-no-sync-for-promise', source)).toHaveLength(1);
  });

  it.each(promiseEagerHelperCases)('reports $name exactly once', ({ source }): void => {
    expect(runRule('effect-no-sync-for-promise', source)).toHaveLength(1);
  });

  it.each(promiseDeferredControlCases)('accepts $name', ({ source }): void => {
    expect(runRule('effect-no-sync-for-promise', source)).toHaveLength(0);
  });
});

describe('effect-require-suspend-for-recursion execution boundaries', (): void => {
  it.each(recursionImmediateInvocationCases)(
    'reports eager recursion through $name exactly once',
    ({ source }): void => {
      expect(runRule('effect-require-suspend-for-recursion', source)).toHaveLength(1);
    },
  );

  it.each(recursionEagerHelperCases)(
    'reports eager recursion through $name exactly once',
    ({ source }): void => {
      expect(runRule('effect-require-suspend-for-recursion', source)).toHaveLength(1);
    },
  );

  it.each(recursionDeferredControlCases)('accepts $name', ({ source }): void => {
    expect(runRule('effect-require-suspend-for-recursion', source)).toHaveLength(0);
  });

  it('reports recursion used to construct the Effect.suspend thunk argument', (): void => {
    const source = `
      import { Effect } from "effect";
      function loop() {
        return Effect.suspend(makeThunk(loop()));
      }
    `;

    expect(runRule('effect-require-suspend-for-recursion', source)).toHaveLength(1);
  });

  it('reports an eager IIFE used to construct the Effect.suspend thunk', (): void => {
    const source = `
      import { Effect } from "effect";
      function loop() {
        return Effect.suspend((() => loop())());
      }
    `;

    expect(runRule('effect-require-suspend-for-recursion', source)).toHaveLength(1);
  });

  it('accepts recursion inside the actual Effect.suspend thunk body', (): void => {
    const source = `
      import { Effect } from "effect";
      function loop() {
        return Effect.suspend(() => loop());
      }
    `;

    expect(runRule('effect-require-suspend-for-recursion', source)).toHaveLength(0);
  });

  it('accepts a recursive default parameter inside the actual Effect.suspend thunk', (): void => {
    const source = `
      import { Effect } from "effect";
      function loop() {
        return Effect.suspend((value = loop()) => Effect.succeed(value));
      }
    `;

    expect(runRule('effect-require-suspend-for-recursion', source)).toHaveLength(0);
  });

  it('reports a same-named function expression exactly once', (): void => {
    const source = `
      import { Effect } from "effect";
      const loop = function loop() {
        Effect.succeed(undefined);
        return loop();
      };
    `;

    expect(runRule('effect-require-suspend-for-recursion', source)).toHaveLength(1);
  });

  it('reports recursion through a distinct function-expression name exactly once', (): void => {
    const source = `
      import { Effect } from "effect";
      const task = function loop() {
        Effect.succeed(undefined);
        return loop();
      };
    `;

    expect(runRule('effect-require-suspend-for-recursion', source)).toHaveLength(1);
  });

  it('accepts a suspended named function expression', (): void => {
    const source = `
      import { Effect } from "effect";
      const loop = function loop() {
        return Effect.flatMap(step, () => Effect.suspend(() => loop()));
      };
    `;

    expect(runRule('effect-require-suspend-for-recursion', source)).toHaveLength(0);
  });

  it('accepts immediate invocation inside a deferred flatMap continuation', (): void => {
    const source = `
      import { Effect } from "effect";
      function loop() {
        return Effect.flatMap(step, () => (() => loop()).call(undefined));
      }
    `;

    expect(runRule('effect-require-suspend-for-recursion', source)).toHaveLength(0);
  });

  it('reports direct recursion inside a named Effect.suspend thunk', (): void => {
    const source = `
      import { Effect } from "effect";
      const task = Effect.suspend(function recur() {
        return recur();
      });
    `;

    expect(runRule('effect-require-suspend-for-recursion', source)).toHaveLength(1);
  });
});
