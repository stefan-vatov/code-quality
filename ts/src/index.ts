import { dirname, join } from 'node:path';
import { Array, Option, Predicate } from 'effect';
import { effectDefaultRuleNames, effectStrictRuleNames } from './internal/effect-rule-names';
import { defineConfig } from 'oxlint';
import { fileURLToPath } from 'node:url';

export interface TheThracianOxlintOptions {
  typeAware?: boolean;
  effect?: boolean;
}

type ToggleRuleSetting = 'error';
type DefineConfigInput = Parameters<typeof defineConfig>[0];
type RuleMap = NonNullable<DefineConfigInput['rules']>;

interface ConfigOptions {
  readonly reportUnusedDisableDirectives: 'error';
  readonly typeAware?: true;
  readonly typeCheck?: true;
}

const categories = {
  correctness: 'allow',
} as const;

const plugins = ['typescript', 'oxc', 'import', 'jest', 'promise', 'unicorn'] as const;

const portedRuleNames = [
  'no-array-filter-map',
  'no-chained-type-assertions',
  'no-conditional-empty-object-spread',
  'no-known-value-widening',
  'no-module-mocking',
  'no-object-parameters',
  'no-reduce-accumulator-copy',
  'no-reflect-apply',
  'no-reflect-get',
  'no-runtime-typeof',
  'no-shape-in-symbol-names',
  'no-unknown-parameters',
  'no-unknown-returns',
  'no-unknown-type-aliases',
  'no-unsafe-dictionary-type',
  'no-widen-then-assert',
] as const;

const portedRules: RuleMap = {
  ...Object.fromEntries(portedRuleNames.map((ruleName) => [`thethracian/${ruleName}`, 'error'])),

  'thethracian/no-runtime-typeof': ['error', { allowInTypeGuards: true }],
};

const nativeRuleAllowlist = [
  'array-callback-return',
  'block-scoped-var',
  'complexity',
  'constructor-super',
  'eqeqeq',
  'for-direction',
  'getter-return',
  'import/default',
  'import/namespace',
  'import/no-absolute-path',
  'import/no-duplicates',
  'import/no-empty-named-blocks',
  'import/no-named-as-default',
  'import/no-named-as-default-member',
  'import/no-self-import',
  'jest/no-disabled-tests',
  'jest/no-focused-tests',
  'max-depth',
  'max-lines',
  'max-lines-per-function',
  'max-nested-callbacks',
  'max-params',
  'no-async-promise-executor',
  'no-caller',
  'no-case-declarations',
  'no-class-assign',
  'no-compare-neg-zero',
  'no-cond-assign',
  'no-const-assign',
  'no-constant-binary-expression',
  'no-constant-condition',
  'no-control-regex',
  'no-debugger',
  'no-delete-var',
  'no-dupe-class-members',
  'no-dupe-else-if',
  'no-dupe-keys',
  'no-duplicate-case',
  'no-empty',
  'no-empty-character-class',
  'no-empty-pattern',
  'no-empty-static-block',
  'no-eval',
  'no-ex-assign',
  'no-extend-native',
  'no-extra-bind',
  'no-extra-boolean-cast',
  'no-fallthrough',
  'no-func-assign',
  'no-global-assign',
  'no-implied-eval',
  'no-import-assign',
  'no-invalid-regexp',
  'no-irregular-whitespace',
  'no-iterator',
  'no-loss-of-precision',
  'no-misleading-character-class',
  'no-new-func',
  'no-new-native-nonconstructor',
  'no-nonoctal-decimal-escape',
  'no-obj-calls',
  'no-param-reassign',
  'no-script-url',
  'no-self-assign',
  'no-self-compare',
  'no-setter-return',
  'no-shadow',
  'no-shadow-restricted-names',
  'no-sparse-arrays',
  'no-this-before-super',
  'no-unassigned-vars',
  'no-unexpected-multiline',
  'no-unmodified-loop-condition',
  'no-unneeded-ternary',
  'no-unreachable',
  'no-unsafe-finally',
  'no-unsafe-negation',
  'no-unsafe-optional-chaining',
  'no-unused-expressions',
  'no-unused-labels',
  'no-unused-private-class-members',
  'no-unused-vars',
  'no-useless-assignment',
  'no-useless-backreference',
  'no-useless-catch',
  'no-useless-concat',
  'no-useless-constructor',
  'no-useless-escape',
  'no-useless-rename',
  'no-var',
  'no-warning-comments',
  'no-with',
  'oxc/approx-constant',
  'oxc/bad-array-method-on-arguments',
  'oxc/bad-bitwise-operator',
  'oxc/bad-char-at-comparison',
  'oxc/bad-comparison-sequence',
  'oxc/bad-min-max-func',
  'oxc/bad-object-literal-comparison',
  'oxc/bad-replace-all-arg',
  'oxc/const-comparisons',
  'oxc/double-comparisons',
  'oxc/erasing-op',
  'oxc/misrefactored-assign-op',
  'oxc/missing-throw',
  'oxc/no-accumulating-spread',
  'oxc/number-arg-out-of-range',
  'oxc/only-used-in-recursion',
  'oxc/uninvoked-array-callback',
  'prefer-const',
  'preserve-caught-error',
  'promise/no-multiple-resolved',
  'promise/no-new-statics',
  'promise/no-return-in-finally',
  'promise/valid-params',
  'require-yield',
  'typescript/await-thenable',
  'typescript/ban-ts-comment',
  'typescript/consistent-return',
  'typescript/no-array-delete',
  'typescript/no-base-to-string',
  'typescript/no-confusing-non-null-assertion',
  'typescript/no-duplicate-enum-values',
  'typescript/no-duplicate-type-constituents',
  'typescript/no-empty-object-type',
  'typescript/no-extra-non-null-assertion',
  'typescript/no-floating-promises',
  'typescript/no-for-in-array',
  'typescript/no-implied-eval',
  'typescript/no-meaningless-void-operator',
  'typescript/no-misused-new',
  'typescript/no-misused-promises',
  'typescript/no-misused-spread',
  'typescript/no-non-null-asserted-nullish-coalescing',
  'typescript/no-non-null-asserted-optional-chain',
  'typescript/no-redundant-type-constituents',
  'typescript/no-this-alias',
  'typescript/no-unnecessary-boolean-literal-compare',
  'typescript/no-unnecessary-parameter-property-assignment',
  'typescript/no-unnecessary-template-expression',
  'typescript/no-unnecessary-type-arguments',
  'typescript/no-unnecessary-type-assertion',
  'typescript/no-unnecessary-type-constraint',
  'typescript/no-unnecessary-type-conversion',
  'typescript/no-unsafe-argument',
  'typescript/no-unsafe-assignment',
  'typescript/no-unsafe-call',
  'typescript/no-unsafe-declaration-merging',
  'typescript/no-unsafe-enum-comparison',
  'typescript/no-unsafe-function-type',
  'typescript/no-unsafe-member-access',
  'typescript/no-unsafe-return',
  'typescript/no-unsafe-unary-minus',
  'typescript/no-useless-default-assignment',
  'typescript/no-useless-empty-export',
  'typescript/no-wrapper-object-types',
  'typescript/only-throw-error',
  'typescript/prefer-as-const',
  'typescript/prefer-promise-reject-errors',
  'typescript/require-array-sort-compare',
  'typescript/restrict-template-expressions',
  'typescript/switch-exhaustiveness-check',
  'typescript/triple-slash-reference',
  'typescript/unbound-method',
  'unicorn/no-abusive-eslint-disable',
  'unicorn/no-accessor-recursion',
  'unicorn/no-empty-file',
  'unicorn/no-instanceof-builtins',
  'unicorn/no-invalid-fetch-options',
  'unicorn/no-invalid-remove-event-listener',
  'unicorn/no-thenable',
  'unicorn/no-useless-fallback-in-spread',
  'unicorn/no-useless-length-check',
  'unicorn/no-useless-spread',
  'unicorn/require-post-message-target-origin',
  'use-isnan',
  'valid-typeof',
] as const;

const typeAwareNativeRuleNames = [
  'typescript/await-thenable',
  'typescript/consistent-return',
  'typescript/no-array-delete',
  'typescript/no-base-to-string',
  'typescript/no-duplicate-type-constituents',
  'typescript/no-floating-promises',
  'typescript/no-for-in-array',
  'typescript/no-implied-eval',
  'typescript/no-meaningless-void-operator',
  'typescript/no-misused-promises',
  'typescript/no-misused-spread',
  'typescript/no-redundant-type-constituents',
  'typescript/no-unnecessary-boolean-literal-compare',
  'typescript/no-unnecessary-template-expression',
  'typescript/no-unnecessary-type-arguments',
  'typescript/no-unnecessary-type-assertion',
  'typescript/no-unnecessary-type-conversion',
  'typescript/no-unsafe-argument',
  'typescript/no-unsafe-assignment',
  'typescript/no-unsafe-call',
  'typescript/no-unsafe-enum-comparison',
  'typescript/no-unsafe-member-access',
  'typescript/no-unsafe-return',
  'typescript/no-unsafe-unary-minus',
  'typescript/no-useless-default-assignment',
  'typescript/only-throw-error',
  'typescript/prefer-promise-reject-errors',
  'typescript/require-array-sort-compare',
  'typescript/restrict-template-expressions',
  'typescript/switch-exhaustiveness-check',
  'typescript/unbound-method',
] as const;

const typeAwareNativeRuleNameSet = new Set<string>(typeAwareNativeRuleNames);

const buildEffectRules = (effect: boolean | undefined): RuleMap => {
  if (effect === undefined) return {};
  const enabled = Option.getOrThrowWith(
    Option.liftPredicate(effect, Predicate.isBoolean),
    () => new TypeError('effect must be a boolean'),
  );
  if (!enabled) return {};
  return Object.fromEntries<'error'>([
    ...[...effectDefaultRuleNames, ...effectStrictRuleNames].map((name): [string, 'error'] => [
      `thethracian/${name}`,
      'error',
    ]),
    ['thethracian/no-service-constructor-imports', 'error'],
  ]);
};

const typeAwareRuleSetting = (isTypeAware: boolean | undefined): ToggleRuleSetting | undefined => {
  if (isTypeAware) {
    return 'error';
  }
  return undefined;
};

const configOptions = (isTypeAware: boolean | undefined): ConfigOptions => {
  if (isTypeAware) {
    return { reportUnusedDisableDirectives: 'error', typeAware: true, typeCheck: true };
  }
  return { reportUnusedDisableDirectives: 'error' };
};

const configuredNativeRules: RuleMap = {
  complexity: ['error', { max: 10 }],
  eqeqeq: 'error',
  'import/no-duplicates': [
    'error',
    {
      considerQueryString: true,
      preferInline: false,
    },
  ],
  'max-depth': ['error', { max: 5 }],
  'max-lines': ['error', { max: 5000, skipBlankLines: true, skipComments: true }],
  'max-lines-per-function': [
    'error',
    {
      max: 150,
      skipBlankLines: true,
      skipComments: true,
    },
  ],
  'max-nested-callbacks': ['error', { max: 6 }],
  'max-params': ['error', { max: 7 }],
  'no-debugger': 'error',
  'no-empty': ['error', { allowEmptyCatch: false }],
  'no-eval': 'error',
  'no-new-func': 'error',
  'no-param-reassign': ['error', { props: false }],
  'no-script-url': 'error',
  'no-warning-comments': ['error', { terms: ['@nocommit'] }],
  'prefer-const': ['error', { destructuring: 'any' }],
  'preserve-caught-error': 'error',
};

const baseRules = (typeAwareRule: ToggleRuleSetting | undefined): RuleMap =>
  Object.fromEntries(
    Array.filterMap(nativeRuleAllowlist, (ruleName) =>
      !typeAwareNativeRuleNameSet.has(ruleName) || typeAwareRule
        ? Option.some([ruleName, configuredNativeRules[ruleName] ?? 'error'] as const)
        : Option.none(),
    ),
  );

export default function theThracianOxlint(
  options: TheThracianOxlintOptions = {},
): ReturnType<typeof defineConfig> {
  const pluginPath = join(dirname(fileURLToPath(import.meta.url)), 'rules', 'plugin.js');
  const typeAwareRule = typeAwareRuleSetting(options.typeAware);

  return defineConfig({
    options: configOptions(options.typeAware),
    categories,
    jsPlugins: [pluginPath],
    plugins: [...plugins],
    rules: {
      ...baseRules(typeAwareRule),
      ...portedRules,
      'thethracian/no-tautological-assertions': 'error',
      'thethracian/no-test-environment-branches': 'error',
      'thethracian/no-try-catch-throw': 'error',
      'thethracian/require-disable-justification': 'error',
      ...buildEffectRules(options.effect),
    },
  });
}
