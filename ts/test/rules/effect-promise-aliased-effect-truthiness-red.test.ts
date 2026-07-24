import { describe, expect, it } from 'vitest';
import { runRule } from './effect-rule-test-utils';

interface AliasedEffectTruthinessCase {
  name: string;
  reports: 0 | 1;
  source: string;
}

interface LocatedCallNode {
  end?: number;
  start?: number;
  type?: string;
}

const ruleName = 'effect-no-sync-for-promise';
const expectedMessage =
  'Use Effect.tryPromise for Promise-returning code instead of Effect.sync.\n' +
  'Fix: Return an Effect from library code and run it only at the configured application boundary.\n' +
  'Example:\n' +
  '```ts\n' +
  'export const loadUser = Effect.fn("loadUser")(function* (id: UserId) {\n' +
  '  return yield* UserRepo.find(id)\n' +
  '})\n' +
  '```';

const officialAliasSource = (execution: string): string => `
  import { Effect as E } from "effect";

  const user = { id: 1 };
  const task = E.sync(() => Promise.resolve(user));
  ${execution}
`;

const cases: readonly AliasedEffectTruthinessCase[] = [
  {
    name: 'recognizes an aliased official Effect value as truthy for logical AND',
    reports: 1,
    source: officialAliasSource('E.succeed(user) && E.runSync(task);'),
  },
  {
    name: 'short-circuits logical OR for an aliased official failed Effect value',
    reports: 0,
    source: officialAliasSource('E.fail("stop") || E.runSync(task);'),
  },
  {
    name: 'does not give a shadowed Effect lookalike official truthiness semantics',
    reports: 0,
    source: `
      import { Effect, Effect as E } from "effect";

      const user = { id: 1 };
      const task = Effect.sync(() => Promise.resolve(user));
      {
        const E = { succeed: (_value: unknown): boolean => false };
        E.succeed(user) && Effect.runSync(task);
      }
    `,
  },
  {
    name: 'does not give a non-Effect lookalike official truthiness semantics',
    reports: 0,
    source: `
      import { Effect } from "effect";

      const user = { id: 1 };
      const task = Effect.sync(() => Promise.resolve(user));
      const E = { succeed: (_value: unknown): boolean => false };
      E.succeed(user) && Effect.runSync(task);
    `,
  },
];

const expectAliasedTruthiness = ({ reports, source }: AliasedEffectTruthinessCase): void => {
  const actualReports = runRule(ruleName, source);
  expect(actualReports).toHaveLength(reports);
  if (reports !== 1 || actualReports.length !== 1) {
    return;
  }

  const report = actualReports[0];
  if (!report) {
    return;
  }
  expect.soft(report.message).toBe(expectedMessage);
  expect.soft(report.node).toMatchObject({ type: 'CallExpression' });
  const { end, start } = report.node as LocatedCallNode;
  const expectedStart = source.indexOf('E.sync(');
  const expectedEnd = source.indexOf(';', expectedStart);
  expect.soft(start).toBe(expectedStart);
  expect.soft(end).toBe(expectedEnd);
  expect.soft(source.slice(start, end)).toBe(source.slice(expectedStart, expectedEnd));
};

describe('effect-no-sync-for-promise aliased Effect truthiness', (): void => {
  it.each(cases)('$name', expectAliasedTruthiness);
});
