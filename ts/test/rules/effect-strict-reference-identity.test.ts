/* -------------------------------------------------------------------------- */
/*      Reference-identity contracts for strict AST-backed Effect rules.      */
/* -------------------------------------------------------------------------- */
import { describe, expect, it } from 'vitest';
import { runRule } from './effect-rule-test-utils';

interface ReferenceIdentityCase {
  label: string;
  source: string;
}

const effectVoidReferenceCases: readonly ReferenceIdentityCase[] = [
  {
    label: 'root Effect alias and an unrelated local Effect binding',
    source: `
      import { Effect as Fx } from "effect";
      const Effect = LocalEffect;
      const importedDone = Fx.succeed(undefined);
      const localDone = Effect.succeed(undefined);
    `,
  },
  {
    label: 'root Effect import shadowed by a function parameter',
    source: `
      import { Effect } from "effect";
      const importedDone = Effect.succeed(undefined);
      function localDone(Effect: LocalEffect) {
        return Effect.succeed(undefined);
      }
    `,
  },
  {
    label: 'root Effect alias shadowed by a block-local binding',
    source: `
      import { Effect as Fx } from "effect";
      const importedDone = Fx.succeed(undefined);
      {
        const Fx = LocalEffect;
        const localDone = Fx.succeed(undefined);
      }
    `,
  },
  {
    label: 'effect/Effect namespace alias and an unrelated local Effect binding',
    source: `
      import * as Fx from "effect/Effect";
      const Effect = LocalEffect;
      const importedDone = Fx.succeed(undefined);
      const localDone = Effect.succeed(undefined);
    `,
  },
  {
    label: 'effect/Effect namespace alias shadowed by a function parameter',
    source: `
      import * as Fx from "effect/Effect";
      const importedDone = Fx.succeed(undefined);
      const localDone = (Fx: LocalEffect) => Fx.succeed(undefined);
    `,
  },
  {
    label: 'effect/Effect named alias shadowed by a function parameter',
    source: `
      import { succeed as ok } from "effect/Effect";
      const importedDone = ok(undefined);
      const localDone = (ok: LocalSucceed) => ok(undefined);
    `,
  },
  {
    label: 'effect/Effect named import shadowed by a block-local binding',
    source: `
      import { succeed } from "effect/Effect";
      const importedDone = succeed(undefined);
      {
        const succeed = localSucceed;
        const localDone = succeed(undefined);
      }
    `,
  },
];

describe('strict Effect rule reference identity', (): void => {
  it.each(effectVoidReferenceCases)(
    'reports only the imported value reference for $label',
    ({ source }): void => {
      expect(runRule('effect-prefer-effect-void', source)).toHaveLength(1);
    },
  );

  it('allows every call when the imported root alias is shadowed', (): void => {
    const source = `
      import { Effect as Fx } from "effect";
      function localDone(Fx: LocalEffect) {
        return Fx.succeed(undefined);
      }
    `;

    expect(runRule('effect-prefer-effect-void', source)).toHaveLength(0);
  });

  it('allows every call when the imported named function is shadowed', (): void => {
    const source = `
      import { succeed as ok } from "effect/Effect";
      function localDone(ok: LocalSucceed) {
        return ok(undefined);
      }
    `;

    expect(runRule('effect-prefer-effect-void', source)).toHaveLength(0);
  });
});
