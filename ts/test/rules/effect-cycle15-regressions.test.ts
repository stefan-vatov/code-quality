import { describe, expect, it } from 'vitest';
import { runRule } from './effect-rule-test-utils';

describe('Effect cycle 15 regression coverage', () => {
  it('ignores Effect imports that appear only in comments when detecting Effect modules', () => {
    const source = `
      // import { Effect } from "effect";
      console.log("debug");
      promise.then((value) => value);
    `;

    expect(runRule('effect-no-console-log-in-effect-code', source)).toHaveLength(0);
    expect(runRule('effect-no-promise-then-in-effect', source)).toHaveLength(0);
  });

  it('reports voided Effect values as floating effects', () => {
    expect(runRule('effect-no-floating-effect', 'void Effect.succeed(1);')).toHaveLength(1);
  });

  it('requires each input boundary value to be decoded independently', () => {
    const source = `
      const inputs = [
        request.body,
        request.params.pipe(Schema.decodeUnknown(Params)),
      ];
    `;

    expect(runRule('effect-schema-require-validation-at-input-boundaries', source)).toHaveLength(1);
  });

  it('does not let nested unrelated timeout or retry satisfy an external call', () => {
    const timeout = `
      HttpClient.get(a).pipe(
        Effect.tap(() => other.pipe(Effect.timeout("1 second"))),
      );
    `;
    const retry = `
      HttpClient.get(a).pipe(
        Effect.tap(() => other.pipe(Effect.retry(policy))),
      );
    `;

    expect(runRule('effect-require-timeout-on-external-effects', timeout)).toHaveLength(1);
    expect(
      runRule('effect-require-retry-policy-for-idempotent-external-effects', retry),
    ).toHaveLength(1);
  });

  it('does not count unexecuted runFork joins as observation', () => {
    const source = `
      function main() {
        const fiber = Effect.runFork(program);
        Fiber.join(fiber);
      }
    `;

    expect(runRule('effect-no-runfork-without-observer', source)).toHaveLength(1);
  });

  it('ignores string-error patterns that appear only inside comments or strings', () => {
    const source = `
      const docs = "Effect.fail('bad')";
      // Effect.fail("bad")
    `;

    expect(runRule('effect-no-string-errors', source)).toHaveLength(0);
  });
});
