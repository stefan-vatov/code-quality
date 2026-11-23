import { RuleTester } from 'oxlint/plugins-dev';

import { noTautologicalAssertionsRule } from '../../src/rules/internal/no-tautological-assertions';

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: 'ts' } } });
const error = { messageId: 'tautologicalAssertion' };

tester.run('thethracian/no-tautological-assertions', noTautologicalAssertionsRule, {
  valid: [
    'expect(compute(2)).toBe(4);',
    'expect(result).toEqual({ ok: true });',
    'expect(1).toBe(result);',
    'expect(count(1)).toBe(count(1));',
    'expect(service.read()).toStrictEqual(service.read());',
    'expect(first).toBe(second);',
    'expect(user.name).toBe(user.alias);',
    'expect(value).toBeTruthy();',
    'assert.strictEqual(compute(2), 4);',
    'assert.deepStrictEqual(Effect.succeed(0), Effect.succeed(0));',
    'assert.ok(isReady);',
    'expect(`${name}!`).toBe("Ada!");',
    'const expectTrue = (value: boolean) => value; expectTrue(true);',
  ],
  invalid: [
    { name: 'boolean placeholder', code: 'expect(true).toBe(true);', errors: [error] },
    { name: 'number literals', code: 'expect(1).toEqual(1);', errors: [error] },
    { name: 'negated constants', code: 'expect(1).not.toBe(2);', errors: [error] },
    { name: 'constant folding', code: 'expect(1 + 0).toBe(1);', errors: [error] },
    {
      name: 'literal containers',
      code: 'expect([1, { a: "b" }]).toStrictEqual([1, { a: "b" }]);',
      errors: [error],
    },
    { name: 'constant with a unary matcher', code: 'expect(true).toBeTruthy();', errors: [error] },
    { name: 'undefined constant', code: 'expect(undefined).toBeUndefined();', errors: [error] },
    { name: 'soft expect', code: 'expect.soft("ok").toBe("ok");', errors: [error] },
    { name: 'self comparison of an identifier', code: 'expect(user).toBe(user);', errors: [error] },
    {
      name: 'self comparison of a member chain',
      code: 'expect(user.profile.name).toEqual(user.profile.name);',
      errors: [error],
    },
    { name: 'assert with a constant', code: 'assert(true);', errors: [error] },
    { name: 'assert.ok with a constant', code: 'assert.ok(1);', errors: [error] },
    { name: 'assert.isTrue with true', code: 'assert.isTrue(true);', errors: [error] },
    {
      name: 'assert.strictEqual of constants',
      code: 'assert.strictEqual("a", "a");',
      errors: [error],
    },
    {
      name: 'assert.deepStrictEqual self comparison',
      code: 'assert.deepStrictEqual(state, state);',
      errors: [error],
    },
  ],
});
