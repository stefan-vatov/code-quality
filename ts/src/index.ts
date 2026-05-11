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
      'typescript/no-explicit-any': 'warn',
      'typescript/no-floating-promises': options.typeAware ? 'error' : 'off',
    },
  });
}
