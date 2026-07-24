import { Effect } from 'effect';

// Native comment API compatibility prose.
const Promise = {
  resolve: <Value>(value: Value): globalThis.Promise<Value> => globalThis.Promise.resolve(value),
};
const fetch = (path: string): globalThis.Promise<string> => globalThis.Promise.resolve(path);

const localPromise = Effect.sync(() => (() => Promise.resolve(1))());
export const localRequest = Effect.tryPromise({
  catch: (error) => error,
  try: () => fetch('/users'),
});
export const mapped = localPromise.pipe(Effect.map((value) => value + 1));
