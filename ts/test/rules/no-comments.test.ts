import { RuleTester } from 'oxlint/plugins-dev';
import { noCommentsRule } from '../../src/rules/no-comments';

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: 'tsx' } } });
const error = { messageId: 'comment' };

tester.run('thethracian/no-comments', noCommentsRule, {
  valid: [
    'export const value = 1;',
    'const url = "https://example.com"; const text = "/* not a comment */";',
    'const text = `// template text`; const pattern = /https?:\\/\\//;',
    'const view = <div>/* text */</div>;',
    '#!/usr/bin/env node\nexport const value = 1;',
  ],
  invalid: [
    { code: '// explanation\nexport const value = 1;', errors: [error] },
    { code: 'export const value = 1; // explanation', errors: [error] },
    { code: 'const /* inline */ value = 1;', errors: [error] },
    { code: '/** documentation */\nexport function run() {}', errors: [error] },
    { code: '/* first */\n// second\nconst value = 1;', errors: [error, error] },
    { code: 'const text = `${value /* interpolation */}`;', errors: [error] },
    { code: 'const view = <div>{/* jsx */}</div>;', errors: [error] },
    { code: '// @ts-expect-error legacy escape\nexport const value: string = 1;', errors: [error] },
  ],
});
