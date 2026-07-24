import { describe, expect, it } from 'vitest';
import { runRule } from './effect-rule-test-utils';

interface PromiseTruthinessSpreadCase {
  name: string;
  reports: 0 | 1;
  source: string;
}

interface LocatedCallNode {
  end?: number;
  start?: number;
  type?: string;
}

type NamedPromiseTruthinessSpreadCase = PromiseTruthinessSpreadCase & { contract: string };

const expectedMessage =
  'Use Effect.tryPromise for Promise-returning code instead of Effect.sync.\n' +
  'Fix: Return an Effect from library code and run it only at the configured application boundary.\n' +
  'Example:\n' +
  '```ts\n' +
  'export const loadUser = Effect.fn("loadUser")(function* (id: UserId) {\n' +
  '  return yield* UserRepo.find(id)\n' +
  '})\n' +
  '```';

const truthinessSource = (argument: string): string => `
  import { Effect } from "effect";
  const user = { id: 1 };
  function choose(value: unknown) {
    if (value) {
      return Promise.resolve(user);
    }
    return user;
  }
  const task = Effect.sync(() => choose(${argument}));
`;

const exactTruthinessCases: readonly PromiseTruthinessSpreadCase[] = [
  {
    name: 'proves numeric zero takes the safe false branch',
    reports: 0,
    source: truthinessSource('0'),
  },
  {
    name: 'proves null takes the safe false branch',
    reports: 0,
    source: truthinessSource('null'),
  },
  {
    name: 'proves an empty string takes the safe false branch',
    reports: 0,
    source: truthinessSource('""'),
  },
  {
    name: 'proves global undefined takes the safe false branch',
    reports: 0,
    source: truthinessSource('undefined'),
  },
  {
    name: 'proves void zero takes the safe false branch',
    reports: 0,
    source: truthinessSource('void 0'),
  },
  {
    name: 'proves true takes the Promise-producing branch',
    reports: 1,
    source: truthinessSource('true'),
  },
  {
    name: 'proves numeric one takes the Promise-producing branch',
    reports: 1,
    source: truthinessSource('1'),
  },
  {
    name: 'proves a nonempty string takes the Promise-producing branch',
    reports: 1,
    source: truthinessSource('"x"'),
  },
  {
    name: 'proves false takes the safe branch',
    reports: 0,
    source: truthinessSource('false'),
  },
];

const spreadAccessorCases: readonly PromiseTruthinessSpreadCase[] = [
  {
    name: 'does not attribute a getter executed by an earlier object spread to Effect.sync',
    reports: 0,
    source: `
      import { Effect } from "effect";
      const user = { id: 1 };
      function load({ value }: { value: typeof user }) {
        return value;
      }
      const source = {
        get value() {
          Promise.resolve(user);
          return user;
        },
      };
      const input = { ...source };
      const task = Effect.sync(() => load(input));
    `,
  },
  {
    name: 'reports a Promise side effect from a live getter read inside Effect.sync',
    reports: 1,
    source: `
      import { Effect } from "effect";
      const user = { id: 1 };
      function load({ value }: { value: typeof user }) {
        return value;
      }
      const source = {
        get value() {
          Promise.resolve(user);
          return user;
        },
      };
      const task = Effect.sync(() => load(source));
    `,
  },
  {
    name: 'reports a getter executed by an object spread constructed inside Effect.sync',
    reports: 1,
    source: `
      import { Effect } from "effect";
      const user = { id: 1 };
      function load({ value }: { value: typeof user }) {
        return value;
      }
      const source = {
        get value() {
          Promise.resolve(user);
          return user;
        },
      };
      const task = Effect.sync(() => load({ ...source }));
    `,
  },
];

const expectPromiseCase = ({ reports, source }: PromiseTruthinessSpreadCase): void => {
  const actualReports = runRule('effect-no-sync-for-promise', source);
  expect(actualReports).toHaveLength(reports);
  if (reports === 0 || actualReports.length !== 1) {
    return;
  }

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

const namedCases = (
  cases: readonly PromiseTruthinessSpreadCase[],
): readonly NamedPromiseTruthinessSpreadCase[] =>
  cases.map(
    (testCase): NamedPromiseTruthinessSpreadCase => ({
      ...testCase,
      contract: testCase.reports === 1 ? 'semantic + exact Promise guidance' : 'semantic',
    }),
  );

describe('effect-no-sync-for-promise exact helper truthiness', (): void => {
  it.each(namedCases(exactTruthinessCases))('$name [$contract]', expectPromiseCase);
});

describe('effect-no-sync-for-promise spread accessor timing', (): void => {
  it.each(namedCases(spreadAccessorCases))('$name [$contract]', expectPromiseCase);
});
