import * as EffectNamespace from 'effect/Effect';
import { Effect, pipe } from 'effect';
import { flatMap, flatMap as chainEffect, succeed, succeed as pureEffect } from 'effect/Effect';
import { Effect as EffectAlias } from 'effect';

declare const program: Effect.Effect<number>;

export const pipeableArrow = program.pipe(Effect.flatMap((value) => Effect.succeed(value + 1)));

export const pipeFunction = pipe(
  program,
  Effect.flatMap((value) => Effect.succeed(value + 1)),
);

export const dataFirst = Effect.flatMap(program, (value) => Effect.succeed(value + 1));

export const dataLast = Effect.flatMap((value: number) => Effect.succeed(value + 1))(program);

export const singleReturnBlock = program.pipe(Effect.flatMap((value) => Effect.succeed(value + 1)));

export const functionExpression = program.pipe(
  Effect.flatMap(function (value) {
    return Effect.succeed(value + 1);
  }),
);

export const rootAlias = program.pipe(
  EffectAlias.flatMap((value) => EffectAlias.succeed(value + 1)),
);

export const namespaceImport = program.pipe(
  EffectNamespace.flatMap((value) => EffectNamespace.succeed(value + 1)),
);

export const namedFunctions = program.pipe(flatMap((value) => succeed(value + 1)));

export const aliasedFunctions = program.pipe(chainEffect((value) => pureEffect(value + 1)));
