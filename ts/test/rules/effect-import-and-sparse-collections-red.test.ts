import { describe, expect, it } from 'vitest';
import { runRule } from './effect-rule-test-utils';

interface SourceCase {
  name: string;
  reports: number;
  source: string;
}

const sameLinePromiseImportCases: readonly SourceCase[] = [
  {
    name: 'a root namespace import after a statement',
    reports: 1,
    source: `
      const marker = 1; import * as Root from "effect";
      export const task = Root.Effect.sync(() => Promise.resolve(marker));
    `,
  },
  {
    name: 'a named root import after another import',
    reports: 1,
    source: `
      import "./setup"; import { Effect } from "effect";
      export const task = Effect.sync(() => Promise.resolve(1));
    `,
  },
  {
    name: 'an Effect module namespace import after a statement',
    reports: 1,
    source: `
      const marker = 1; import * as Effect from "effect/Effect";
      export const task = Effect.sync(() => Promise.resolve(marker));
    `,
  },
  {
    name: 'a direct sync import after another import',
    reports: 1,
    source: `
      import "./setup"; import { sync } from "effect/Effect";
      export const task = sync(() => Promise.resolve(1));
    `,
  },
];

const importPositionControls: readonly SourceCase[] = [
  {
    name: 'a named root import at the start of the source',
    reports: 1,
    source: `import { Effect } from "effect";
      export const task = Effect.sync(() => Promise.resolve(1));
    `,
  },
  {
    name: 'a named root import beginning on a new line',
    reports: 1,
    source: `
      const marker = 1;
      import { Effect } from "effect";
      export const task = Effect.sync(() => Promise.resolve(marker));
    `,
  },
  {
    name: 'a root namespace import at the start of recursive source',
    reports: 1,
    source: `import * as Root from "effect";
      export function loop() {
        return Root.Effect.succeed(loop());
      }
    `,
  },
];

const localAndShadowControls: readonly SourceCase[] = [
  {
    name: 'a local Root object',
    reports: 0,
    source: `
      const Root = localRoot;
      export const task = Root.Effect.sync(() => Promise.resolve(1));
    `,
  },
  {
    name: 'a shadowed named Effect import',
    reports: 0,
    source: `
      import { Effect } from "effect";
      export function make(Effect: LocalEffect) {
        return Effect.sync(() => Promise.resolve(1));
      }
    `,
  },
  {
    name: 'a local Root object used by recursive code',
    reports: 0,
    source: `
      const Root = localRoot;
      export function loop() {
        return Root.Effect.succeed(loop());
      }
    `,
  },
];

const typeOnlyImportControls: readonly SourceCase[] = [
  {
    name: 'a type-only root Effect import after a statement',
    reports: 0,
    source: `
      const marker = 1; import type { Effect } from "effect";
      export const task = Effect.sync(() => Promise.resolve(marker));
    `,
  },
  {
    name: 'a type-only direct sync import after another import',
    reports: 0,
    source: `
      import "./setup"; import { type sync } from "effect/Effect";
      export const task = sync(() => Promise.resolve(1));
    `,
  },
];

const sparseFindCases: readonly SourceCase[] = [
  {
    name: 'find',
    reports: 1,
    source: `
      import { Effect } from "effect";
      export const task = Effect.sync(() => [,].find(() => Promise.resolve(true)));
    `,
  },
  {
    name: 'findIndex',
    reports: 1,
    source: `
      import { Effect } from "effect";
      export const task = Effect.sync(() => [,].findIndex(() => Promise.resolve(true)));
    `,
  },
  {
    name: 'findLast',
    reports: 1,
    source: `
      import { Effect } from "effect";
      export const task = Effect.sync(() => [,].findLast(() => Promise.resolve(true)));
    `,
  },
  {
    name: 'findLastIndex',
    reports: 1,
    source: `
      import { Effect } from "effect";
      export const task = Effect.sync(() => [,].findLastIndex(() => Promise.resolve(true)));
    `,
  },
];

const holeSkippingCases: readonly SourceCase[] = [
  'map',
  'some',
  'filter',
  'every',
  'flatMap',
  'forEach',
].map((method) => ({
  name: method,
  reports: 0,
  source: `
      import { Effect } from "effect";
      export const task = Effect.sync(() => [,].${method}(() => Promise.resolve(true)));
    `,
}));

const presentElementCases: readonly SourceCase[] = ['map', 'some', 'filter'].map((method) => ({
  name: method,
  reports: 1,
  source: `
    import { Effect } from "effect";
    export const task = Effect.sync(() => [undefined].${method}(() => Promise.resolve(true)));
  `,
}));

describe('Effect import discovery across statement boundaries', (): void => {
  it.each(sameLinePromiseImportCases)(
    'reports Promise construction through $name',
    ({ reports, source }): void => {
      expect(runRule('effect-no-sync-for-promise', source)).toHaveLength(reports);
    },
  );

  it('reports Root.Effect recursion after a same-line statement', (): void => {
    const source = `
      const marker = 1; import * as Root from "effect";
      export function loop() {
        return Root.Effect.succeed(loop());
      }
      void marker;
    `;

    expect(runRule('effect-require-suspend-for-recursion', source)).toHaveLength(1);
  });

  it.each(importPositionControls)('preserves $name', ({ name, reports, source }): void => {
    const ruleName = ((): string => {
      if (name.includes('recursive')) {
        return 'effect-require-suspend-for-recursion';
      }
      return 'effect-no-sync-for-promise';
    })();
    expect(runRule(ruleName, source)).toHaveLength(reports);
  });

  it.each(localAndShadowControls)(
    'does not infer Effect provenance for $name',
    ({ name, source }): void => {
      const ruleName = ((): string => {
        if (name.includes('recursive')) {
          return 'effect-require-suspend-for-recursion';
        }
        return 'effect-no-sync-for-promise';
      })();
      expect(runRule(ruleName, source)).toHaveLength(0);
    },
  );

  it.each(typeOnlyImportControls)(
    'does not infer runtime Effect provenance for $name',
    ({ reports, source }): void => {
      expect(runRule('effect-no-sync-for-promise', source)).toHaveLength(reports);
    },
  );
});

describe('effect-no-sync-for-promise sparse collection execution', (): void => {
  it.each(sparseFindCases)(
    'reports a Promise returned from a $name callback on a sparse slot',
    ({ reports, source }): void => {
      expect(runRule('effect-no-sync-for-promise', source)).toHaveLength(reports);
    },
  );

  it.each(holeSkippingCases)(
    'accepts a $name callback skipped for a sparse slot',
    ({ reports, source }): void => {
      expect(runRule('effect-no-sync-for-promise', source)).toHaveLength(reports);
    },
  );

  it.each(presentElementCases)(
    'reports a Promise returned from a $name callback for a present element',
    ({ reports, source }): void => {
      expect(runRule('effect-no-sync-for-promise', source)).toHaveLength(reports);
    },
  );
});
