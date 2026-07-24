import { Effect } from 'effect';

export const stableValue = Effect.succeed(1).pipe(Effect.map((value) => value + 1));
