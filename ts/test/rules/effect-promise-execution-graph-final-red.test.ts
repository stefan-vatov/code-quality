import { describe, expect, it } from 'vitest';
import { runRule } from './effect-rule-test-utils';

interface PromiseExecutionCase {
  name: string;
  reports: number;
  source: string;
}

const recursiveReentryCases: readonly PromiseExecutionCase[] = [
  {
    name: 'executes a Promise default on self-recursive re-entry',
    reports: 1,
    source: `
      import { Effect } from "effect";
      function recurse(value = Promise.resolve(user)) {
        return recurse();
      }
      const task = Effect.sync(() => recurse(user));
    `,
  },
  {
    name: 'executes a Promise default on mutual-recursive re-entry',
    reports: 1,
    source: `
      import { Effect } from "effect";
      function left(value = Promise.resolve(user)) {
        return right(value);
      }
      function right(value = Promise.resolve(user)) {
        return left();
      }
      const task = Effect.sync(() => left(user));
    `,
  },
  {
    name: 'skips a supplied default while terminating a self-cycle',
    reports: 0,
    source: `
      import { Effect } from "effect";
      function recurse(value = Promise.resolve(user)) {
        return recurse(value);
      }
      const task = Effect.sync(() => recurse(user));
    `,
  },
  {
    name: 'skips supplied defaults while terminating a mutual cycle',
    reports: 0,
    source: `
      import { Effect } from "effect";
      function left(value = Promise.resolve(user)) {
        return right(value);
      }
      function right(value = Promise.resolve(user)) {
        return left(value);
      }
      const task = Effect.sync(() => left(user));
    `,
  },
];

const generatorCreationCases: readonly PromiseExecutionCase[] = [
  {
    name: 'does not execute a generator declaration body on iterator creation',
    reports: 0,
    source: `
      import { Effect } from "effect";
      function* generate() {
        yield Promise.resolve(user);
      }
      const task = Effect.sync(() => generate());
    `,
  },
  {
    name: 'does not execute an inline generator body on iterator creation',
    reports: 0,
    source: `
      import { Effect } from "effect";
      const task = Effect.sync(() => (function* () {
        yield Promise.resolve(user);
      })());
    `,
  },
  {
    name: 'does not treat async-generator creation as Promise-producing',
    reports: 0,
    source: `
      import { Effect } from "effect";
      async function* generate() {
        yield user;
      }
      const task = Effect.sync(() => generate());
    `,
  },
  {
    name: 'does not execute an inline async-generator body on iterator creation',
    reports: 0,
    source: `
      import { Effect } from "effect";
      const task = Effect.sync(() => (async function* () {
        yield Promise.resolve(user);
      })());
    `,
  },
];

const generatorIterationCases: readonly PromiseExecutionCase[] = [
  {
    name: 'executes a synchronous generator through a direct next call',
    reports: 1,
    source: `
      import { Effect } from "effect";
      function* generate() {
        yield Promise.resolve(user);
      }
      const task = Effect.sync(() => generate().next());
    `,
  },
  {
    name: 'treats async-generator next as Promise-producing',
    reports: 1,
    source: `
      import { Effect } from "effect";
      async function* generate() {
        yield user;
      }
      const task = Effect.sync(() => generate().next());
    `,
  },
];

const lexicalResolutionCases: readonly PromiseExecutionCase[] = [
  {
    name: 'prefers an enclosing safe helper over an unsafe outer helper',
    reports: 0,
    source: `
      import { Effect } from "effect";
      function load() {
        return Promise.resolve(user);
      }
      {
        function load() {
          return user;
        }
        const task = Effect.sync(() => load());
      }
    `,
  },
  {
    name: 'prefers an enclosing unsafe helper over a safe outer helper',
    reports: 1,
    source: `
      import { Effect } from "effect";
      function load() {
        return user;
      }
      {
        function load() {
          return Promise.resolve(user);
        }
        const task = Effect.sync(() => load());
      }
    `,
  },
  {
    name: 'prefers an enclosing safe object method over an unsafe outer method',
    reports: 0,
    source: `
      import { Effect } from "effect";
      const helpers = {
        load() {
          return Promise.resolve(user);
        },
      };
      {
        const helpers = {
          load() {
            return user;
          },
        };
        const task = Effect.sync(() => helpers.load());
      }
    `,
  },
  {
    name: 'prefers an enclosing unsafe object method over a safe outer method',
    reports: 1,
    source: `
      import { Effect } from "effect";
      const helpers = {
        load() {
          return user;
        },
      };
      {
        const helpers = {
          load() {
            return Promise.resolve(user);
          },
        };
        const task = Effect.sync(() => helpers.load());
      }
    `,
  },
  {
    name: 'binds a safe enclosing shorthand method instead of an unsafe outer member',
    reports: 0,
    source: `
      import { Effect } from "effect";
      const helpers = {
        load() {
          return Promise.resolve(user);
        },
      };
      {
        function load() {
          return user;
        }
        const helpers = { load };
        const task = Effect.sync(() => helpers.load());
      }
    `,
  },
  {
    name: 'binds an unsafe enclosing shorthand method instead of a safe outer member',
    reports: 1,
    source: `
      import { Effect } from "effect";
      const helpers = {
        load() {
          return user;
        },
      };
      {
        function load() {
          return Promise.resolve(user);
        }
        const helpers = { load };
        const task = Effect.sync(() => helpers.load());
      }
    `,
  },
];

const staticCollectionCases: readonly PromiseExecutionCase[] = [
  {
    name: 'does not invoke map for an array containing only an empty spread',
    reports: 0,
    source: `
      import { Effect } from "effect";
      const task = Effect.sync(() => [...[]].map(async () => user));
    `,
  },
  {
    name: 'invokes map for a statically non-empty Array.of result',
    reports: 1,
    source: `
      import { Effect } from "effect";
      const task = Effect.sync(() => Array.of(user).map(async (value) => value));
    `,
  },
  {
    name: 'does not invoke map for a statically empty Array.of result',
    reports: 0,
    source: `
      import { Effect } from "effect";
      const task = Effect.sync(() => Array.of().map(async () => user));
    `,
  },
  {
    name: 'does not assume a parameter-shadowed Array.of result is native',
    reports: 0,
    source: `
      import { Effect } from "effect";
      function make(Array) {
        return Effect.sync(() => Array.of(user).map(async (value) => value));
      }
    `,
  },
  {
    name: 'does not assume a block-local Array.of result is native',
    reports: 0,
    source: `
      import { Effect } from "effect";
      {
        const Array = localArray;
        const task = Effect.sync(() => Array.of(user).map(async (value) => value));
      }
    `,
  },
];

const expectReportCount = ({ reports, source }: PromiseExecutionCase): void => {
  expect(runRule('effect-no-sync-for-promise', source)).toHaveLength(reports);
};

describe('effect-no-sync-for-promise recursive re-entry defaults', (): void => {
  it.each(recursiveReentryCases)('$name', expectReportCount);
});

describe('effect-no-sync-for-promise generator creation', (): void => {
  it.each(generatorCreationCases)('$name', expectReportCount);
});

describe('effect-no-sync-for-promise generator iteration', (): void => {
  it.each(generatorIterationCases)('$name', expectReportCount);
});

describe('effect-no-sync-for-promise enclosing lexical resolution', (): void => {
  it.each(lexicalResolutionCases)('$name', expectReportCount);
});

describe('effect-no-sync-for-promise static collection cardinality', (): void => {
  it.each(staticCollectionCases)('$name', expectReportCount);
});
