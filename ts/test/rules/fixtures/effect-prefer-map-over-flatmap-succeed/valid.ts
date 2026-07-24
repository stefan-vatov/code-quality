import { flatMap, succeed } from 'effect/Effect';
import { Effect } from 'effect';

declare const program: Effect.Effect<number>;

export const otherEffectOperation = program.pipe(Effect.flatMap((value) => Effect.log(value)));

export const additionalLogic = program.pipe(
  Effect.flatMap((value) => {
    const incremented = value + 1;
    return Effect.succeed(incremented);
  }),
);

const unrelated = {
  flatMap: <Value, Output>(value: Value, transform: (input: Value) => Output): Output =>
    transform(value),
  succeed: <Value>(value: Value): Value => value,
};

export const unrelatedFunctions = unrelated.flatMap(1, (value) => unrelated.succeed(value + 1));

export const asyncCallback = program.pipe(
  Effect.flatMap(async (value) => Effect.succeed(value + 1)),
);

export const generatorCallback = program.pipe(
  Effect.flatMap(function* (value) {
    return Effect.succeed(value + 1);
  }),
);

export const zeroArguments = program.pipe(Effect.flatMap(() => Effect.succeed()));

export const multipleArguments = program.pipe(
  Effect.flatMap((value) => Effect.succeed(value, value + 1)),
);

const LocalEffect = {
  flatMap: unrelated.flatMap,
  succeed: unrelated.succeed,
};

export const localLookalike = LocalEffect.flatMap(1, (value) => LocalEffect.succeed(value + 1));

export const shadowedEffectNamespace = (Effect: typeof unrelated) =>
  Effect.flatMap(1, (value) => Effect.succeed(value + 1));

export const shadowedNamedFunctions = (
  flatMap: typeof unrelated.flatMap,
  succeed: typeof unrelated.succeed,
) => flatMap(1, (value) => succeed(value + 1));

export const documentation = 'Effect.flatMap((value) => Effect.succeed(value + 1))';
