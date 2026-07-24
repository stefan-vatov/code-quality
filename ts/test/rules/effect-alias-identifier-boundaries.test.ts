import {
  canonicalizeEffectAPIAliases,
  effectAPIAliases,
  effectFunctionAliases,
  effectImportAliases,
  hasEffectSignal,
  hasRuntimeCall,
} from '../../src/rules/effect-rule-aliases';
import { describe, expect, it } from 'vitest';
import { hasRuntimeInEffect } from '../../src/rules/effect-default-workflow-helpers';

const sorted = (values: readonly string[]): string[] => [...values].sort();

const effectAliasCases = [
  [
    'root named prefix-dollar alias',
    'import { Effect as $Fx } from "effect";',
    '$Fx',
    ['$Fx', 'Effect'],
  ],
  [
    'root named suffix-dollar alias',
    'import { Effect as Fx$ } from "effect";',
    'Fx$',
    ['Effect', 'Fx$'],
  ],
  [
    'root namespace prefix-dollar alias',
    'import * as $Fx from "effect";',
    undefined,
    ['$Fx', 'Effect'],
  ],
  [
    'Effect namespace suffix-dollar alias',
    'import * as Fx$ from "effect/Effect";',
    'Fx$',
    ['Effect', 'Fx$'],
  ],
] as const;

describe('Effect alias identifiers', (): void => {
  it.each(effectAliasCases)(
    'extracts a %s',
    (_caseName, source, expectedAPIAlias, expectedImportAliases): void => {
      expect(sorted(effectImportAliases(source))).toStrictEqual(sorted(expectedImportAliases));
      if (expectedAPIAlias) {
        expect(effectAPIAliases(source, 'Effect')).toContain(expectedAPIAlias);
      } else {
        expect(effectAPIAliases(source, 'Effect')).toStrictEqual([]);
      }
      const effectReference = expectedAPIAlias ?? '$Fx';
      expect(hasEffectSignal(`${source}\n${effectReference}.succeed(1);`)).toBe(true);
    },
  );

  it.each([
    [
      'prefix-dollar runtime function',
      'import { runPromise as $run } from "effect/Effect";',
      '$run',
    ],
    [
      'suffix-dollar runtime function',
      'import { runPromise as run$ } from "effect/Effect";',
      'run$',
    ],
  ] as const)('extracts a %s', (_caseName, source, expectedAlias): void => {
    expect(effectFunctionAliases(source, 'Effect', 'runPromise')).toStrictEqual([expectedAlias]);
  });

  it('does not infer the canonical Effect alias through local shadowing or near-match imports', (): void => {
    expect(effectImportAliases('const Effect = LocalEffect; Effect.succeed(1);')).toStrictEqual([]);
    expect(effectImportAliases('import { Effect as Fx } from "effectful";')).toStrictEqual([
      'Effect',
    ]);
    expect(effectAPIAliases('import { Effectful as $Fx } from "effect";', 'Effect')).toStrictEqual(
      [],
    );
  });
});

describe('Effect alias canonicalization', (): void => {
  it.each([
    [
      'prefix-dollar root alias',
      'import { Effect as $Fx } from "effect";\nconst task = $Fx.succeed(1);',
      'import { Effect as $Fx } from "effect";\nconst task = Effect.succeed(1);',
    ],
    [
      'suffix-dollar root alias',
      'import { Effect as Fx$ } from "effect";\nconst task = Fx$.succeed(1);',
      'import { Effect as Fx$ } from "effect";\nconst task = Effect.succeed(1);',
    ],
    [
      'prefix-dollar namespace alias',
      'import * as $Fx from "effect/Effect";\nconst task = $Fx.succeed(1);',
      'import * as $Fx from "effect/Effect";\nconst task = Effect.succeed(1);',
    ],
    [
      'suffix-dollar namespace alias',
      'import * as Fx$ from "effect/Effect";\nconst task = Fx$.succeed(1);',
      'import * as Fx$ from "effect/Effect";\nconst task = Effect.succeed(1);',
    ],
  ] as const)('canonicalizes a %s', (_caseName, source, expected): void => {
    expect(canonicalizeEffectAPIAliases(source)).toBe(expected);
    expect(canonicalizeEffectAPIAliases(source)).toBe(expected);
  });

  it.each([
    [
      'prefix-dollar alias',
      'import { Effect as $Fx } from "effect";\n$Fx.succeed(1); prefix$Fx.succeed(2);',
      'import { Effect as $Fx } from "effect";\nEffect.succeed(1); prefix$Fx.succeed(2);',
    ],
    [
      'suffix-dollar alias',
      'import { Effect as Fx$ } from "effect";\nFx$.succeed(1); prefixFx$.succeed(2);',
      'import { Effect as Fx$ } from "effect";\nEffect.succeed(1); prefixFx$.succeed(2);',
    ],
  ] as const)('canonicalizes only the exact %s identifier', (_caseName, source, expected): void => {
    expect(canonicalizeEffectAPIAliases(source)).toBe(expected);
  });
});

describe('Effect runtime aliases', (): void => {
  it.each([
    [
      'prefix-dollar root named alias',
      'import { Effect as $Fx } from "effect";\n$Fx.runPromise(task);',
    ],
    [
      'suffix-dollar root named alias',
      'import { Effect as Fx$ } from "effect";\nFx$.runPromise(task);',
    ],
    ['prefix-dollar root namespace alias', 'import * as $Fx from "effect";\n$Fx.runSync(task);'],
    [
      'suffix-dollar Effect namespace alias',
      'import * as Fx$ from "effect/Effect";\nFx$.runFork(task);',
    ],
    [
      'prefix-dollar named runtime alias',
      'import { runPromise as $run } from "effect/Effect";\n$run(task);',
    ],
    [
      'suffix-dollar named runtime alias',
      'import { runSync as run$ } from "effect/Effect";\nrun$(task);',
    ],
  ] as const)('detects a %s', (_caseName, source): void => {
    expect(hasRuntimeCall(source)).toBe(true);
  });

  it('does not leak a cached result between matching and nonmatching alias sources', (): void => {
    const body = '$Fx.runPromise(task);';
    const matchingAliasSource = 'import { Effect as $Fx } from "effect";';
    const nonmatchingAliasSource = 'import { Effect as OtherFx } from "effect";';

    expect(hasRuntimeCall(body, matchingAliasSource)).toBe(true);
    expect(hasRuntimeCall(body, nonmatchingAliasSource)).toBe(false);
    expect(hasRuntimeCall(body, matchingAliasSource)).toBe(true);
  });

  it.each([
    [
      'prefix-dollar object alias prefix',
      'prefix$Fx.runPromise(task);',
      'import { Effect as $Fx } from "effect";',
    ],
    [
      'suffix-dollar object alias prefix',
      'prefixFx$.runPromise(task);',
      'import { Effect as Fx$ } from "effect";',
    ],
    [
      'prefix-dollar function alias prefix',
      'prefix$run(task);',
      'import { runPromise as $run } from "effect/Effect";',
    ],
    [
      'suffix-dollar function alias prefix',
      'prefixRun$(task);',
      'import { runPromise as Run$ } from "effect/Effect";',
    ],
  ] as const)('rejects a near-match %s', (_caseName, body, aliasSource): void => {
    expect(hasRuntimeCall(body, aliasSource)).toBe(false);
  });

  it('rejects locally shadowed runtime lookalikes', (): void => {
    expect(hasRuntimeCall('const Effect = LocalEffect; Effect.runPromise(task);')).toBe(false);
    expect(hasRuntimeCall('const $Fx = LocalEffect; $Fx.runPromise(task);')).toBe(false);
    expect(hasRuntimeCall('const $run = localRun; $run(task);')).toBe(false);
  });
});

describe('runtime aliases inside Effect workflows', (): void => {
  it.each([
    [
      'prefix-dollar root alias',
      'import { Effect as $Fx } from "effect";\n$Fx.gen(function* () { return yield* $Fx.runPromise(task); });',
    ],
    [
      'suffix-dollar root alias',
      'import { Effect as Fx$ } from "effect";\nFx$.gen(function* () { return yield* Fx$.runSync(task); });',
    ],
    [
      'prefix-dollar namespace alias',
      'import * as $Fx from "effect/Effect";\n$Fx.gen(function* () { return yield* $Fx.runFork(task); });',
    ],
    [
      'prefix-dollar named runtime alias',
      'import { Effect } from "effect";\nimport { runPromise as $run } from "effect/Effect";\nEffect.gen(function* () { return yield* $run(task); });',
    ],
    [
      'suffix-dollar named runtime alias',
      'import { Effect } from "effect";\nimport { runSync as run$ } from "effect/Effect";\nEffect.gen(function* () { return yield* run$(task); });',
    ],
  ] as const)('detects a %s', (_caseName, source): void => {
    expect(hasRuntimeInEffect(source)).toBe(true);
  });

  it('rejects shadowed and near-match workflows', (): void => {
    expect(
      hasRuntimeInEffect(
        'const Effect = LocalEffect; Effect.gen(function* () { return yield* Effect.runPromise(task); });',
      ),
    ).toBe(false);
    expect(
      hasRuntimeInEffect(
        'import { Effect as $Fx } from "effect";\n$Fx.gen(function* () { return yield* prefix$Fx.runPromise(task); });',
      ),
    ).toBe(false);
    expect(
      hasRuntimeInEffect(
        'import { Effect as Fx$ } from "effect";\nFx$.gen(function* () { return yield* prefixFx$.runPromise(task); });',
      ),
    ).toBe(false);
  });
});
