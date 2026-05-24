import { describe, expect, it } from 'vitest';
import { runRule } from './effect-rule-test-utils.js';

describe('Effect cycle 11 regression coverage', () => {
  it('keeps exported API rules bound to the exported declaration body', () => {
    const nestedBlockReturn = `
      export function load(flag: boolean) {
        if (flag) {
          void flag;
        }
        return Effect.gen(function* () {
          return 1;
        });
      }
    `;
    const localRunPromise = `
      export const healthCheck = () => "ok";
      const runLocal = () => Effect.runPromise(program);
    `;

    expect(runRule('effect-no-function-returning-gen', nestedBlockReturn)).toHaveLength(1);
    expect(runRule('effect-no-runpromise-in-exported-api', localRunPromise)).toHaveLength(0);
  });

  it('balances Effect call bodies across parentheses inside strings', () => {
    const source = `
      const program = Effect.gen(function* () {
        const marker = ")";
        yield Effect.succeed(1);
      });
    `;

    expect(runRule('effect-require-yield-star', source)).toHaveLength(1);
  });

  it('does not cut fiber observation off at nested helpers inside the same body', () => {
    const source = `
      const program = Effect.gen(function* () {
        const fiber = yield* Effect.fork(worker);
        const helper = () => 1;
        return yield* Fiber.join(fiber);
      });
    `;

    expect(runRule('effect-no-floating-fiber', source)).toHaveLength(0);
  });

  it('keeps strict public API checks bound to exported declarations', () => {
    const laterPromise = `
      export function load(): Effect.Effect<User> {
        return program;
      }

      type Later = Promise<User>;
    `;
    const laterUnknown = `
      export function load(): Effect.Effect<User> {
        return program;
      }

      const payload: unknown = value;
    `;

    expect(runRule('effect-no-promise-returning-public-api', laterPromise)).toHaveLength(0);
    expect(runRule('effect-schema-no-unknown-crossing-boundary', laterUnknown)).toHaveLength(0);
  });

  it('requires timeout and retry on each matching external call', () => {
    const missingTimeout = `
      const both = Effect.all([
        HttpClient.get(a),
        HttpClient.get(b).pipe(Effect.timeout("1 second")),
      ]);
    `;
    const missingRetry = `
      const both = Effect.all([
        HttpClient.get(a),
        HttpClient.get(b).pipe(Effect.retry(policy)),
      ]);
    `;

    expect(runRule('effect-require-timeout-on-external-effects', missingTimeout)).toHaveLength(1);
    expect(
      runRule('effect-require-retry-policy-for-idempotent-external-effects', missingRetry),
    ).toHaveLength(1);
  });

  it('accepts multiline Schema decoding at input boundaries', () => {
    const source = `
      const body = request.body.pipe(
        Schema.decodeUnknown(Input)
      );
    `;

    expect(runRule('effect-schema-require-validation-at-input-boundaries', source)).toHaveLength(0);
  });
});
