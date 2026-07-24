import { describe, expect, it } from 'vitest';
import { runRule } from './effect-rule-test-utils';
import theThracianOxlint from '../../src/index';

interface PromiseValueFlowCase {
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

const aliasCases: readonly PromiseValueFlowCase[] = [
  {
    name: 'executes a Promise default through a const alias chain ending at void zero',
    reports: 1,
    representative: true,
    source: `
      import { Effect } from "effect";
      const user = { id: 1 };
      type UserResult = typeof user | Promise<typeof user> | undefined;
      function load(value: UserResult = Promise.resolve(user)): UserResult {
        return value;
      }
      const leaf = void 0;
      const middle = leaf;
      const supplied = middle;
      const task = Effect.sync(() => load(supplied));
    `,
  },
  {
    name: 'accepts a const alias chain ending at a concrete value',
    reports: 0,
    source: `
      import { Effect } from "effect";
      const user = { id: 1 };
      type UserResult = typeof user | Promise<typeof user> | undefined;
      function load(value: UserResult = Promise.resolve(user)): UserResult {
        return value;
      }
      const leaf = user;
      const middle = leaf;
      const supplied = middle;
      const task = Effect.sync(() => load(supplied));
    `,
  },
];

const reassignmentCases: readonly PromiseValueFlowCase[] = [
  {
    name: 'uses a let reassignment to void zero before the Effect is run',
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
      const task = Effect.sync(() => load(supplied));
      supplied = void 0;
      Effect.runSync(task);
    `,
  },
  {
    name: 'uses a safe let reassignment before the Effect is run',
    reports: 0,
    source: `
      import { Effect } from "effect";
      const user = { id: 1 };
      type UserResult = typeof user | Promise<typeof user> | undefined;
      function load(value: UserResult = Promise.resolve(user)): UserResult {
        return value;
      }
      let supplied: UserResult = void 0;
      const task = Effect.sync(() => load(supplied));
      supplied = user;
      Effect.runSync(task);
    `,
  },
  {
    name: 'does not apply a reassignment after the Effect has already run',
    reports: 0,
    source: `
      import { Effect } from "effect";
      const user = { id: 1 };
      type UserResult = typeof user | Promise<typeof user> | undefined;
      function load(value: UserResult = Promise.resolve(user)): UserResult {
        return value;
      }
      let supplied: UserResult = user;
      const task = Effect.sync(() => load(supplied));
      Effect.runSync(task);
      supplied = void 0;
    `,
  },
  {
    name: 'reanalyzes the same task after a captured value changes between runs',
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
      const task = Effect.sync(() => load(supplied));
      Effect.runSync(task);
      supplied = void 0;
      Effect.runSync(task);
    `,
  },
];

const existingBindingCases: readonly PromiseValueFlowCase[] = [
  {
    name: 'reports an existing Promise binding returned through a helper',
    reports: 1,
    representative: true,
    source: `
      import { Effect } from "effect";
      const user = { id: 1 };
      function forward(value: typeof user | Promise<typeof user>) {
        return value;
      }
      const existing = Promise.resolve(user);
      const task = Effect.sync(() => forward(existing));
    `,
  },
  {
    name: 'accepts an existing concrete binding returned through a helper',
    reports: 0,
    source: `
      import { Effect } from "effect";
      const user = { id: 1 };
      function forward(value: typeof user | Promise<typeof user>) {
        return value;
      }
      const existing = user;
      const task = Effect.sync(() => forward(existing));
    `,
  },
  {
    name: 'accepts a helper that ignores a pre-existing Promise argument',
    reports: 0,
    source: `
      import { Effect } from "effect";
      const user = { id: 1 };
      function ignore(_value: Promise<typeof user>): typeof user {
        return user;
      }
      const existing = Promise.resolve(user);
      const task = Effect.sync(() => ignore(existing));
    `,
  },
  {
    name: 'does not attribute unused Promise construction before Effect.sync to its callback',
    reports: 0,
    source: `
      import { Effect } from "effect";
      const user = { id: 1 };
      const existing = Promise.resolve(user);
      void existing;
      const task = Effect.sync(() => user);
    `,
  },
];

const truthinessSource = (argument: 'Infinity' | 'NaN'): string => `
  import { Effect } from "effect";
  const user = { id: 1 };
  function choose(value: number) {
    if (value) {
      return Promise.resolve(user);
    }
    return user;
  }
  const task = Effect.sync(() => choose(${argument}));
`;

const numericTruthinessCases: readonly PromiseValueFlowCase[] = [
  {
    name: 'does not execute a default for NaN',
    reports: 0,
    source: `
      import { Effect } from "effect";
      const user = { id: 1 };
      function load(value: unknown = Promise.resolve(user)) {
        return value;
      }
      const task = Effect.sync(() => load(NaN));
    `,
  },
  {
    name: 'selects the false branch for NaN',
    reports: 0,
    source: truthinessSource('NaN'),
  },
  {
    name: 'selects the Promise branch for truthy Infinity',
    reports: 1,
    representative: true,
    source: truthinessSource('Infinity'),
  },
];

const logicalCases: readonly PromiseValueFlowCase[] = [
  {
    name: 'short-circuits a Promise on the right of falsy logical AND',
    reports: 0,
    source: `
      import { Effect } from "effect";
      const user = { id: 1 };
      const task = Effect.sync(() => 0 && Promise.resolve(user));
    `,
  },
  {
    name: 'executes a Promise on the right of truthy logical AND',
    reports: 1,
    representative: true,
    source: `
      import { Effect } from "effect";
      const user = { id: 1 };
      const task = Effect.sync(() => 1 && Promise.resolve(user));
    `,
  },
  {
    name: 'short-circuits a Promise on the right of truthy logical OR',
    reports: 0,
    source: `
      import { Effect } from "effect";
      const user = { id: 1 };
      const task = Effect.sync(() => 1 || Promise.resolve(user));
    `,
  },
  {
    name: 'executes a Promise on the right of falsy logical OR',
    reports: 1,
    representative: true,
    source: `
      import { Effect } from "effect";
      const user = { id: 1 };
      const task = Effect.sync(() => 0 || Promise.resolve(user));
    `,
  },
];

const conditionalSource = (condition: boolean, promiseFirst: boolean): string => {
  const consequent = ((): string => {
    if (promiseFirst) {
      return 'Promise.resolve(user)';
    }
    return 'user';
  })();
  const alternate = ((): string => {
    if (promiseFirst) {
      return 'user';
    }
    return 'Promise.resolve(user)';
  })();
  return `
    import { Effect } from "effect";
    const user = { id: 1 };
    const task = Effect.sync(() => ${condition ? 'true' : 'false'} ? ${consequent} : ${alternate});
  `;
};

const conditionalCases: readonly PromiseValueFlowCase[] = [
  {
    name: 'does not execute an unsafe alternate when a safe consequent is selected',
    reports: 0,
    source: conditionalSource(true, false),
  },
  {
    name: 'reports an unsafe consequent selected by true',
    reports: 1,
    representative: true,
    source: conditionalSource(true, true),
  },
  {
    name: 'does not execute an unsafe consequent when a safe alternate is selected',
    reports: 0,
    source: conditionalSource(false, true),
  },
  {
    name: 'reports an unsafe alternate selected by false',
    reports: 1,
    source: conditionalSource(false, false),
  },
];

const getterOrderSource = (
  firstBody: string,
  selectedOrder: 'first-later' | 'later-first',
): string => {
  const parameter = ((): string => {
    if (selectedOrder === 'first-later') {
      return '{ first, later }: { first: unknown; later: UserResult }';
    }
    return '{ later, first }: { first: unknown; later: UserResult }';
  })();
  return `
    import { Effect } from "effect";
    const user = { id: 1 };
    type UserResult = typeof user | Promise<typeof user>;
    function load(${parameter}) {
      void first;
      return later;
    }
    const input = {
      get first() {
        ${firstBody}
      },
      get later() {
        return Promise.resolve(user);
      },
    };
    const task = Effect.sync(() => load(input));
  `;
};

const throwingGetterCases: readonly PromiseValueFlowCase[] = [
  {
    name: 'does not execute a later Promise getter after an earlier getter throws',
    reports: 0,
    source: getterOrderSource('throw new Error("stop");', 'first-later'),
  },
  {
    name: 'reports a Promise getter read before a later getter throws',
    reports: 1,
    representative: true,
    source: getterOrderSource('throw new Error("stop");', 'later-first'),
  },
  {
    name: 'continues to a Promise getter after an earlier getter returns',
    reports: 1,
    source: getterOrderSource(
      `
        return user;
        throw new Error("unreachable");
      `,
      'first-later',
    ),
  },
  {
    name: 'stops before a later Promise getter when throw precedes an unreachable return',
    reports: 0,
    source: getterOrderSource(
      `
        throw new Error("stop");
        return user;
      `,
      'first-later',
    ),
  },
];

const expectPromiseValueFlow = ({
  reports,
  representative,
  source,
}: PromiseValueFlowCase): void => {
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
  const expectedEnd = source.indexOf(';', expectedStart);
  expect.soft(start).toBe(expectedStart);
  expect.soft(end).toBe(expectedEnd);
  expect.soft(source.slice(start, end)).toBe(source.slice(expectedStart, expectedEnd));
};

describe('effect-no-sync-for-promise exact value and control-flow semantics', (): void => {
  it.each([
    ...aliasCases,
    ...reassignmentCases,
    ...existingBindingCases,
    ...numericTruthinessCases,
    ...logicalCases,
    ...conditionalCases,
    ...throwingGetterCases,
  ])('$name', expectPromiseValueFlow);
});
