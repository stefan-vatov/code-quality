import { RuleTester } from 'oxlint/plugins-dev';

import { noForbiddenTermInSymbolNamesRule } from '../../src/rules/no-shape-in-symbol-names';

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: 'ts' } } });
const error = { messageId: 'forbiddenSymbolName' };

tester.run('thethracian/no-shape-in-symbol-names', noForbiddenTermInSymbolNamesRule, {
  valid: [
    'declare const schema: ExternalSchema; const field = schema.shape.id;',
    'declare const outer: External; const value = outer.inner.shape;',
    "declare const schema: ExternalSchema; schema.shape.id.parse('x');",
    'const owner = { id: 1 }; const value = owner.id;',
    "import type { ZodRawShape as SchemaFields } from 'zod';",
    "import { shape as schema } from './external';",
  ],
  invalid: [
    { code: 'const shape = 1;', errors: [error] },
    { code: 'function shapeOf() {}', errors: [error] },
    { code: 'type PayloadShape = { id: string };', errors: [error] },
    { code: 'type Payload = { shape: string };', errors: [error] },
    { code: "import { schema as localShape } from './external';", errors: [error] },
    {
      code: "declare const owner: External; const shape = 'field'; const value = owner[shape];",
      errors: 2,
    },
  ],
});
