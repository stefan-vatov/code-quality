import { defineConfig } from 'oxlint';

export type TheThracianOxlintOptions = {
  typeAware?: boolean;
};

export default function theThracianOxlint(options: TheThracianOxlintOptions = {}) {
  return defineConfig({
    categories: {
      correctness: 'error',
      suspicious: 'error',
      perf: 'error',
      style: 'error',
    },
    plugins: ['typescript', 'oxc', 'import', 'promise', 'unicorn'],
    jsPlugins: ['oxlint-plugin-complexity', './rules/plugin.js'],
    rules: {
      'complexity/complexity': ['error', { cyclomatic: 10 }],
      'thethracian/no-commented-out-code': 'error',
      'thethracian/pascal-case-types': 'error',
      'thethracian/camel-case-identifiers': 'error',
      'thethracian/boolean-prefix': 'error',
      'thethracian/private-underscore': 'error',
      'thethracian/acronym-case': 'error',
      'thethracian/max-import-depth': 'error',
      'thethracian/require-file-doc': 'error',
      'thethracian/require-function-doc': 'error',
      'sort-imports': [
        'error',
        {
          allowSeparatedGroups: true,
          ignoreDeclarationSort: false,
          ignoreMemberSort: false,
          memberSyntaxSortOrder: ['none', 'all', 'multiple', 'single'],
        },
      ],
      'import/max-dependencies': ['error', { max: 20 }],
      'no-console': 'error',
      'no-debugger': 'error',
      'no-eval': 'error',
      'no-new-func': 'error',
      'no-script-url': 'error',
      'preserve-caught-error': 'error',
      'typescript/only-throw-error': 'error',
      'typescript/no-non-null-assertion': 'error',
      'no-inline-comments': 'error',
      'no-param-reassign': ['error', { props: true }],
      'no-warning-comments': 'error',
      'prefer-const': ['error', { destructuring: 'any' }],
      eqeqeq: 'error',
      'max-depth': ['error', { max: 3 }],
      'max-len': [
        'error',
        {
          code: 150,
          ignoreUrls: true,
          ignoreStrings: true,
          ignoreTemplateLiterals: true,
          ignoreRegExpLiterals: true,
        },
      ],
      'max-nested-callbacks': ['error', { max: 4 }],
      'max-params': ['error', { max: 5 }],
      'max-lines': [
        'error',
        {
          max: 500,
          skipBlankLines: true,
          skipComments: true,
        },
      ],
      'max-lines-per-function': [
        'error',
        {
          max: 75,
          skipBlankLines: true,
          skipComments: true,
        },
      ],
      'typescript/no-explicit-any': 'error',
      'typescript/explicit-function-return-type': 'error',
      'typescript/no-unsafe-call': 'error',
      'typescript/no-unsafe-member-access': 'error',
      'typescript/no-unsafe-assignment': options.typeAware ? 'error' : 'off',
      'typescript/no-unsafe-return': options.typeAware ? 'error' : 'off',
      'typescript/no-unsafe-argument': options.typeAware ? 'error' : 'off',
      'typescript/no-floating-promises': options.typeAware ? 'error' : 'off',
      'typescript/no-implied-eval': options.typeAware ? 'error' : 'off',
      'typescript/no-misused-promises': options.typeAware ? 'error' : 'off',
      'typescript/prefer-promise-reject-errors': options.typeAware ? 'error' : 'off',
      'typescript/switch-exhaustiveness-check': options.typeAware ? 'error' : 'off',
    },
  });
}
