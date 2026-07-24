import { describe, expect, it } from 'vitest';
import { runRule } from './effect-rule-test-utils';

interface PromiseIdentityCase {
  name: string;
  reports: number;
  source: string;
}

interface LocatedCallNode {
  end?: number;
  start?: number;
  type?: string;
}

const canonicalMessage = 'Use Effect.tryPromise for Promise-returning code instead of Effect.sync.';

const undefinedIdentityCases: readonly PromiseIdentityCase[] = [
  {
    name: 'treats a parameter named undefined as its supplied concrete value',
    reports: 0,
    source: `
      import { Effect } from "effect";
      const user = { id: 1 };
      function load(undefined = Promise.resolve(user)) {
        return undefined;
      }
      const task = Effect.sync(() => load(user));
    `,
  },
  {
    name: 'treats a local binding named undefined as its concrete value',
    reports: 0,
    source: `
      import { Effect } from "effect";
      const user = { id: 1 };
      function load(value = Promise.resolve(user)) {
        return value;
      }
      const task = Effect.sync(() => {
        const undefined = user;
        return load(undefined);
      });
    `,
  },
  {
    name: 'preserves a wrapper parameter named undefined when forwarding it',
    reports: 0,
    source: `
      import { Effect } from "effect";
      const user = { id: 1 };
      function load(value = Promise.resolve(user)) {
        return value;
      }
      function forward(undefined) {
        return load(undefined);
      }
      const task = Effect.sync(() => forward(user));
    `,
  },
  {
    name: 'executes a default when a parameter named undefined receives void zero',
    reports: 1,
    source: `
      import { Effect } from "effect";
      const user = { id: 1 };
      function load(undefined = Promise.resolve(user)) {
        return undefined;
      }
      const task = Effect.sync(() => load(void 0));
    `,
  },
  {
    name: 'executes a default when a local binding named undefined contains void zero',
    reports: 1,
    source: `
      import { Effect } from "effect";
      const user = { id: 1 };
      function load(value = Promise.resolve(user)) {
        return value;
      }
      const task = Effect.sync(() => {
        const undefined = void 0;
        return load(undefined);
      });
    `,
  },
  {
    name: 'executes a default for an omitted argument',
    reports: 1,
    source: `
      import { Effect } from "effect";
      const user = { id: 1 };
      function load(value = Promise.resolve(user)) {
        return value;
      }
      const task = Effect.sync(() => load());
    `,
  },
  {
    name: 'executes a default for void zero',
    reports: 1,
    source: `
      import { Effect } from "effect";
      const user = { id: 1 };
      function load(value = Promise.resolve(user)) {
        return value;
      }
      const task = Effect.sync(() => load(void 0));
    `,
  },
  {
    name: 'executes a default for the unshadowed global undefined value',
    reports: 1,
    source: `
      import { Effect } from "effect";
      const user = { id: 1 };
      function load(value = Promise.resolve(user)) {
        return value;
      }
      const task = Effect.sync(() => load(undefined));
    `,
  },
];

const accessorDefaultCases: readonly PromiseIdentityCase[] = [
  {
    name: 'executes a default after a getter returns undefined',
    reports: 1,
    source: `
      import { Effect } from "effect";
      const user = { id: 1 };
      function load({ value = Promise.resolve(user) }) {
        return value;
      }
      const input = {
        get value() {
          return undefined;
        },
      };
      const task = Effect.sync(() => load(input));
    `,
  },
  {
    name: 'skips a default after a getter returns a concrete value',
    reports: 0,
    source: `
      import { Effect } from "effect";
      const user = { id: 1 };
      function load({ value = Promise.resolve(user) }) {
        return value;
      }
      const input = {
        get value() {
          return user;
        },
      };
      const task = Effect.sync(() => load(input));
    `,
  },
  {
    name: 'reports a Promise produced while evaluating a getter',
    reports: 1,
    source: `
      import { Effect } from "effect";
      const user = { id: 1 };
      function load({ value }) {
        return value;
      }
      const input = {
        get value() {
          return Promise.resolve(user);
        },
      };
      const task = Effect.sync(() => load(input));
    `,
  },
  {
    name: 'executes a default for a setter-only property read',
    reports: 1,
    source: `
      import { Effect } from "effect";
      const user = { id: 1 };
      function load({ value = Promise.resolve(user) }) {
        return value;
      }
      const input = {
        set value(_nextValue) {},
      };
      const task = Effect.sync(() => load(input));
    `,
  },
  {
    name: 'stays conservative when an unknown object may expose an accessor',
    reports: 0,
    source: `
      import { Effect } from "effect";
      const user = { id: 1 };
      function make(input) {
        function load({ value = Promise.resolve(user) }) {
          return value;
        }
        return Effect.sync(() => load(input));
      }
    `,
  },
];

const recursionArgumentCases: readonly PromiseIdentityCase[] = [
  {
    name: 'analyzes a recursive invocation after its callback argument changes',
    reports: 1,
    source: `
      import { Effect } from "effect";
      const user = { id: 1 };
      function recur(callback, again) {
        if (again) {
          return recur(() => Promise.resolve(user), false);
        }
        return callback();
      }
      const task = Effect.sync(() => recur(() => user, true));
    `,
  },
  {
    name: 'accepts a recursive fixed point whose callback remains safe',
    reports: 0,
    source: `
      import { Effect } from "effect";
      const user = { id: 1 };
      function recur(callback, again) {
        if (again) {
          return recur(callback, false);
        }
        return callback();
      }
      const task = Effect.sync(() => recur(() => user, true));
    `,
  },
  {
    name: 'accepts an unsafe callback replaced by a safe callback before invocation',
    reports: 0,
    source: `
      import { Effect } from "effect";
      const user = { id: 1 };
      function rotate(callback, replacement, again) {
        if (again) {
          return rotate(replacement, callback, false);
        }
        return callback();
      }
      const task = Effect.sync(() =>
        rotate(
          () => Promise.resolve(user),
          () => user,
          true,
        ),
      );
    `,
  },
  {
    name: 'terminates an exact same-argument self cycle without invoking its callback',
    reports: 0,
    source: `
      import { Effect } from "effect";
      const user = { id: 1 };
      function recur(callback) {
        return recur(callback);
      }
      const task = Effect.sync(() => recur(() => Promise.resolve(user)));
    `,
  },
  {
    name: 'terminates an exact same-argument mutual cycle without invoking its callback',
    reports: 0,
    source: `
      import { Effect } from "effect";
      const user = { id: 1 };
      function left(callback) {
        return right(callback);
      }
      function right(callback) {
        return left(callback);
      }
      const task = Effect.sync(() => left(() => Promise.resolve(user)));
    `,
  },
  {
    name: 'does not execute an unsafe changed callback that is only returned',
    reports: 0,
    source: `
      import { Effect } from "effect";
      const user = { id: 1 };
      function recur(callback, again) {
        if (again) {
          return recur(() => Promise.resolve(user), false);
        }
        return callback;
      }
      const task = Effect.sync(() => recur(() => user, true));
    `,
  },
];

const expectReportCount = ({ reports, source }: PromiseIdentityCase): void => {
  const actualReports = runRule('effect-no-sync-for-promise', source);
  expect(actualReports).toHaveLength(reports);
  if (reports !== 1 || actualReports.length !== 1) {
    return;
  }

  const [report] = actualReports;
  expect.soft(report?.message.startsWith(canonicalMessage)).toBe(true);
  expect.soft(report?.node).toMatchObject({ type: 'CallExpression' });

  const { end, start } = report?.node as LocatedCallNode;
  expect.soft(start).toBeTypeOf('number');
  expect.soft(end).toBeTypeOf('number');
  if (typeof start !== 'number' || typeof end !== 'number') {
    return;
  }

  const intendedStart = source.indexOf('Effect.sync(');
  const intendedEnd = source.lastIndexOf(';');
  expect.soft(source.slice(start, end)).toBe(source.slice(intendedStart, intendedEnd));
};

describe('effect-no-sync-for-promise undefined reference identity', (): void => {
  it.each(undefinedIdentityCases)('$name', expectReportCount);
});

describe('effect-no-sync-for-promise accessor-backed defaults', (): void => {
  it.each(accessorDefaultCases)('$name', expectReportCount);
});

describe('effect-no-sync-for-promise recursive argument states', (): void => {
  it.each(recursionArgumentCases)('$name', expectReportCount);
});
