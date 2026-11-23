import { RuleTester } from 'oxlint/plugins-dev';

import { noReduceAccumulatorCopyRule } from '../../src/rules/internal/no-reduce-accumulator-copy';

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: 'ts' } } });
const error = { messageId: 'accumulatorCopy' };

tester.run('thethracian/no-reduce-accumulator-copy', noReduceAccumulatorCopyRule, {
  valid: [
    'const total = [1, 2].reduce((sum, value) => sum + value, 0);',
    'const all = [1, 2].reduce((list, value) => { list.push(value); return list; }, [] as number[]);',
    'const merged = Object.assign({}, defaults, overrides);',
    'const copied = [1, 2].reduce((list, value) => other.concat(value), [] as number[]);',
    'const noSeed = [[1], [2]].reduce((list, value) => list.concat(value));',
    'const unknownSeed = items.reduce((list, value) => list.concat(value), seed);',
    'const Object = { assign: (target, source) => source }; const result = items.reduce((acc, item) => Object.assign({}, acc), {});',
    'const nested = items.reduce((acc, item) => { function copy() { return Object.assign({}, acc); } return acc; }, {});',
    'const mapped = [1, 2].map((value) => [value].concat(value));',
    'const assigned = items.reduce((acc, item) => Object.assign(acc, item), {});',
  ],
  invalid: [
    {
      name: 'concat on an array accumulator',
      code: 'const all = [1, 2].reduce((list, value) => list.concat(value), [] as number[]);',
      errors: [error],
    },
    {
      name: 'Object.assign into a fresh object',
      code: 'const byId = items.reduce((acc, item) => Object.assign({}, acc, { [item.id]: item }), {});',
      errors: [error],
    },
    {
      name: 'Array.from copy',
      code: 'const all = items.reduce((list, item) => Array.from(list), []);',
      errors: [error],
    },
    {
      name: 'reduceRight with toSorted',
      code: 'const all = [3, 1].reduceRight((list, value) => list.toSorted(), [] as number[]);',
      errors: [error],
    },
    {
      name: 'const alias of the accumulator',
      code: 'const all = [1, 2].reduce((list, value) => { const current = list; return current.concat(value); }, [] as number[]);',
      errors: [error],
    },
    {
      name: 'defaulted accumulator parameter',
      code: 'const all = [1, 2].reduce((list = [], value) => list.slice(), [] as number[]);',
      errors: [error],
    },
  ],
});
