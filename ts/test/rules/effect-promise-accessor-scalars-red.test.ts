import { describe, expect, it } from 'vitest';
import { runRule } from './effect-rule-test-utils';

interface PromiseAccessorScalarCase {
  name: string;
  reports: 0 | 1;
  source: string;
}

interface LocatedCallNode {
  end?: number;
  start?: number;
  type?: string;
}

type NamedPromiseAccessorScalarCase = PromiseAccessorScalarCase & { contract: string };

const expectedMessage =
  'Use Effect.tryPromise for Promise-returning code instead of Effect.sync.\n' +
  'Fix: Return an Effect from library code and run it only at the configured application boundary.\n' +
  'Example:\n' +
  '```ts\n' +
  'export const loadUser = Effect.fn("loadUser")(function* (id: UserId) {\n' +
  '  return yield* UserRepo.find(id)\n' +
  '})\n' +
  '```';

const accessorSource = (
  members: string,
  parameter = '{ value = Promise.resolve(user) }: { value?: UserValue }',
): string => `
  import { Effect } from "effect";
  const user = { id: 1 };
  type UserValue = typeof user | Promise<typeof user> | undefined;
  function load(${parameter}) {
    return value;
  }
  const input = {
    ${members}
  };
  const task = Effect.sync(() => load(input));
`;

const getterThenSetter = (getterBody: string, setterBody = ''): string => `
  get value() {
    ${getterBody}
  },
  set value(_nextValue: UserValue) {
    ${setterBody}
  },
`;

const setterThenGetter = (getterBody: string, setterBody = ''): string => `
  set value(_nextValue: UserValue) {
    ${setterBody}
  },
  get value() {
    ${getterBody}
  },
`;

const pairedDescriptorCases: readonly PromiseAccessorScalarCase[] = [
  {
    name: 'reads a safe getter when it precedes its paired setter',
    reports: 0,
    source: accessorSource(getterThenSetter('return user;')),
  },
  {
    name: 'reads a safe getter when it follows its paired setter',
    reports: 0,
    source: accessorSource(setterThenGetter('return user;')),
  },
  {
    name: 'reports a Promise getter when it precedes its paired setter',
    reports: 1,
    source: accessorSource(
      getterThenSetter('return Promise.resolve(user);'),
      '{ value }: { value: UserValue }',
    ),
  },
  {
    name: 'reports a Promise getter when it follows its paired setter',
    reports: 1,
    source: accessorSource(
      setterThenGetter('return Promise.resolve(user);'),
      '{ value }: { value: UserValue }',
    ),
  },
  {
    name: 'executes a default after an undefined getter preceding its paired setter',
    reports: 1,
    source: accessorSource(getterThenSetter('return undefined;')),
  },
  {
    name: 'executes a default after an undefined getter following its paired setter',
    reports: 1,
    source: accessorSource(setterThenGetter('return undefined;')),
  },
  {
    name: 'does not execute the body of a setter paired after a safe getter',
    reports: 0,
    source: accessorSource(
      getterThenSetter('return user;', 'Promise.resolve(user);'),
      '{ value }: { value: UserValue }',
    ),
  },
  {
    name: 'does not execute the body of a setter paired before a safe getter',
    reports: 0,
    source: accessorSource(
      setterThenGetter('return user;', 'Promise.resolve(user);'),
      '{ value }: { value: UserValue }',
    ),
  },
  {
    name: 'does not treat a setter-only body as the result of a property read',
    reports: 0,
    source: accessorSource(
      `
        set value(_nextValue: UserValue) {
          Promise.resolve(user);
        },
      `,
      '{ value }: { value: UserValue }',
    ),
  },
];

const getterFlowCases: readonly PromiseAccessorScalarCase[] = [
  {
    name: 'executes a default after an empty getter returns undefined',
    reports: 1,
    source: accessorSource(`
      // @ts-expect-error -- Empty JavaScript getters return undefined at runtime.
      get value(): undefined {}
    `),
  },
  {
    name: 'executes a default after a multi-statement getter returns undefined',
    reports: 1,
    source: accessorSource(`
      get value() {
        const selected = user;
        void selected;
        return undefined;
      },
    `),
  },
  {
    name: 'accepts a multi-statement getter with a concrete return',
    reports: 0,
    source: accessorSource(`
      get value() {
        const selected = user;
        return selected;
      },
    `),
  },
  {
    name: 'reports a Promise side effect before a safe getter return',
    reports: 1,
    source: accessorSource(
      `
        get value() {
          Promise.resolve(user);
          return user;
        },
      `,
      '{ value }: { value: UserValue }',
    ),
  },
  {
    name: 'stays conservative for a conditional getter result',
    reports: 0,
    source: `
      import { Effect } from "effect";
      const user = { id: 1 };
      type UserValue = typeof user | Promise<typeof user> | undefined;
      function make(condition: boolean) {
        function load({ value = Promise.resolve(user) }: { value?: UserValue }) {
          return value;
        }
        const input = {
          get value() {
            return condition ? undefined : user;
          },
        };
        return Effect.sync(() => load(input));
      }
      export { make };
    `,
  },
  {
    name: 'stays conservative for a getter returning an unknown input',
    reports: 0,
    source: `
      import { Effect } from "effect";
      const user = { id: 1 };
      type UserValue = typeof user | Promise<typeof user> | undefined;
      function make(value: typeof user | undefined) {
        function load({ value: selected = Promise.resolve(user) }: { value?: UserValue }) {
          return selected;
        }
        const input = {
          get value() {
            return value;
          },
        };
        return Effect.sync(() => load(input));
      }
      export { make };
    `,
  },
];

const scalarSource = (
  declaration: string,
  argument: string,
  placement: 'before' | 'after' = 'before',
): string => {
  const before = placement === 'before' ? declaration : '';
  const after = placement === 'after' ? declaration : '';
  return `
    import { Effect } from "effect";
    const user = { id: 1 };
    type UserValue = typeof user | Promise<typeof user> | undefined;
    ${before}
    function load(value: UserValue = Promise.resolve(user)) {
      return value;
    }
    const task = Effect.sync(() => load(${argument}));
    ${after}
  `;
};

const scalarForwardingCases: readonly PromiseAccessorScalarCase[] = [
  {
    name: 'forwards a top-level const binding named undefined as void zero',
    reports: 1,
    source: scalarSource('const undefined = void 0;', 'undefined'),
  },
  {
    name: 'forwards a top-level let binding named undefined as void zero',
    reports: 1,
    source: scalarSource('let undefined = void 0;', 'undefined'),
  },
  {
    name: 'forwards a top-level const scalar containing void zero',
    reports: 1,
    source: scalarSource('const supplied = void 0;', 'supplied'),
  },
  {
    name: 'forwards an uninitialized top-level let scalar as undefined',
    reports: 1,
    source: scalarSource('let supplied;', 'supplied'),
  },
  {
    name: 'accepts a concrete top-level const scalar',
    reports: 0,
    source: scalarSource('const supplied = user;', 'supplied'),
  },
  {
    name: 'accepts a concrete top-level let scalar',
    reports: 0,
    source: scalarSource('let supplied = user;', 'supplied'),
  },
  {
    name: 'resolves a later const void-zero binding captured by the lazy callback',
    reports: 1,
    source: scalarSource('const supplied = void 0;', 'supplied', 'after'),
  },
  {
    name: 'resolves a later concrete const binding captured by the lazy callback',
    reports: 0,
    source: scalarSource('const supplied = user;', 'supplied', 'after'),
  },
  {
    name: 'forwards a void-zero scalar through a helper parameter',
    reports: 1,
    source: `
      import { Effect } from "effect";
      const user = { id: 1 };
      type UserValue = typeof user | Promise<typeof user> | undefined;
      const supplied = void 0;
      function load(value: UserValue = Promise.resolve(user)) {
        return value;
      }
      function forward(value: typeof user | undefined) {
        return load(value);
      }
      const task = Effect.sync(() => forward(supplied));
    `,
  },
  {
    name: 'forwards a concrete scalar through a helper parameter',
    reports: 0,
    source: `
      import { Effect } from "effect";
      const user = { id: 1 };
      type UserValue = typeof user | Promise<typeof user> | undefined;
      const supplied = user;
      function load(value: UserValue = Promise.resolve(user)) {
        return value;
      }
      function forward(value: typeof user | undefined) {
        return load(value);
      }
      const task = Effect.sync(() => forward(supplied));
    `,
  },
];

const expectPromiseCase = ({ reports, source }: PromiseAccessorScalarCase): void => {
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
  cases: readonly PromiseAccessorScalarCase[],
): readonly NamedPromiseAccessorScalarCase[] =>
  cases.map(
    (testCase): NamedPromiseAccessorScalarCase => ({
      ...testCase,
      contract: testCase.reports === 1 ? 'semantic + exact Promise guidance' : 'semantic',
    }),
  );

describe('effect-no-sync-for-promise paired accessor descriptors', (): void => {
  it.each(namedCases(pairedDescriptorCases))('$name [$contract]', expectPromiseCase);
});

describe('effect-no-sync-for-promise getter execution flow', (): void => {
  it.each(namedCases(getterFlowCases))('$name [$contract]', expectPromiseCase);
});

describe('effect-no-sync-for-promise top-level scalar forwarding', (): void => {
  it.each(namedCases(scalarForwardingCases))('$name [$contract]', expectPromiseCase);
});
