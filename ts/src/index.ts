import { defineConfig } from 'oxlint';

export type TheThracianOxlintOptions = {
  typeAware?: boolean;
};

export default function theThracianOxlint(options: TheThracianOxlintOptions = {}) {
  return defineConfig({
    categories: {
      correctness: 'error',
      suspicious: 'error',
      perf: 'warn',
      style: 'warn',
    },
    plugins: ['typescript', 'oxc', 'import', 'promise', 'unicorn'],
    rules: {
      'no-console': 'warn',
      'no-debugger': 'error',
      eqeqeq: 'error',
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
      'typescript/no-explicit-any': 'warn',
      'typescript/no-floating-promises': options.typeAware ? 'error' : 'off',
    },
  });
}
