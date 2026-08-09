import { describe, expect, it } from 'vitest';
import { runRule } from './effect-rule-test-utils';

interface SourceCase {
  name: string;
  reports: number;
  source: string;
}

const importPositionControls: readonly SourceCase[] = [
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

describe('Effect import discovery across statement boundaries', (): void => {
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

  it.each(importPositionControls)('preserves $name', ({ reports, source }): void => {
    expect(runRule('effect-require-suspend-for-recursion', source)).toHaveLength(reports);
  });

  it.each(localAndShadowControls)(
    'does not infer Effect provenance for $name',
    ({ source }): void => {
      expect(runRule('effect-require-suspend-for-recursion', source)).toHaveLength(0);
    },
  );
});
