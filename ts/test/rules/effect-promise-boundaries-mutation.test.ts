import { describe, expect, it } from 'vitest';
import { hasSyncForPromise } from '../../src/rules/effect-default-workflow-helpers';
import { runRule } from './effect-rule-test-utils';

type SourceCase = readonly [name: string, source: string];

const globalPromiseCases: readonly SourceCase[] = [
  ['Promise.resolve with type arguments', 'Effect.sync(() => Promise.resolve<User>(user));'],
  [
    'Promise.reject with type arguments',
    'Effect.sync(() => Promise.reject<DomainError>(domainError));',
  ],
  [
    'Promise.all with type arguments',
    'Effect.sync(() => Promise.all<readonly [Promise<User>]>([loadUser()]));',
  ],
  [
    'Promise.allSettled with type arguments',
    'Effect.sync(() => Promise.allSettled<User>([loadUser()]));',
  ],
  ['Promise.any with type arguments', 'Effect.sync(() => Promise.any<User>([loadUser()]));'],
  ['Promise.race with type arguments', 'Effect.sync(() => Promise.race<User>([loadUser()]));'],
  [
    'new Promise with type arguments',
    'Effect.sync(() => new Promise<User>((resolve) => resolve(user)));',
  ],
  ['global fetch', 'Effect.sync(() => fetch("/users/1"));'],
];

const aliasedEffectCases: readonly SourceCase[] = [
  [
    'aliased root Effect import',
    'import { Effect as Fx } from "effect";\nconst task = Fx.sync(() => Promise.resolve<User>(user));',
  ],
  [
    'aliased Effect namespace import',
    'import * as Fx from "effect/Effect";\nconst task = Fx.sync(() => fetch("/users/1"));',
  ],
  [
    'aliased named sync import',
    'import { sync as syncEffect } from "effect/Effect";\nconst task = syncEffect(() => Promise.resolve<User>(user));',
  ],
];

const immediatelyInvokedCallbackCases: readonly SourceCase[] = [
  [
    'an immediately invoked arrow that calls Promise',
    'const task = Effect.sync(() => (() => Promise.resolve(user))());',
  ],
  [
    'an immediately invoked function expression that calls fetch',
    'const task = Effect.sync(() => (function () { return fetch("/users/1"); })());',
  ],
  [
    'an immediately invoked block callback with two Promise boundaries',
    `
      const task = Effect.sync(() => (() => {
        const first = Promise.resolve(firstUser);
        return Promise.resolve(secondUser).then(() => first);
      })());
    `,
  ],
  [
    'an immediately invoked callback through an aliased named sync import',
    `
      import { sync as syncEffect } from "effect/Effect";
      const task = syncEffect(() => (function () { return fetch("/users/1"); })());
    `,
  ],
];

const deferredReturnedCallbackCases: readonly SourceCase[] = [
  [
    'a returned arrow that defers Promise work',
    'const makeTask = Effect.sync(() => () => Promise.resolve(user));',
  ],
  [
    'a returned function expression that defers fetch work',
    'const makeTask = Effect.sync(() => function () { return fetch("/users/1"); });',
  ],
  [
    'a returned callback through an aliased Effect namespace',
    `
      import * as Fx from "effect/Effect";
      const makeTask = Fx.sync(() => () => Promise.resolve(user));
    `,
  ],
];

const typeOnlyImportCases: readonly SourceCase[] = [
  [
    'an import type Promise binding',
    `
      import type { Promise } from "./types";
      const task = Effect.sync(() => Promise.resolve(user));
    `,
  ],
  [
    'an inline type-only Promise binding',
    `
      import { type Promise } from "./types";
      const task = Effect.sync(() => Promise.resolve(user));
    `,
  ],
  [
    'an aliased import type Promise binding',
    `
      import type { RemotePromise as Promise } from "./types";
      const task = Effect.sync(() => Promise.resolve(user));
    `,
  ],
  [
    'an import type fetch binding',
    `
      import type { fetch } from "./types";
      const task = Effect.sync(() => fetch("/users/1"));
    `,
  ],
  [
    'an aliased inline type-only fetch binding',
    `
      import { type RemoteFetch as fetch } from "./types";
      const task = Effect.sync(() => fetch("/users/1"));
    `,
  ],
];

const runtimeImportControlCases: readonly SourceCase[] = [
  [
    'a runtime Promise import',
    `
      import { Promise } from "./runtime";
      const task = Effect.sync(() => Promise.resolve(user));
    `,
  ],
  [
    'a runtime fetch import',
    `
      import { fetch } from "./runtime";
      const task = Effect.sync(() => fetch("/users/1"));
    `,
  ],
];

const safeBoundaryCases: readonly SourceCase[] = [
  ['Promise.withResolvers', 'const handles = Effect.sync(() => Promise.withResolvers());'],
  [
    'Promise.withResolvers with type arguments',
    'const handles = Effect.sync(() => Promise.withResolvers<User>());',
  ],
  ['Promise on a local object', 'const task = Effect.sync(() => local.Promise.resolve(user));'],
  [
    'Promise in a deeper property chain',
    'const task = Effect.sync(() => registry.platform.Promise.resolve(user));',
  ],
  [
    'lexically shadowed Promise parameter',
    'const make = (Promise: PromiseConstructor) => Effect.sync(() => Promise.resolve(user));',
  ],
  [
    'lexically shadowed Promise local',
    'const Promise = localPromise;\nconst task = Effect.sync(() => Promise.resolve(user));',
  ],
  [
    'lexically shadowed fetch parameter',
    'const make = (fetch: FetchClient) => Effect.sync(() => fetch("/users/1"));',
  ],
  [
    'lexically shadowed fetch local',
    'const fetch = client.fetch;\nconst task = Effect.sync(() => fetch("/users/1"));',
  ],
  [
    'Promise in a sibling nested callback',
    'register(() => Effect.sync(() => user), () => Promise.resolve(user));',
  ],
  [
    'fetch in a callback after the Effect.sync boundary',
    'const task = Effect.sync(() => user);\nqueueMicrotask(() => fetch("/users/1"));',
  ],
  [
    'deferred callback returned by Effect.sync',
    'const make = Effect.sync(() => () => Promise.resolve(user));',
  ],
  ['idiomatic Effect.tryPromise', 'const task = Effect.tryPromise(() => Promise.resolve(user));'],
  ['synchronous Effect.sync body', 'const task = Effect.sync(() => user);'],
];

const laterFileBindingCases: readonly SourceCase[] = [
  [
    'later const Promise binding',
    `
      const task = Effect.sync(() => Promise.resolve(user));
      const Promise = localPromise;
    `,
  ],
  [
    'later const fetch binding',
    `
      const task = Effect.sync(() => fetch("/users/1"));
      const fetch = localFetch;
    `,
  ],
  [
    'later function bindings',
    `
      const promiseTask = Effect.sync(() => Promise.resolve(user));
      const fetchTask = Effect.sync(() => fetch("/users/1"));
      function Promise() { return localPromise; }
      function fetch() { return localResponse; }
    `,
  ],
  [
    'later class bindings',
    `
      const promiseTask = Effect.sync(() => Promise.resolve(user));
      const fetchTask = Effect.sync(() => fetch("/users/1"));
      class Promise {}
      class fetch {}
    `,
  ],
  [
    'later import bindings',
    `
      const promiseTask = Effect.sync(() => Promise.resolve(user));
      const fetchTask = Effect.sync(() => fetch("/users/1"));
      import {
        CustomPromise as Promise,
        customFetch as fetch,
      } from "./runtime";
    `,
  ],
];

const scopedBindingCases: readonly SourceCase[] = [
  [
    'a Promise binding around only the first callback',
    `
      {
        const localTask = Effect.sync(() => Promise.resolve(user));
        const Promise = localPromise;
      }
      const ambientTask = Effect.sync(() => Promise.resolve(user));
    `,
  ],
  [
    'a fetch binding in a sibling block',
    `
      {
        const fetch = localFetch;
        consume(fetch);
      }
      {
        const ambientTask = Effect.sync(() => fetch("/users/1"));
      }
    `,
  ],
  [
    'Promise and fetch bindings in a nested function',
    `
      function makeLocalTasks() {
        const localPromiseTask = Effect.sync(() => Promise.resolve(user));
        const localFetchTask = Effect.sync(() => fetch("/users/1"));
        const Promise = localPromise;
        const fetch = localFetch;
        return [localPromiseTask, localFetchTask];
      }
      const ambientTask = Effect.sync(() => Promise.resolve(user));
    `,
  ],
  [
    'Promise and fetch bindings in a later sibling function',
    `
      const ambientTask = Effect.sync(() => fetch("/users/1"));
      function makeLocalTasks() {
        const localTask = Effect.sync(() => Promise.resolve(user));
        const Promise = localPromise;
        return localTask;
      }
    `,
  ],
];

const ambientAcrossUnrelatedDeclarations = `
  const promiseBefore = Effect.sync(() => Promise.resolve(user));
  const fetchBefore = Effect.sync(() => fetch("/users/before"));
  const unrelatedValue = 1;
  function unrelatedFunction() { return unrelatedValue; }
  const promiseAfter = Effect.sync(() => Promise.resolve(otherUser));
  const fetchAfter = Effect.sync(() => fetch("/users/1"));
`;

describe('hasSyncForPromise direct contracts', (): void => {
  it.each(globalPromiseCases)('detects global %s', (_name, source): void => {
    expect(hasSyncForPromise(source)).toBe(true);
  });

  it.each(aliasedEffectCases)('detects %s', (_name, source): void => {
    expect(hasSyncForPromise(source)).toBe(true);
  });

  it.each(immediatelyInvokedCallbackCases)('detects %s', (_name, source): void => {
    expect(hasSyncForPromise(source)).toBe(true);
  });

  it.each(deferredReturnedCallbackCases)('allows %s', (_name, source): void => {
    expect(hasSyncForPromise(source)).toBe(false);
  });

  it.each(typeOnlyImportCases)('does not treat %s as a runtime shadow', (_name, source): void => {
    expect(hasSyncForPromise(source)).toBe(true);
  });

  it.each(runtimeImportControlCases)('respects %s', (_name, source): void => {
    expect(hasSyncForPromise(source)).toBe(false);
  });

  it.each(safeBoundaryCases)('allows %s', (_name, source): void => {
    expect(hasSyncForPromise(source)).toBe(false);
  });

  it('ignores Promise and fetch syntax in comments and strings', (): void => {
    const source = `
      Effect.sync(() => user);
      // Effect.sync(() => Promise.resolve<User>(user));
      const documentation = "Effect.sync(() => fetch('/users/1'))";
    `;

    expect(hasSyncForPromise(source)).toBe(false);
  });

  it.each(laterFileBindingCases)(
    'resolves a %s across the complete file scope',
    (_name, source): void => {
      expect(hasSyncForPromise(source)).toBe(false);
    },
  );

  it.each(scopedBindingCases)('does not leak %s into an ambient scope', (_name, source): void => {
    expect(hasSyncForPromise(source)).toBe(true);
  });

  it('detects ambient Promise and fetch references across unrelated declarations', (): void => {
    expect(hasSyncForPromise(ambientAcrossUnrelatedDeclarations)).toBe(true);
  });
});

describe('effect-no-sync-for-promise AST boundary contracts', (): void => {
  it.each(globalPromiseCases)('reports global %s exactly once', (_name, source): void => {
    expect(runRule('effect-no-sync-for-promise', source)).toHaveLength(1);
  });

  it.each(aliasedEffectCases)('reports %s exactly once', (_name, source): void => {
    expect(runRule('effect-no-sync-for-promise', source)).toHaveLength(1);
  });

  it.each(immediatelyInvokedCallbackCases)('reports %s exactly once', (_name, source): void => {
    expect(runRule('effect-no-sync-for-promise', source)).toHaveLength(1);
  });

  it.each(deferredReturnedCallbackCases)('does not report %s', (_name, source): void => {
    expect(runRule('effect-no-sync-for-promise', source)).toHaveLength(0);
  });

  it.each(typeOnlyImportCases)(
    'reports the global runtime beside %s exactly once',
    (_name, source): void => {
      expect(runRule('effect-no-sync-for-promise', source)).toHaveLength(1);
    },
  );

  it.each(runtimeImportControlCases)('does not report %s', (_name, source): void => {
    expect(runRule('effect-no-sync-for-promise', source)).toHaveLength(0);
  });

  it.each(safeBoundaryCases)('does not report %s', (_name, source): void => {
    expect(runRule('effect-no-sync-for-promise', source)).toHaveLength(0);
  });

  it('does not report a Promise call outside the Effect.sync boundary', (): void => {
    const source = `
      const first = Effect.sync(() => Promise.resolve<User>(user));
      const outside = Promise.reject<DomainError>(domainError);
    `;

    expect(runRule('effect-no-sync-for-promise', source)).toHaveLength(1);
  });

  it.each(laterFileBindingCases)(
    'does not report a reference resolved to a %s',
    (_name, source): void => {
      expect(runRule('effect-no-sync-for-promise', source)).toHaveLength(0);
    },
  );

  it.each(scopedBindingCases)(
    'reports only the ambient reference beside %s',
    (_name, source): void => {
      expect(runRule('effect-no-sync-for-promise', source)).toHaveLength(1);
    },
  );

  it('reports ambient Promise and fetch references around unrelated declarations', (): void => {
    expect(runRule('effect-no-sync-for-promise', ambientAcrossUnrelatedDeclarations)).toHaveLength(
      4,
    );
  });
});
