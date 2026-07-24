import { describe, expect, it } from 'vitest';
import { runRule } from './effect-rule-test-utils';

interface PromiseEnvironmentCase {
  name: string;
  reports: number;
  source: string;
}

const shorthandLinkingCases: readonly PromiseEnvironmentCase[] = [
  {
    name: 'links shorthand properties to later hoisted unsafe declarations',
    reports: 1,
    source: `
      import { Effect } from "effect";
      const helpers = { load };
      function load() {
        return Promise.resolve(user);
      }
      const task = Effect.sync(() => helpers.load());
    `,
  },
  {
    name: 'links shorthand properties to later hoisted safe block declarations',
    reports: 0,
    source: `
      import { Effect } from "effect";
      function load() {
        return Promise.resolve(user);
      }
      {
        const helpers = { load };
        function load() {
          return user;
        }
        const task = Effect.sync(() => helpers.load());
      }
    `,
  },
];

const parameterEnvironmentCases: readonly PromiseEnvironmentCase[] = [
  {
    name: 'executes an omitted nested default forwarded through a wrapper',
    reports: 1,
    source: `
      import { Effect } from "effect";
      function nested(value = Promise.resolve(user)) {
        return value;
      }
      function forward(value) {
        return nested(value);
      }
      const task = Effect.sync(() => forward());
    `,
  },
  {
    name: 'skips a nested default when the wrapper supplies a concrete value',
    reports: 0,
    source: `
      import { Effect } from "effect";
      function nested(value = Promise.resolve(user)) {
        return value;
      }
      function forward(value) {
        return nested(value);
      }
      const task = Effect.sync(() => forward(user));
    `,
  },
  {
    name: 'executes a Promise-returning callback through a helper parameter',
    reports: 1,
    source: `
      import { Effect } from "effect";
      function invoke(callback) {
        return callback();
      }
      const task = Effect.sync(() => invoke(() => Promise.resolve(user)));
    `,
  },
  {
    name: 'executes an async callback through a helper parameter',
    reports: 1,
    source: `
      import { Effect } from "effect";
      function invoke(callback) {
        return callback();
      }
      const task = Effect.sync(() => invoke(async () => user));
    `,
  },
  {
    name: 'executes an omitted callback default',
    reports: 1,
    source: `
      import { Effect } from "effect";
      function invoke(callback = () => Promise.resolve(user)) {
        return callback();
      }
      const task = Effect.sync(() => invoke());
    `,
  },
  {
    name: 'uses a supplied safe callback instead of its unsafe default',
    reports: 0,
    source: `
      import { Effect } from "effect";
      function invoke(callback = () => Promise.resolve(user)) {
        return callback();
      }
      const task = Effect.sync(() => invoke(() => user));
    `,
  },
  {
    name: 'does not execute a callback parameter that is only returned',
    reports: 0,
    source: `
      import { Effect } from "effect";
      function defer(callback) {
        return callback;
      }
      const task = Effect.sync(() => defer(async () => user));
    `,
  },
  {
    name: 'stays conservative for an invoked callback of unknown provenance',
    reports: 0,
    source: `
      import { Effect } from "effect";
      function make(callback) {
        function invoke(callbackValue) {
          return callbackValue();
        }
        return Effect.sync(() => invoke(callback));
      }
    `,
  },
  {
    name: 'analyzes the same helper separately for safe and unsafe arguments',
    reports: 1,
    source: `
      import { Effect } from "effect";
      function invoke(callback) {
        return callback();
      }
      const task = Effect.sync(() => {
        invoke(() => user);
        return invoke(() => Promise.resolve(user));
      });
    `,
  },
];

const destructuringOrderCases: readonly PromiseEnvironmentCase[] = [
  {
    name: 'uses a safe property from the last ordered static spread',
    reports: 0,
    source: `
      import { Effect } from "effect";
      function load({ value = Promise.resolve(user) }) {
        return value;
      }
      const task = Effect.sync(() => load({ value: undefined, ...{ value: user } }));
    `,
  },
  {
    name: 'uses an explicit undefined property after an ordered static spread',
    reports: 1,
    source: `
      import { Effect } from "effect";
      function load({ value = Promise.resolve(user) }) {
        return value;
      }
      const task = Effect.sync(() => load({ ...{ value: user }, value: undefined }));
    `,
  },
  {
    name: 'stays conservative when an unknown trailing spread can overwrite undefined',
    reports: 0,
    source: `
      import { Effect } from "effect";
      function make(other) {
        function load({ value = Promise.resolve(user) }) {
          return value;
        }
        return Effect.sync(() => load({ value: undefined, ...other }));
      }
    `,
  },
  {
    name: 'executes a default when undefined follows an unknown spread',
    reports: 1,
    source: `
      import { Effect } from "effect";
      function make(other) {
        function load({ value = Promise.resolve(user) }) {
          return value;
        }
        return Effect.sync(() => load({ ...other, value: undefined }));
      }
    `,
  },
];

const expectReportCount = ({ reports, source }: PromiseEnvironmentCase): void => {
  expect(runRule('effect-no-sync-for-promise', source)).toHaveLength(reports);
};

describe('effect-no-sync-for-promise shorthand declaration linking', (): void => {
  it.each(shorthandLinkingCases)('$name', expectReportCount);
});

describe('effect-no-sync-for-promise abstract parameter environments', (): void => {
  it.each(parameterEnvironmentCases)('$name', expectReportCount);
});

describe('effect-no-sync-for-promise object destructuring order', (): void => {
  it.each(destructuringOrderCases)('$name', expectReportCount);
});
