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
    jsPlugins: ['oxlint-plugin-complexity'],
    rules: {
      'complexity/complexity': ['error', { cyclomatic: 10 }],
      'no-console': 'error',
      'no-debugger': 'error',
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
      'typescript/no-unsafe-call': 'error',
      'typescript/no-unsafe-member-access': 'error',
      'typescript/no-unsafe-assignment': options.typeAware ? 'error' : 'off',
      'typescript/no-unsafe-return': options.typeAware ? 'error' : 'off',
      'typescript/no-unsafe-argument': options.typeAware ? 'error' : 'off',
      'typescript/no-floating-promises': options.typeAware ? 'error' : 'off',
    },
  });
}
