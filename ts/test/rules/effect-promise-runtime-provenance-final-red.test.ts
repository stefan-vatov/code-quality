import { describe, expect, it } from 'vitest';
import { runRule } from './effect-rule-test-utils';
import theThracianOxlint from '../../src/index';

interface RuntimeProvenanceCase {
  name: string;
  reports: 0 | 1;
  representative?: boolean;
  source: string;
}

interface LocatedCallNode {
  end?: number;
  start?: number;
  type?: string;
}

const ruleName = 'effect-no-sync-for-promise';
const ruleID = `thethracian/${ruleName}`;
const expectedMessage =
  'Use Effect.tryPromise for Promise-returning code instead of Effect.sync.\n' +
  'Fix: Return an Effect from library code and run it only at the configured application boundary.\n' +
  'Example:\n' +
  '```ts\n' +
  'export const loadUser = Effect.fn("loadUser")(function* (id: UserId) {\n' +
  '  return yield* UserRepo.find(id)\n' +
  '})\n' +
  '```';

const mutableBlockCases: readonly RuntimeProvenanceCase[] = [
  {
    name: 'observes an outer mutable write to undefined inside a nested block',
    reports: 1,
    representative: true,
    source: `
      import { Effect } from "effect";
      const user = { id: 1 };
      type UserResult = typeof user | Promise<typeof user> | undefined;
      function load(value: UserResult = Promise.resolve(user)): UserResult {
        return value;
      }
      let supplied: UserResult = user;
      const task = Effect.sync(() => {
        {
          supplied = void 0;
        }
        return load(supplied);
      });
    `,
  },
  {
    name: 'observes a safe outer mutable write inside a nested block',
    reports: 0,
    source: `
      import { Effect } from "effect";
      const user = { id: 1 };
      type UserResult = typeof user | Promise<typeof user> | undefined;
      function load(value: UserResult = Promise.resolve(user)): UserResult {
        return value;
      }
      let supplied: UserResult = void 0;
      const task = Effect.sync(() => {
        {
          supplied = user;
        }
        return load(supplied);
      });
    `,
  },
];
const conditionalWriteSource = (alternate: 'undefined' | 'user'): string => `
  import { Effect } from "effect";
  const user = { id: 1 };
  type UserResult = typeof user | Promise<typeof user> | undefined;
  function load(value: UserResult = Promise.resolve(user)): UserResult {
    return value;
  }
  function make(condition: boolean) {
    let supplied: UserResult = user;
    return Effect.sync(() => {
      if (condition) {
        supplied = void 0;
      } else {
        supplied = ${alternate === 'undefined' ? 'void 0' : 'user'};
      }
      return load(supplied);
    });
  }
  export { make };
`;
const conditionalWriteCases: readonly RuntimeProvenanceCase[] = [
  {
    name: 'proves undefined when both unknown conditional arms assign undefined',
    reports: 1,
    source: conditionalWriteSource('undefined'),
  },
  {
    name: 'stays conservative when one unknown conditional arm assigns a safe value',
    reports: 0,
    source: conditionalWriteSource('user'),
  },
];
const helperMutationCases: readonly RuntimeProvenanceCase[] = [
  {
    name: 'observes a captured undefined write from a provably invoked helper',
    reports: 1,
    representative: true,
    source: `
      import { Effect } from "effect";
      const user = { id: 1 };
      type UserResult = typeof user | Promise<typeof user> | undefined;
      function load(value: UserResult = Promise.resolve(user)): UserResult {
        return value;
      }
      let supplied: UserResult = user;
      function clear(): void {
        supplied = void 0;
      }
      const task = Effect.sync(() => {
        clear();
        return load(supplied);
      });
    `,
  },
  {
    name: 'does not apply a captured write from an uninvoked helper',
    reports: 0,
    source: `
      import { Effect } from "effect";
      const user = { id: 1 };
      type UserResult = typeof user | Promise<typeof user> | undefined;
      function load(value: UserResult = Promise.resolve(user)): UserResult {
        return value;
      }
      let supplied: UserResult = user;
      function clear(): void {
        supplied = void 0;
      }
      const task = Effect.sync(() => load(supplied));
      void clear;
    `,
  },
  {
    name: 'observes a safe captured write from a provably invoked helper',
    reports: 0,
    source: `
      import { Effect } from "effect";
      const user = { id: 1 };
      type UserResult = typeof user | Promise<typeof user> | undefined;
      function load(value: UserResult = Promise.resolve(user)): UserResult {
        return value;
      }
      let supplied: UserResult = void 0;
      function fill(): void {
        supplied = user;
      }
      const task = Effect.sync(() => {
        fill();
        return load(supplied);
      });
    `,
  },
];
const lexicalRuntimeCases: readonly RuntimeProvenanceCase[] = [
  {
    name: 'stops at TDZ before reading a later const Promise binding',
    reports: 0,
    source: `
      import { Effect } from "effect";
      const user = { id: 1 };
      const task = Effect.sync(() => {
        return supplied;
      });
      Effect.runSync(task);
      const supplied = Promise.resolve(user);
    `,
  },
  {
    name: 'returns a const Promise binding when run after initialization',
    reports: 1,
    source: `
      import { Effect } from "effect";
      const user = { id: 1 };
      const task = Effect.sync(() => {
        return supplied;
      });
      const supplied = Promise.resolve(user);
      Effect.runSync(task);
    `,
  },
  {
    name: 'stops at TDZ before reading a later let Promise binding',
    reports: 0,
    source: `
      import { Effect } from "effect";
      const user = { id: 1 };
      const task = Effect.sync(() => {
        return supplied;
      });
      Effect.runSync(task);
      let supplied = Promise.resolve(user);
    `,
  },
  {
    name: 'returns a let Promise binding when run after initialization',
    reports: 1,
    source: `
      import { Effect } from "effect";
      const user = { id: 1 };
      const task = Effect.sync(() => {
        return supplied;
      });
      let supplied = Promise.resolve(user);
      Effect.runSync(task);
    `,
  },
  {
    name: 'uses hoisted var undefined and executes a Promise default before initialization',
    reports: 1,
    source: `
      import { Effect } from "effect";
      const user = { id: 1 };
      type UserResult = typeof user | Promise<typeof user> | undefined;
      function load(value: UserResult = Promise.resolve(user)): UserResult {
        return value;
      }
      const task = Effect.sync(() => load(supplied));
      Effect.runSync(task);
      var supplied = user;
    `,
  },
  {
    name: 'uses the initialized safe var value when run afterward',
    reports: 0,
    source: `
      import { Effect } from "effect";
      const user = { id: 1 };
      type UserResult = typeof user | Promise<typeof user> | undefined;
      function load(value: UserResult = Promise.resolve(user)): UserResult {
        return value;
      }
      const task = Effect.sync(() => load(supplied));
      var supplied = user;
      Effect.runSync(task);
    `,
  },
];
const identifierCallbackCases: readonly RuntimeProvenanceCase[] = [
  {
    name: 'reports a function declaration callback returning a Promise',
    reports: 1,
    representative: true,
    source: `
      import { Effect } from "effect";
      const user = { id: 1 };
      function callback() {
        return Promise.resolve(user);
      }
      const task = Effect.sync(callback);
    `,
  },
  {
    name: 'reports a const callback returning a Promise',
    reports: 1,
    source: `
      import { Effect } from "effect";
      const user = { id: 1 };
      const callback = () => Promise.resolve(user);
      const task = Effect.sync(callback);
    `,
  },
  {
    name: 'accepts an identifier callback returning a concrete value',
    reports: 0,
    source: `
      import { Effect } from "effect";
      const user = { id: 1 };
      const callback = () => user;
      const task = Effect.sync(callback);
    `,
  },
  {
    name: 'resolves a later hoisted function callback returning a Promise',
    reports: 1,
    source: `
      import { Effect } from "effect";
      const user = { id: 1 };
      const task = Effect.sync(callback);
      function callback() {
        return Promise.resolve(user);
      }
    `,
  },
];
const expressionCallbackCases: readonly RuntimeProvenanceCase[] = [
  {
    name: 'returns a pre-existing Promise from an expression-bodied callback',
    reports: 1,
    representative: true,
    source: `
      import { Effect } from "effect";
      const user = { id: 1 };
      const existing = Promise.resolve(user);
      const task = Effect.sync(() => existing);
    `,
  },
  {
    name: 'returns a concrete value from an expression-bodied callback',
    reports: 0,
    source: `
      import { Effect } from "effect";
      const user = { id: 1 };
      const existing = user;
      const task = Effect.sync(() => existing);
    `,
  },
  {
    name: 'stops at TDZ when an expression callback is run before its Promise binding exists',
    reports: 0,
    source: `
      import { Effect } from "effect";
      const user = { id: 1 };
      const task = Effect.sync(() => existing);
      Effect.runSync(task);
      const existing = Promise.resolve(user);
    `,
  },
];
const taskAliasSource = (initial: 'undefined' | 'user', runSite: string): string => `
  import { Effect } from "effect";
  const user = { id: 1 };
  type UserResult = typeof user | Promise<typeof user> | undefined;
  function load(value: UserResult = Promise.resolve(user)): UserResult {
    return value;
  }
  let supplied: UserResult = ${initial === 'user' ? 'user' : 'void 0'};
  const task = Effect.sync(() => load(supplied));
  ${runSite}
`;
const taskAliasCases: readonly RuntimeProvenanceCase[] = [
  {
    name: 'observes unsafe mutation at a task alias run site',
    reports: 1,
    source: taskAliasSource(
      'user',
      `
      const alias = task;
      supplied = void 0;
      Effect.runSync(alias);
    `,
    ),
  },
  {
    name: 'observes safe mutation at a task alias run site',
    reports: 0,
    source: taskAliasSource(
      'undefined',
      `
      const alias = task;
      supplied = user;
      Effect.runSync(alias);
    `,
    ),
  },
  {
    name: 'observes unsafe mutation through a task alias chain',
    reports: 1,
    source: taskAliasSource(
      'user',
      `
      const first = task;
      const second = first;
      supplied = void 0;
      Effect.runSync(second);
    `,
    ),
  },
  {
    name: 'keeps a shadowed safe task alias separate from an unsafe outer alias',
    reports: 0,
    source: taskAliasSource(
      'user',
      `
      const alias = task;
      {
        const alias = Effect.succeed(user);
        supplied = void 0;
        Effect.runSync(alias);
      }
      void alias;
    `,
    ),
  },
  {
    name: 'runs an inner task alias despite a safe shadowed outer alias',
    reports: 1,
    source: taskAliasSource(
      'user',
      `
      const alias = Effect.succeed(user);
      {
        const alias = task;
        supplied = void 0;
        Effect.runSync(alias);
      }
      void alias;
    `,
    ),
  },
];
const nestedRunSource = (executionSite: string): string => `
  import { Effect } from "effect";
  const user = { id: 1 };
  type UserResult = typeof user | Promise<typeof user> | undefined;
  function load(value: UserResult = Promise.resolve(user)): UserResult {
    return value;
  }
  let supplied: UserResult = user;
  const task = Effect.sync(() => load(supplied));
  ${executionSite}
`;
const nestedRunCases: readonly RuntimeProvenanceCase[] = [
  {
    name: 'indexes a task run from an executed top-level nested block',
    reports: 1,
    source: nestedRunSource(`
      {
        supplied = void 0;
        Effect.runSync(task);
      }
    `),
  },
  {
    name: 'indexes a task run from a top-level variable initializer',
    reports: 1,
    source: nestedRunSource(`
      supplied = void 0;
      const selected = Effect.runSync(task);
      void selected;
    `),
  },
  {
    name: 'does not index a task run contained only in an uninvoked helper',
    reports: 0,
    source: nestedRunSource(`
      function execute(): UserResult {
        supplied = void 0;
        return Effect.runSync(task);
      }
      void execute;
    `),
  },
  {
    name: 'indexes a task run contained in a provably invoked helper',
    reports: 1,
    source: nestedRunSource(`
      function execute(): UserResult {
        supplied = void 0;
        return Effect.runSync(task);
      }
      execute();
    `),
  },
];
const expectRuntimeProvenance = ({
  reports,
  representative,
  source,
}: RuntimeProvenanceCase): void => {
  const actualReports = runRule(ruleName, source);
  expect(actualReports).toHaveLength(reports);
  if (!representative || reports !== 1 || actualReports.length !== 1) {
    return;
  }

  expect.soft(theThracianOxlint().rules).toHaveProperty(ruleID, 'error');
  const [report] = actualReports;
  expect.soft(report?.message).toBe(expectedMessage);
  expect.soft(report?.node).toMatchObject({ type: 'CallExpression' });
  const { end, start } = report?.node as LocatedCallNode;
  const expectedStart = source.indexOf('Effect.sync(');
  const expectedEnd = source.lastIndexOf(';');
  expect.soft(start).toBe(expectedStart);
  expect.soft(end).toBe(expectedEnd);
  expect.soft(source.slice(start, end)).toBe(source.slice(expectedStart, expectedEnd));
};

describe('effect-no-sync-for-promise bounded runtime provenance', (): void => {
  it.each([
    ...mutableBlockCases,
    ...conditionalWriteCases,
    ...helperMutationCases,
    ...lexicalRuntimeCases,
    ...identifierCallbackCases,
    ...expressionCallbackCases,
    ...taskAliasCases,
    ...nestedRunCases,
  ])('$name', expectRuntimeProvenance);
});
