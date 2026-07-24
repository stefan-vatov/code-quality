import { describe, expect, it } from 'vitest';
import { runRule } from './effect-rule-test-utils';

const aliasLocationCases = [
  {
    alias: '$Fx',
    expected: { column: 90, line: 2 },
    statement:
      'const program = $Fx.succeed(0).pipe($Fx.asVoid); const generated = $Fx.gen(function* () { yield $Fx.succeed(1); });',
  },
  {
    alias: 'Fx$',
    expected: { column: 90, line: 2 },
    statement:
      'const program = Fx$.succeed(0).pipe(Fx$.asVoid); const generated = Fx$.gen(function* () { yield Fx$.succeed(1); });',
  },
  {
    alias: '$run',
    expected: { column: 101, line: 2 },
    statement:
      'const first = $run.succeed(0); const second = $run.asVoid; const generated = $run.gen(function* () { yield $run.succeed(1); });',
  },
  {
    alias: 'run$',
    expected: { column: 101, line: 2 },
    statement:
      'const first = run$.succeed(0); const second = run$.asVoid; const generated = run$.gen(function* () { yield run$.succeed(1); });',
  },
] as const;

describe('Effect alias diagnostic locations', (): void => {
  it.each(aliasLocationCases)(
    'reports the original-source location after earlier $alias occurrences',
    ({ alias, expected, statement }): void => {
      const source = [`import { Effect as ${alias} } from "effect";`, statement].join('\n');
      const reports = runRule('effect-require-yield-star', source);

      expect(reports).toHaveLength(1);
      expect(reports[0]?.loc).toStrictEqual(expected);
    },
  );

  it('keeps the canonical Effect diagnostic at its original-source location', (): void => {
    const source = [
      'import { Effect } from "effect";',
      'const program = Effect.succeed(0).pipe(Effect.asVoid); const generated = Effect.gen(function* () { yield Effect.succeed(1); });',
    ].join('\n');

    const reports = runRule('effect-require-yield-star', source);

    expect(reports).toHaveLength(1);
    expect(reports[0]?.loc).toStrictEqual({ column: 99, line: 2 });
  });
});
