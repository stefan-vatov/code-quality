import { describe, expect, it } from 'vitest';
import { parseSync } from 'oxc-parser';
import { runRule } from './effect-rule-test-utils';

interface PromiseCompletionCase {
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
const expectedMessage =
  'Use Effect.tryPromise for Promise-returning code instead of Effect.sync.\n' +
  'Fix: Return an Effect from library code and run it only at the configured application boundary.\n' +
  'Example:\n' +
  '```ts\n' +
  'export const loadUser = Effect.fn("loadUser")(function* (id: UserId) {\n' +
  '  return yield* UserRepo.find(id)\n' +
  '})\n' +
  '```';

const callOrderSource = (expression: string): string => `
  import { Effect } from "effect";

  const user = { id: 1 };

  function ignore(_first: unknown, _second: unknown): typeof user {
    return user;
  }

  function safe(): typeof user {
    return user;
  }

  function stop(): never {
    throw new Error("stop");
  }

  const task = Effect.sync(() => ${expression});
  export { task };
`;

const callArgumentCases: readonly PromiseCompletionCase[] = [
  {
    name: 'stops before a later Promise argument after abrupt completion',
    reports: 0,
    source: callOrderSource('ignore(stop(), Promise.resolve(user))'),
  },
  {
    name: 'reports a Promise argument evaluated before a later throw',
    reports: 1,
    representative: true,
    source: callOrderSource('ignore(Promise.resolve(user), stop())'),
  },
  {
    name: 'reports a Promise argument after an earlier safe argument',
    reports: 1,
    source: callOrderSource('ignore(safe(), Promise.resolve(user))'),
  },
  {
    name: 'accepts a throwing-only call',
    reports: 0,
    source: callOrderSource('ignore(stop(), user)'),
  },
  {
    name: 'stops inside a nested argument before its later Promise argument',
    reports: 0,
    source: callOrderSource('ignore(safe(), ignore(stop(), Promise.resolve(user)))'),
  },
  {
    name: 'reports a nested Promise argument evaluated before a nested throw',
    reports: 1,
    source: callOrderSource('ignore(safe(), ignore(Promise.resolve(user), stop()))'),
  },
];

const unaryTruthinessSource = (expression: string): string => `
  import { Effect } from "effect";
  const user = { id: 1 };
  const task = Effect.sync(() => ${expression});
  export { task };
`;

const unaryTruthinessCases: readonly PromiseCompletionCase[] = [
  {
    name: 'treats negative one as truthy for logical AND',
    reports: 1,
    representative: true,
    source: unaryTruthinessSource('-1 && Promise.resolve(user)'),
  },
  {
    name: 'treats unary positive zero as falsy for logical OR',
    reports: 1,
    source: unaryTruthinessSource('+0 || Promise.resolve(user)'),
  },
  {
    name: 'treats logical NOT one as falsy for logical OR',
    reports: 1,
    source: unaryTruthinessSource('!1 || Promise.resolve(user)'),
  },
  {
    name: 'short-circuits logical AND for negative zero',
    reports: 0,
    source: unaryTruthinessSource('-0 && Promise.resolve(user)'),
  },
  {
    name: 'short-circuits logical OR for unary positive one',
    reports: 0,
    source: unaryTruthinessSource('+1 || Promise.resolve(user)'),
  },
  {
    name: 'treats logical NOT zero as truthy for logical AND',
    reports: 1,
    source: unaryTruthinessSource('!0 && Promise.resolve(user)'),
  },
  {
    name: 'stays conservative for an unknown unary numeric operand',
    reports: 0,
    source: `
      import { Effect } from "effect";

      export function makeTask(value: number) {
        const user = { id: 1 };
        return Effect.sync(() => +value || Promise.resolve(user));
      }
    `,
  },
  {
    name: 'does not treat a shadowed undefined parameter as the global value',
    reports: 0,
    source: `
      import { Effect } from "effect";

      export function makeTask(undefined: number) {
        const user = { id: 1 };
        return Effect.sync(() => +undefined || Promise.resolve(user));
      }
    `,
  },
];

const getterOrderSource = (
  bindingOrder: 'first-later' | 'later-first',
  firstBody: string,
): string => {
  const parameter = ((): string => {
    if (bindingOrder === 'first-later') {
      return '{ first, later }: { first: unknown; later: UserResult }';
    }
    return '{ later, first }: { first: unknown; later: UserResult }';
  })();
  const properties =
    bindingOrder === 'first-later'
      ? `
        get later() {
          return Promise.resolve(user);
        },
        get first() {
          ${firstBody}
        },
      `
      : `
        get first() {
          ${firstBody}
        },
        get later() {
          return Promise.resolve(user);
        },
      `;
  return `
    import { Effect } from "effect";

    const user = { id: 1 };
    type UserResult = typeof user | Promise<typeof user>;

    function load(${parameter}): UserResult {
      void first;
      return later;
    }

    const input = {
      ${properties}
    };
    const task = Effect.sync(() => load(input));
    export { task };
  `;
};

const getterCompletionCases: readonly PromiseCompletionCase[] = [
  {
    name: 'stops before a later Promise getter after a provably true conditional throw',
    reports: 0,
    source: getterOrderSource(
      'first-later',
      `
        if (true) {
          throw new Error("stop");
        }
        return user;
      `,
    ),
  },
  {
    name: 'continues to a later Promise getter after a provably false conditional throw',
    reports: 1,
    source: getterOrderSource(
      'first-later',
      `
        if (false) {
          throw new Error("unreachable");
        }
        return user;
      `,
    ),
  },
  {
    name: 'stops before a later Promise getter after a throw in a nested block',
    reports: 0,
    source: getterOrderSource(
      'first-later',
      `
        {
          {
            throw new Error("stop");
          }
        }
      `,
    ),
  },
  {
    name: 'stays conservative when an earlier getter may throw or return',
    reports: 0,
    source: `
      import { Effect } from "effect";

      const user = { id: 1 };
      type UserResult = typeof user | Promise<typeof user>;

      export function makeTask(condition: boolean) {
        function load({ first, later }: { first: unknown; later: UserResult }): UserResult {
          void first;
          return later;
        }

        const input = {
          get later() {
            return Promise.resolve(user);
          },
          get first() {
            if (condition) {
              throw new Error("stop");
            }
            return user;
          },
        };
        return Effect.sync(() => load(input));
      }
    `,
  },
  {
    name: 'reports a Promise getter read before a later conditional throw',
    reports: 1,
    representative: true,
    source: getterOrderSource(
      'later-first',
      `
        if (unknownCondition) {
          throw new Error("stop");
        }
        return user;
      `,
    ).replace(
      'const user = { id: 1 };',
      'const user = { id: 1 };\n    declare const unknownCondition: boolean;',
    ),
  },
  {
    name: 'reports a Promise side effect inside a getter before it throws',
    reports: 1,
    source: getterOrderSource(
      'first-later',
      `
        Promise.resolve(user);
        throw new Error("stop");
      `,
    ),
  },
];

const expectPromiseCompletion = ({
  reports,
  representative,
  source,
}: PromiseCompletionCase): void => {
  expect(parseSync('completion-case.ts', source, { sourceType: 'module' }).errors).toHaveLength(0);
  const actualReports = runRule(ruleName, source);
  expect(actualReports).toHaveLength(reports);
  if (!representative || reports !== 1 || actualReports.length !== 1) {
    return;
  }

  const [report] = actualReports;
  expect.soft(report?.message).toBe(expectedMessage);
  expect.soft(report?.node).toMatchObject({ type: 'CallExpression' });
  const { end, start } = report?.node as LocatedCallNode;
  const expectedStart = source.indexOf('Effect.sync(');
  const expectedEnd = source.indexOf(';', expectedStart);
  expect.soft({ end, start }).toEqual({ end: expectedEnd, start: expectedStart });
  expect.soft(source.slice(start, end)).toBe(source.slice(expectedStart, expectedEnd));
};

describe('effect-no-sync-for-promise completion and unary truthiness', (): void => {
  it.each(callArgumentCases)('$name', expectPromiseCompletion);
  it.each(unaryTruthinessCases)('$name', expectPromiseCompletion);
  it.each(getterCompletionCases)('$name', expectPromiseCompletion);
});
