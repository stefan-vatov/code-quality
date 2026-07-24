import { Effect } from 'effect';

// const discarded = Effect.succeed(0);
const promised = Effect.sync(() => Promise.resolve(1));
export const requested = Effect.tryPromise({
  catch: (error) => error,
  try: () => fetch('/users'),
});
export const mapped = Effect.flatMap(promised, (value) => Effect.succeed(value + 1));
