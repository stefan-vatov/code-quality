import { RuleTester } from 'oxlint/plugins-dev';

import { noArrayFilterMapRule } from '../../src/rules/internal/no-array-filter-map';

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: 'ts' } } });
const error = (first: string, second: string) => ({
  messageId: 'arrayFilterMap',
  data: { first, second },
});

tester.run('thethracian/no-array-filter-map', noArrayFilterMapRule, {
  valid: [
    'const kept = [1, 2].filter((value) => value > 1);',
    'const doubled = [1, 2].map((value) => value * 2);',
    'const lazy = [1, 2].values().filter((value) => value > 1).map(String).toArray();',
    'const unknownReceiver = items.filter(Boolean).map(String);',
    'let values = [1, 2]; values = other; const result = values.filter(Boolean).map(String);',
    'const result = pipe([1, 2], Array.filter((value) => value > 1), Array.map(String));',
    'const flat = [1, 2].flatMap((value) => (value > 1 ? [String(value)] : []));',
    'const chained = [1, 2].filter(Boolean).filter((value) => value > 1);',
  ],
  invalid: [
    {
      name: 'filter then map on an array literal',
      code: 'const result = [1, 2].filter((value) => value > 1).map((value) => value * 2);',
      errors: [error('filter', 'map')],
    },
    {
      name: 'map then filter on a const array',
      code: 'const values = [1, 2]; const result = values.map((value) => value * 2).filter(Boolean);',
      errors: [error('map', 'filter')],
    },
    {
      name: 'annotated array parameter',
      code: 'function names(values: number[]) { return values.filter(Boolean).map(String); }',
      errors: [error('filter', 'map')],
    },
    {
      name: 'readonly array parameter',
      code: 'function names(values: readonly number[]) { return values.filter(Boolean).map(String); }',
      errors: [error('filter', 'map')],
    },
    {
      name: 'ReadonlyArray parameter',
      code: 'function names(values: ReadonlyArray<number>) { return values.map(String).filter(Boolean); }',
      errors: [error('map', 'filter')],
    },
    {
      name: 'computed method names',
      code: "const result = [1, 2]['filter'](Boolean)['map'](String);",
      errors: [error('filter', 'map')],
    },
    {
      name: 'optional chaining',
      code: 'function names(values: number[]) { return values?.filter(Boolean)?.map(String); }',
      errors: [error('filter', 'map')],
    },
  ],
});
