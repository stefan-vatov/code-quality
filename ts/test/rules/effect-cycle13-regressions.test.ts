import { describe, expect, it } from 'vitest';
import { runRule } from './effect-rule-test-utils.js';

describe('Effect cycle 13 regression coverage', () => {
  it('allows composable acquireRelease resources that are scoped at their use site', () => {
    const assignedResource = `
      const resource =
        Effect.acquireRelease(openConnection, closeConnection);

      const Live = Layer.scoped(ConnectionService, resource);
    `;
    const pipedResource = `
      Effect.acquireRelease(openConnection, closeConnection).pipe(
        Effect.tap((connection) => Effect.logInfo(connection.id)),
        Effect.scoped,
      );
    `;
    const invalid = 'Effect.runPromise(Effect.acquireRelease(openConnection, closeConnection));';

    expect(runRule('effect-require-scoped-for-acquireRelease', assignedResource)).toHaveLength(0);
    expect(runRule('effect-require-scoped-for-acquireRelease', pipedResource)).toHaveLength(0);
    expect(runRule('effect-require-scoped-for-acquireRelease', invalid)).toHaveLength(1);
  });

  it('does not flag Schema decode effects that remain in the typed Effect channel', () => {
    const valid = `
      const decoded = Schema.decodeUnknown(User)(payload);
      return yield* decoded;
    `;
    const invalid = 'const decoded = Schema.decodeUnknown(User)(payload);';

    expect(runRule('effect-schema-require-parse-error-handling', valid)).toHaveLength(0);
    expect(runRule('effect-schema-require-parse-error-handling', invalid)).toHaveLength(1);
  });

  it('ignores fake Effect API names that appear only inside strings or comments', () => {
    const validString = 'const message = "Effect.fromPromise(() => fetch())";';
    const validComment = '// Effect.tryCatch(() => value)';
    const invalid = 'const program = Effect.fromPromise(() => fetch("/users"));';

    expect(runRule('effect-no-known-fake-api', validString)).toHaveLength(0);
    expect(runRule('effect-no-known-fake-api', validComment)).toHaveLength(0);
    expect(runRule('effect-no-known-fake-api', invalid)).toHaveLength(1);
  });

  it('requires tryPromise catch handlers to return structured typed errors', () => {
    const globalError = `
      Effect.tryPromise({
        try: () => fetch(url),
        catch: (cause) => new Error(String(cause)),
      });
    `;
    const stringError = `
      Effect.tryPromise({
        try: () => fetch(url),
        catch: () => "network failed",
      });
    `;
    const taggedError = `
      Effect.tryPromise({
        try: () => fetch(url),
        catch: (cause) => new FetchError({ cause }),
      });
    `;

    expect(runRule('effect-require-typed-error-in-trypromise', globalError)).toHaveLength(1);
    expect(runRule('effect-require-typed-error-in-trypromise', stringError)).toHaveLength(1);
    expect(runRule('effect-require-typed-error-in-trypromise', taggedError)).toHaveLength(0);
  });

  it('requires wrapped errors to actually preserve the original cause value', () => {
    const invalid = 'program.pipe(Effect.mapError((cause) => new DomainError("failed")));';
    const valid = 'program.pipe(Effect.mapError((cause) => new DomainError({ cause })));';

    expect(runRule('effect-require-error-cause-preserved', invalid)).toHaveLength(1);
    expect(runRule('effect-require-error-cause-preserved', valid)).toHaveLength(0);
  });

  it('keeps retry jitter checks local to the retry schedule', () => {
    const invalid = `
      Effect.retry(program, Schedule.exponential("1 second"));
      const other = Schedule.jittered(policy);
    `;
    const valid = `
      Effect.retry(program, Schedule.exponential("1 second").pipe(Schedule.jittered));
    `;

    expect(runRule('effect-require-schedule-jitter-for-retries', invalid)).toHaveLength(1);
    expect(runRule('effect-require-schedule-jitter-for-retries', valid)).toHaveLength(0);
  });
});
