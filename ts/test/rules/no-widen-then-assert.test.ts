import { RuleTester } from 'oxlint/plugins-dev';

import { noWidenThenAssertRule } from '../../src/rules/no-widen-then-assert';

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: 'ts' } } });
const error = { messageId: 'widenThenAssert' };

tester.run('thethracian/no-widen-then-assert', noWidenThenAssertRule, {
  valid: [
    "const source = { id: 'first' }; const widened: unknown = source;",
    'declare const input: unknown; const parsed = input as { readonly id: string };',
  ],
  invalid: [
    {
      code: "const source = { id: 'second' }; const widened: unknown = source; const parsed = widened as { readonly id: string };",
      errors: [error],
    },
    {
      code: "type User = { readonly id: string }; const source = { id: 'third' } satisfies User; const widened: unknown = source; const parsed = widened as User;",
      errors: [error],
    },
    {
      code: 'type User = { readonly id: string }; declare function getUser(): User; const source = getUser() satisfies User; const widened: unknown = source; const parsed = widened as User;',
      errors: [error],
    },
  ],
});
