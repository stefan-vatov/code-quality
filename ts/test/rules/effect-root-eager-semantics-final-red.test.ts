import { describe, expect, it } from 'vitest';
import { runRule } from './effect-rule-test-utils';

type RuleName = 'effect-no-sync-for-promise' | 'effect-require-suspend-for-recursion';

interface DiagnosticCase {
  expected: number;
  name: string;
  ruleName: RuleName;
  source: string;
}

const diagnosticCount = (ruleName: RuleName, source: string): number =>
  runRule(ruleName, source).length;

const rootNamespaceCases: readonly DiagnosticCase[] = [
  {
    expected: 1,
    name: 'recognizes Root.Effect.sync as the Promise boundary',
    ruleName: 'effect-no-sync-for-promise',
    source: `
      import * as Root from "effect";
      export const task = Root.Effect.sync(() => Promise.resolve(1));
    `,
  },
  {
    expected: 1,
    name: 'recognizes recursive Root.Effect.succeed construction',
    ruleName: 'effect-require-suspend-for-recursion',
    source: `
      import * as Root from "effect";
      export function loop() {
        return Root.Effect.succeed(loop());
      }
    `,
  },
  {
    expected: 1,
    name: 'recognizes a successful Root.Effect.flatMapEager input',
    ruleName: 'effect-require-suspend-for-recursion',
    source: `
      import * as Root from "effect";
      export function loop() {
        return Root.Effect.flatMapEager(Root.Effect.succeed(1), () => loop());
      }
    `,
  },
  {
    expected: 1,
    name: 'recognizes a successful Root.Effect.mapEager input',
    ruleName: 'effect-require-suspend-for-recursion',
    source: `
      import * as Root from "effect";
      export function loop() {
        return Root.Effect.mapEager(Root.Effect.succeed(1), () => loop());
      }
    `,
  },
  {
    expected: 1,
    name: 'recognizes a failed Root.Effect.catchEager input',
    ruleName: 'effect-require-suspend-for-recursion',
    source: `
      import * as Root from "effect";
      export function loop() {
        return Root.Effect.catchEager(Root.Effect.fail("retry"), () => loop());
      }
    `,
  },
  {
    expected: 1,
    name: 'recognizes the selected success branch of Root.Effect.matchCauseEffectEager',
    ruleName: 'effect-require-suspend-for-recursion',
    source: `
      import * as Root from "effect";
      export function loop() {
        return Root.Effect.matchCauseEffectEager(Root.Effect.succeed(1), {
          onFailure: () => Root.Effect.fail("failed"),
          onSuccess: () => loop(),
        });
      }
    `,
  },
  {
    expected: 1,
    name: 'recognizes the selected failure branch of Root.Effect.matchCauseEffectEager',
    ruleName: 'effect-require-suspend-for-recursion',
    source: `
      import * as Root from "effect";
      export function loop() {
        return Root.Effect.matchCauseEffectEager(Root.Effect.fail("retry"), {
          onFailure: () => loop(),
          onSuccess: () => Root.Effect.succeed(1),
        });
      }
    `,
  },
  {
    expected: 1,
    name: 'recognizes immediately reached recursion in Root.Effect.fnUntracedEager',
    ruleName: 'effect-require-suspend-for-recursion',
    source: `
      import * as Root from "effect";
      export const loop = Root.Effect.fnUntracedEager(function* () {
        yield* Root.Effect.succeed(undefined);
        return yield* loop();
      });
    `,
  },
];

const rootNamespaceControls: readonly DiagnosticCase[] = [
  {
    expected: 0,
    name: 'does not treat a Root parameter as the official Promise boundary',
    ruleName: 'effect-no-sync-for-promise',
    source: `
      import * as EffectRoot from "effect";
      export const makeTask = (Root: LocalRoot) =>
        Root.Effect.sync(() => Promise.resolve(1));
      void EffectRoot;
    `,
  },
  {
    expected: 0,
    name: 'does not treat a Root parameter as recursive Effect construction',
    ruleName: 'effect-require-suspend-for-recursion',
    source: `
      import * as EffectRoot from "effect";
      export function loop(Root: LocalRoot) {
        return Root.Effect.succeed(loop(Root));
      }
      void EffectRoot;
    `,
  },
  {
    expected: 0,
    name: 'does not treat a block-local Root as the imported namespace',
    ruleName: 'effect-require-suspend-for-recursion',
    source: `
      import * as Root from "effect";
      export function loop() {
        {
          const Root = localRoot;
          return Root.Effect.succeed(loop());
        }
      }
    `,
  },
  {
    expected: 0,
    name: 'does not infer official provenance for a local Root object',
    ruleName: 'effect-require-suspend-for-recursion',
    source: `
      const Root = localRoot;
      export function loop() {
        return Root.Effect.succeed(loop());
      }
    `,
  },
  {
    expected: 0,
    name: 'keeps recursion inside Root.Effect.sync deferred',
    ruleName: 'effect-require-suspend-for-recursion',
    source: `
      import * as Root from "effect";
      export function loop() {
        return Root.Effect.sync(() => loop());
      }
    `,
  },
];

const eagerInputViabilityCases: readonly DiagnosticCase[] = [
  {
    expected: 1,
    name: 'executes mapEager for a statically successful input',
    ruleName: 'effect-require-suspend-for-recursion',
    source: `
      import { Effect } from "effect";
      export function loop() {
        return Effect.mapEager(Effect.succeed(1), () => loop());
      }
    `,
  },
  {
    expected: 1,
    name: 'executes flatMapEager for a statically successful input',
    ruleName: 'effect-require-suspend-for-recursion',
    source: `
      import { Effect } from "effect";
      export function loop() {
        return Effect.flatMapEager(Effect.succeed(1), () => loop());
      }
    `,
  },
  {
    expected: 1,
    name: 'executes catchEager for a statically failed input',
    ruleName: 'effect-require-suspend-for-recursion',
    source: `
      import { Effect } from "effect";
      export function loop() {
        return Effect.catchEager(Effect.fail("retry"), () => loop());
      }
    `,
  },
  {
    expected: 0,
    name: 'does not execute mapEager for a statically failed input',
    ruleName: 'effect-require-suspend-for-recursion',
    source: `
      import { Effect } from "effect";
      export function loop() {
        return Effect.mapEager(Effect.fail("failed"), () => loop());
      }
    `,
  },
  {
    expected: 0,
    name: 'does not execute flatMapEager for a statically failed input',
    ruleName: 'effect-require-suspend-for-recursion',
    source: `
      import { Effect } from "effect";
      export function loop() {
        return Effect.flatMapEager(Effect.fail("failed"), () => loop());
      }
    `,
  },
  {
    expected: 0,
    name: 'does not execute catchEager for a statically successful input',
    ruleName: 'effect-require-suspend-for-recursion',
    source: `
      import { Effect } from "effect";
      export function loop() {
        return Effect.catchEager(Effect.succeed(1), () => loop());
      }
    `,
  },
  {
    expected: 0,
    name: 'falls back to lazy map for a delayed successful input',
    ruleName: 'effect-require-suspend-for-recursion',
    source: `
      import { Effect } from "effect";
      export function loop() {
        const pending = Effect.delay(Effect.succeed(1), "1 millis");
        return Effect.mapEager(pending, () => loop());
      }
    `,
  },
  {
    expected: 0,
    name: 'falls back to lazy flatMap for a delayed successful input',
    ruleName: 'effect-require-suspend-for-recursion',
    source: `
      import { Effect } from "effect";
      export function loop() {
        const pending = Effect.delay(Effect.succeed(1), "1 millis");
        return Effect.flatMapEager(pending, () => loop());
      }
    `,
  },
  {
    expected: 0,
    name: 'falls back to lazy catch for a delayed failed input',
    ruleName: 'effect-require-suspend-for-recursion',
    source: `
      import { Effect } from "effect";
      export function loop() {
        const pending = Effect.delay(Effect.fail("retry"), "1 millis");
        return Effect.catchEager(pending, () => loop());
      }
    `,
  },
  {
    expected: 0,
    name: 'falls back to lazy map for an unresolved sync input',
    ruleName: 'effect-require-suspend-for-recursion',
    source: `
      import { Effect } from "effect";
      export function loop() {
        return Effect.mapEager(Effect.sync(() => 1), () => loop());
      }
    `,
  },
  {
    expected: 1,
    name: 'executes curried flatMapEager for a statically successful input',
    ruleName: 'effect-require-suspend-for-recursion',
    source: `
      import { Effect } from "effect";
      export function loop() {
        return Effect.flatMapEager(() => loop())(Effect.succeed(1));
      }
    `,
  },
  {
    expected: 0,
    name: 'does not execute curried mapEager for a statically failed input',
    ruleName: 'effect-require-suspend-for-recursion',
    source: `
      import { Effect } from "effect";
      export function loop() {
        return Effect.mapEager(() => loop())(Effect.fail("failed"));
      }
    `,
  },
];

const eagerBranchViabilityCases: readonly DiagnosticCase[] = [
  {
    expected: 0,
    name: 'selects only onSuccess for a successful matchCauseEffectEager input',
    ruleName: 'effect-require-suspend-for-recursion',
    source: `
      import { Effect } from "effect";
      export function loop() {
        return Effect.matchCauseEffectEager(Effect.succeed(1), {
          onFailure: () => loop(),
          onSuccess: () => Effect.succeed(1),
        });
      }
    `,
  },
  {
    expected: 0,
    name: 'selects only onFailure for a failed matchCauseEffectEager input',
    ruleName: 'effect-require-suspend-for-recursion',
    source: `
      import { Effect } from "effect";
      export function loop() {
        return Effect.matchCauseEffectEager(Effect.fail("retry"), {
          onFailure: () => Effect.succeed(1),
          onSuccess: () => loop(),
        });
      }
    `,
  },
  {
    expected: 0,
    name: 'defers both matchCauseEffectEager branches for a delayed input',
    ruleName: 'effect-require-suspend-for-recursion',
    source: `
      import { Effect } from "effect";
      export function loop() {
        return Effect.matchCauseEffectEager(
          Effect.delay(Effect.succeed(1), "1 millis"),
          {
            onFailure: () => loop(),
            onSuccess: () => loop(),
          },
        );
      }
    `,
  },
  {
    expected: 1,
    name: 'executes fnUntracedEager through statically successful yields',
    ruleName: 'effect-require-suspend-for-recursion',
    source: `
      import { Effect } from "effect";
      export const loop = Effect.fnUntracedEager(function* () {
        yield* Effect.succeed(undefined);
        return yield* loop();
      });
    `,
  },
  {
    expected: 0,
    name: 'stops fnUntracedEager execution at the first delayed yield',
    ruleName: 'effect-require-suspend-for-recursion',
    source: `
      import { Effect } from "effect";
      export const loop = Effect.fnUntracedEager(function* () {
        yield* Effect.delay(Effect.succeed(undefined), "1 millis");
        return yield* loop();
      });
    `,
  },
];

describe('official effect root namespace semantics', (): void => {
  it.each(rootNamespaceCases)('$name', ({ expected, ruleName, source }): void => {
    expect(diagnosticCount(ruleName, source)).toBe(expected);
  });

  it.each(rootNamespaceControls)('$name', ({ expected, ruleName, source }): void => {
    expect(diagnosticCount(ruleName, source)).toBe(expected);
  });
});

describe('effect v4 eager input viability', (): void => {
  it.each(eagerInputViabilityCases)('$name', ({ expected, ruleName, source }): void => {
    expect(diagnosticCount(ruleName, source)).toBe(expected);
  });

  it.each(eagerBranchViabilityCases)('$name', ({ expected, ruleName, source }): void => {
    expect(diagnosticCount(ruleName, source)).toBe(expected);
  });
});
