import { describe, expect, it } from 'vitest';
import { runRule } from './effect-rule-test-utils.js';

describe('Effect cycle 5 default regression coverage', () => {
  it('does not treat unrelated JSON.parse and Schema usage as JSON string decoding', () => {
    const unrelated = `
      const payload = JSON.parse(body);
      const decodeUser = Schema.decodeUnknown(User);
    `;
    const invalid = `
      const user = Schema.decodeUnknown(User)(JSON.parse(body));
    `;

    expect(runRule('effect-schema-require-parseJson-for-json-strings', unrelated)).toHaveLength(0);
    expect(runRule('effect-schema-require-parseJson-for-json-strings', invalid)).toHaveLength(1);
  });

  it('does not let one it.effect hide a plain TestClock test without TestContext', () => {
    const source = `
      it.effect("virtual", () =>
        Effect.gen(function* () {
          yield* TestClock.adjust("1 second");
        })
      );

      it("plain", () => {
        TestClock.adjust("1 second");
      });
    `;

    expect(
      runRule('effect-testClock-requires-testContext', source, 'src/user.test.ts'),
    ).toHaveLength(1);
  });

  it('requires yield star for yielded Effect variables inside Effect.gen', () => {
    const invalid = `
      const program = Effect.gen(function* () {
        const user = yield loadUser;
        return user;
      });
    `;

    const valid = `
      const program = Effect.gen(function* () {
        const user = yield* loadUser;
        return user;
      });
    `;

    expect(runRule('effect-require-yield-star', invalid)).toHaveLength(1);
    expect(runRule('effect-require-yield-star', valid)).toHaveLength(0);
  });

  it('requires Schema.parseJson for multiline JSON string decoding', () => {
    const invalid = `
      const user = Schema.decodeUnknown(User)(
        JSON.parse(body)
      );
    `;

    const valid = `
      const user = Schema.decodeUnknown(Schema.parseJson(User))(body);
    `;

    expect(runRule('effect-schema-require-parseJson-for-json-strings', invalid)).toHaveLength(1);
    expect(runRule('effect-schema-require-parseJson-for-json-strings', valid)).toHaveLength(0);
  });
});
