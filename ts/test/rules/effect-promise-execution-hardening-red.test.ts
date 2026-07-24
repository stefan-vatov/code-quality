import { describe, expect, it } from 'vitest';
import { hasSyncForPromise } from '../../src/rules/effect-default-workflow-helpers';
import { runRule } from './effect-rule-test-utils';

interface SourceCase {
  name: string;
  source: string;
}

const recursiveDefaultCases: readonly SourceCase[] = [
  {
    name: 'a self-recursive default initializer',
    source: `
      import { Effect } from "effect";
      const safePromiseCapability = Promise.withResolvers;
      const task = Effect.sync(() => {
        function recurse(value = recurse()) {
          return value;
        }
        return recurse();
      });
    `,
  },
  {
    name: 'mutually recursive default initializers',
    source: `
      import { Effect } from "effect";
      const safePromiseCapability = Promise.withResolvers;
      const task = Effect.sync(() => {
        function left(value = right()) {
          return value;
        }
        function right(value = left()) {
          return value;
        }
        return left();
      });
    `,
  },
];

const executedDefaultCases: readonly SourceCase[] = [
  {
    name: 'a default supplied with void zero',
    source: `
      import { Effect } from "effect";
      const load = (value = Promise.resolve(user)) => value;
      const task = Effect.sync(() => load(void 0));
    `,
  },
  {
    name: 'an omitted default nested in an object pattern',
    source: `
      import { Effect } from "effect";
      function load({ value = Promise.resolve(user) } = {}) {
        return value;
      }
      const task = Effect.sync(() => load());
    `,
  },
  {
    name: 'a missing property default nested in an object pattern',
    source: `
      import { Effect } from "effect";
      function load({ value = Promise.resolve(user) }) {
        return value;
      }
      const task = Effect.sync(() => load({}));
    `,
  },
  {
    name: 'a missing element default nested in an array pattern',
    source: `
      import { Effect } from "effect";
      function load([value = fetch("/users/1")]) {
        return value;
      }
      const task = Effect.sync(() => load([]));
    `,
  },
  {
    name: 'a default nested in a rest parameter pattern',
    source: `
      import { Effect } from "effect";
      function load(...[value = Promise.resolve(user)]) {
        return value;
      }
      const task = Effect.sync(() => load());
    `,
  },
  {
    name: 'a default after a statically empty spread',
    source: `
      import { Effect } from "effect";
      function load(value = Promise.resolve(user)) {
        return value;
      }
      const task = Effect.sync(() => load(...[]));
    `,
  },
  {
    name: 'a default supplied by a spread containing void zero',
    source: `
      import { Effect } from "effect";
      function load(value = Promise.resolve(user)) {
        return value;
      }
      const task = Effect.sync(() => load(...[void 0]));
    `,
  },
  {
    name: 'a trailing default after a statically empty spread',
    source: `
      import { Effect } from "effect";
      function load(id, value = Promise.resolve(user)) {
        return [id, value];
      }
      const task = Effect.sync(() => load("user", ...[]));
    `,
  },
];

const invokedHelperCases: readonly SourceCase[] = [
  {
    name: 'a top-level helper',
    source: `
      import { Effect } from "effect";
      function load() {
        return Promise.resolve(user);
      }
      const task = Effect.sync(() => load());
    `,
  },
  {
    name: 'an alias of a top-level helper',
    source: `
      import { Effect } from "effect";
      function load() {
        return Promise.resolve(user);
      }
      const loadAlias = load;
      const task = Effect.sync(() => loadAlias());
    `,
  },
  {
    name: 'an object method',
    source: `
      import { Effect } from "effect";
      const helpers = {
        load() {
          return fetch("/users/1");
        },
      };
      const task = Effect.sync(() => helpers.load());
    `,
  },
  {
    name: 'a destructured object method',
    source: `
      import { Effect } from "effect";
      const helpers = {
        load() {
          return Promise.resolve(user);
        },
      };
      const { load } = helpers;
      const task = Effect.sync(() => load());
    `,
  },
  {
    name: 'a static class method',
    source: `
      import { Effect } from "effect";
      class Helpers {
        static load() {
          return Promise.resolve(user);
        }
      }
      const task = Effect.sync(() => Helpers.load());
    `,
  },
];

const eagerCollectionCallbackCases: readonly SourceCase[] = [
  {
    name: 'Array map with an async callback',
    source: `
      import { Effect } from "effect";
      const task = Effect.sync(() => [user].map(async (value) => value));
    `,
  },
  {
    name: 'Array forEach with an async callback',
    source: `
      import { Effect } from "effect";
      const task = Effect.sync(() => [user].forEach(async (value) => consume(value)));
    `,
  },
  {
    name: 'Array filter with an async callback',
    source: `
      import { Effect } from "effect";
      const task = Effect.sync(() => [user].filter(async () => true));
    `,
  },
  {
    name: 'Array flatMap with an async callback',
    source: `
      import { Effect } from "effect";
      const task = Effect.sync(() => [user].flatMap(async (value) => [value]));
    `,
  },
  {
    name: 'Array reduce with an async callback',
    source: `
      import { Effect } from "effect";
      const task = Effect.sync(() => [user].reduce(async (_state, value) => value, undefined));
    `,
  },
  {
    name: 'Array some with a Promise-returning callback',
    source: `
      import { Effect } from "effect";
      const task = Effect.sync(() => [user].some(() => Promise.resolve(true)));
    `,
  },
  {
    name: 'Array.from with an async mapping callback',
    source: `
      import { Effect } from "effect";
      const task = Effect.sync(() => Array.from([user], async (value) => value));
    `,
  },
];

const executionControlCases: readonly SourceCase[] = [
  {
    name: 'an uninvoked top-level helper',
    source: `
      import { Effect } from "effect";
      function load() {
        return Promise.resolve(user);
      }
      const task = Effect.sync(() => load);
    `,
  },
  {
    name: 'an uninvoked object method',
    source: `
      import { Effect } from "effect";
      const helpers = {
        load() {
          return Promise.resolve(user);
        },
      };
      const task = Effect.sync(() => helpers.load);
    `,
  },
  {
    name: 'an uninvoked static class method',
    source: `
      import { Effect } from "effect";
      class Helpers {
        static load() {
          return Promise.resolve(user);
        }
      }
      const task = Effect.sync(() => Helpers.load);
    `,
  },
  {
    name: 'a supplied direct default',
    source: `
      import { Effect } from "effect";
      function load(value = Promise.resolve(user)) {
        return value;
      }
      const task = Effect.sync(() => load(user));
    `,
  },
  {
    name: 'a supplied object property default',
    source: `
      import { Effect } from "effect";
      function load({ value = Promise.resolve(user) } = {}) {
        return value;
      }
      const task = Effect.sync(() => load({ value: user }));
    `,
  },
  {
    name: 'a supplied array element default',
    source: `
      import { Effect } from "effect";
      function load([value = Promise.resolve(user)]) {
        return value;
      }
      const task = Effect.sync(() => load([user]));
    `,
  },
  {
    name: 'a default supplied through a non-empty static spread',
    source: `
      import { Effect } from "effect";
      function load(value = Promise.resolve(user)) {
        return value;
      }
      const task = Effect.sync(() => load(...[user]));
    `,
  },
  {
    name: 'a trailing default supplied through a non-empty static spread',
    source: `
      import { Effect } from "effect";
      function load(id, value = Promise.resolve(user)) {
        return [id, value];
      }
      const task = Effect.sync(() => load("user", ...[user]));
    `,
  },
  {
    name: 'a default behind a spread of unknown cardinality',
    source: `
      import { Effect } from "effect";
      function make(values) {
        function load(value = Promise.resolve(user)) {
          return value;
        }
        return Effect.sync(() => load(...values));
      }
    `,
  },
  {
    name: 'a locally shadowed globalThis object',
    source: `
      import { Effect } from "effect";
      function make(globalThis) {
        return Effect.sync(() => globalThis.fetch("/users/1"));
      }
    `,
  },
  {
    name: 'an async callback passed to an unknown deferred scheduler',
    source: `
      import { Effect } from "effect";
      const task = Effect.sync(() => scheduler.enqueue(async () => user));
    `,
  },
  {
    name: 'an async map callback on a statically empty array',
    source: `
      import { Effect } from "effect";
      const task = Effect.sync(() => [].map(async () => user));
    `,
  },
  {
    name: 'a synchronous callback on a non-empty array',
    source: `
      import { Effect } from "effect";
      const task = Effect.sync(() => [user].map((value) => value));
    `,
  },
];

describe('effect-no-sync-for-promise recursive default hardening', (): void => {
  it.each(recursiveDefaultCases)('terminates without reporting $name', ({ source }): void => {
    expect(runRule('effect-no-sync-for-promise', source)).toHaveLength(0);
  });
});

describe('effect-no-sync-for-promise executed default semantics', (): void => {
  it.each(executedDefaultCases)('reports $name exactly once', ({ source }): void => {
    expect(runRule('effect-no-sync-for-promise', source)).toHaveLength(1);
  });
});

describe('effect-no-sync-for-promise invoked helper resolution', (): void => {
  it.each(invokedHelperCases)('reports $name exactly once', ({ source }): void => {
    expect(runRule('effect-no-sync-for-promise', source)).toHaveLength(1);
  });
});

describe('effect-no-sync-for-promise global fetch provenance', (): void => {
  const source = `
    import { Effect } from "effect";
    const task = Effect.sync(() => globalThis.fetch("/users/1"));
  `;

  it('reports globalThis.fetch through the real AST rule', (): void => {
    expect(runRule('effect-no-sync-for-promise', source)).toHaveLength(1);
  });

  it('detects globalThis.fetch through the source compatibility helper', (): void => {
    expect(hasSyncForPromise(source)).toBe(true);
  });
});

describe('effect-no-sync-for-promise eager collection callbacks', (): void => {
  it.each(eagerCollectionCallbackCases)('reports $name exactly once', ({ source }): void => {
    expect(runRule('effect-no-sync-for-promise', source)).toHaveLength(1);
  });
});

describe('effect-no-sync-for-promise execution controls', (): void => {
  it.each(executionControlCases)('accepts $name', ({ source }): void => {
    expect(runRule('effect-no-sync-for-promise', source)).toHaveLength(0);
  });
});
