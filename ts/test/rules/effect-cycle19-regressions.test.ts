import { describe, expect, it } from 'vitest';
import { runRule } from './effect-rule-test-utils';

describe('Effect cycle 19 regression coverage', () => {
  it('does not let unrelated later Schema text satisfy boundary validation rules', () => {
    const unsafeResponse = `
      export function handler() {
        return Response.json(user);
      }
      const encoder = Schema.encodeSync(User);
    `;
    const unsafeHttpClient = `
      const program = HttpClient.get(url).pipe(
        Effect.map((response) => response.json()),
      );
      const decode = Schema.decodeUnknown(User);
    `;

    expect(
      runRule('effect-schema-require-validation-at-output-boundaries', unsafeResponse),
    ).toHaveLength(1);
    expect(
      runRule('effect-schema-require-http-client-response-schema', unsafeHttpClient),
    ).toHaveLength(1);
  });

  it('accepts Schema validation when it is part of the returned boundary expression', () => {
    const safeResponse = 'return Response.json(Schema.encodeSync(User)(user));';
    const safeHttpClient = `
      const program = HttpClient.get(url).pipe(
        Effect.flatMap((response) => response.json().pipe(Schema.decodeUnknown(User))),
      );
    `;

    expect(
      runRule('effect-schema-require-validation-at-output-boundaries', safeResponse),
    ).toHaveLength(0);
    expect(
      runRule('effect-schema-require-http-client-response-schema', safeHttpClient),
    ).toHaveLength(0);
  });

  it('does not let unrelated later resource-safety text satisfy local strict rules', () => {
    const unsafeSemaphore = `
      const pool = createPool();
      Effect.forEach(items, work);
      const sem = Semaphore.make(1);
    `;
    const unsafeOnExit = `
      Effect.ensuring(program, cleanup);
      const observed = Effect.onExit(program, cleanup);
    `;
    const unsafeStreamTermination = `
      const stream = Stream.repeat(effect);
      const stopped = Stream.takeUntil(signal);
    `;
    const unsafeAsyncPush = `
      const stream = Stream.asyncPush(register);
      const queue = Queue.bounded(16);
    `;
    const unsafeResolver = `
      const resolver = RequestResolver.make(resolve);
      const batched = RequestResolver.makeBatched(resolve);
    `;
    const unsafeNPlusOne = `
      Effect.forEach(ids, (id) => findById(id));
      const resolver = RequestResolver.makeBatched(resolve);
    `;

    expect(runRule('effect-require-semaphore-for-shared-resources', unsafeSemaphore)).toHaveLength(
      1,
    );
    expect(runRule('effect-require-onExit-for-cleanup', unsafeOnExit)).toHaveLength(1);
    expect(runRule('effect-require-stream-termination', unsafeStreamTermination)).toHaveLength(1);
    expect(runRule('effect-require-explicit-asyncPush-buffer', unsafeAsyncPush)).toHaveLength(1);
    expect(runRule('effect-require-batching-for-resolver', unsafeResolver)).toHaveLength(1);
    expect(runRule('effect-use-batched-resolver-for-n-plus-one', unsafeNPlusOne)).toHaveLength(1);
  });

  it('accepts resource-safety operators when they wrap the local expression', () => {
    const safeSemaphore = `
      const pool = createPool();
      Semaphore.withPermits(sem, 1)(Effect.forEach(items, work));
    `;
    const safeStreamTermination = 'Stream.repeat(effect).pipe(Stream.takeUntil(signal));';
    const safeAsyncPush = 'Stream.asyncPush(register, { buffer: Queue.bounded(16) });';
    const safeResolver = 'RequestResolver.makeBatched(resolve);';
    const safeNPlusOne = `
      Effect.forEach(ids, (id) => RequestResolver.request(UserResolver, id));
    `;

    expect(runRule('effect-require-semaphore-for-shared-resources', safeSemaphore)).toHaveLength(0);
    expect(runRule('effect-require-stream-termination', safeStreamTermination)).toHaveLength(0);
    expect(runRule('effect-require-explicit-asyncPush-buffer', safeAsyncPush)).toHaveLength(0);
    expect(runRule('effect-require-batching-for-resolver', safeResolver)).toHaveLength(0);
    expect(runRule('effect-use-batched-resolver-for-n-plus-one', safeNPlusOne)).toHaveLength(0);
  });
});
