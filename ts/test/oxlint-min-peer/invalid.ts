import { Effect } from 'effect';

void Effect.succeed(0);
const program = Effect.gen(function* () {
  yield Effect.succeed(1);
  return 1;
});
export const requested = Effect.tryPromise({
  catch: (error) => error,
  try: () => fetch('/users'),
});
export { program };
