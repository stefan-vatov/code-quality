/* -------------------------------------------------------------------------- */
/*   Public Oxlint config factory for The Thracian TypeScript lint package.   */
/* -------------------------------------------------------------------------- */
import { dirname, join } from 'node:path';
import { effectSafetyRuleNames, effectStrictRuleNames } from './rules/effect-rule-names';
import type { EffectStrictRuleName } from './rules/effect-rule-names';
import { defineConfig } from 'oxlint';
import { fileURLToPath } from 'node:url';
import { strictPathOptionKeys } from './rules/effect-path-options';
import type { StrictPathOptionKey, StrictPathOptions } from './rules/effect-path-options';

export type { EffectStrictRuleName } from './rules/effect-rule-names';

/**
 * Options for composing The Thracian Oxlint config.
 *
 * @public
 */
export interface TheThracianOxlintOptions {
  typeAware?: boolean;
  effect?: boolean | TheThracianEffectOptions;
}

/**
 * Options for enabling and configuring Effect-specific lint rules.
 *
 * @public
 */
export interface TheThracianEffectOptions {
  enabled?: boolean;
  strict?: false | TheThracianEffectStrictOptions;
}

/**
 * Opt-in strict Effect path groups used by project-aware rules.
 *
 * @public
 */
export interface TheThracianEffectStrictOptions {
  adapterLayers?: readonly string[];
  compositionRoots?: readonly string[];
  configLayers?: readonly string[];
  domain?: readonly string[];
  enabled?: boolean;
  entrypoints?: readonly string[];
  integrationTests?: readonly string[];
  rules: readonly EffectStrictRuleName[];
  unitTests?: readonly string[];
}

type OxlintRuleSetting = 'error' | ['error', StrictPathOptions];
type ToggleRuleSetting = 'error';
type DefineConfigInput = Parameters<typeof defineConfig>[0];
type RuleMap = NonNullable<DefineConfigInput['rules']>;

/**
 * Oxlint enables a built-in correctness set as warnings when no category is
 * configured. Reset that implicit set so the explicit native allowlist below
 * is the only source of native rules. This is a category reset, not a rule
 * level disable; all rules emitted by this package are errors.
 */
const categories = {
  correctness: 'allow',
} as const;

const plugins = ['typescript', 'oxc', 'import', 'promise', 'unicorn'] as const;

/**
 * Native rules are listed explicitly instead of inherited from Oxlint
 * categories. Category membership is tool-version state, so an Oxlint update
 * cannot silently add a blocking rule to this package. Keep this list limited
 * to reviewed correctness/suspicious rules; each active rule is an error.
 */
const nativeRuleAllowlist = [
  'block-scoped-var',
  'complexity',
  'constructor-super',
  'eqeqeq',
  'for-direction',
  'getter-return',
  'import/default',
  'import/namespace',
  'import/no-absolute-path',
  'import/no-empty-named-blocks',
  'import/no-named-as-default',
  'import/no-named-as-default-member',
  'import/no-duplicates',
  'import/no-self-import',
  'max-depth',
  'max-lines-per-function',
  'max-nested-callbacks',
  'max-params',
  'no-async-promise-executor',
  'no-caller',
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
  'no-useless-backreference',
  'no-useless-catch',
  'no-useless-concat',
  'no-useless-constructor',
  'no-useless-escape',
  'no-useless-rename',
  'no-with',
  'oxc/approx-constant',
  'oxc/bad-array-method-on-arguments',
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
  'oxc/number-arg-out-of-range',
  'oxc/only-used-in-recursion',
  'oxc/uninvoked-array-callback',
  'prefer-const',
  'preserve-caught-error',
  'promise/no-multiple-resolved',
  'promise/no-new-statics',
  'promise/valid-params',
  'require-yield',
  'typescript/await-thenable',
  'typescript/consistent-return',
  'typescript/no-array-delete',
  'typescript/no-base-to-string',
  'typescript/no-confusing-non-null-assertion',
  'typescript/no-duplicate-enum-values',
  'typescript/no-duplicate-type-constituents',
  'typescript/no-extra-non-null-assertion',
  'typescript/no-floating-promises',
  'typescript/no-for-in-array',
  'typescript/no-implied-eval',
  'typescript/no-meaningless-void-operator',
  'typescript/no-misused-new',
  'typescript/no-misused-promises',
  'typescript/no-misused-spread',
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
  'typescript/no-unnecessary-type-parameters',
  'typescript/no-unsafe-argument',
  'typescript/no-unsafe-assignment',
  'typescript/no-unsafe-call',
  'typescript/no-unsafe-declaration-merging',
  'typescript/no-unsafe-enum-comparison',
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

/**
 * Semantic rules implemented by Oxlint's tsgolint backend. Keep this list in
 * sync with the supported `oxlint-tsgolint` rule inventory: configuring one of
 * these rules without type-aware execution makes it silently ineffective.
 */
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
  'typescript/no-unnecessary-type-parameters',
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

const isEffectEnabled = (effect: TheThracianOxlintOptions['effect']): boolean => {
  if (effect === true) {
    return true;
  }
  if (effect && typeof effect === 'object') {
    return effect.enabled !== false;
  }
  return false;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isStrictEffectOptions = (value: unknown): value is TheThracianEffectStrictOptions =>
  isRecord(value) && Array.isArray(value.rules);

const getStrictEffectOptions = (
  effect: TheThracianOxlintOptions['effect'],
): TheThracianEffectStrictOptions | undefined => {
  if (!isEffectEnabled(effect) || !effect || typeof effect !== 'object') {
    return undefined;
  }

  const strict: unknown = Reflect.get(effect, 'strict');
  if (strict === undefined || strict === false) {
    return undefined;
  }
  if (strict === true) {
    throw new TypeError(
      'effect.strict: true is no longer supported; select rules and provide their explicit project paths',
    );
  }
  if (!isStrictEffectOptions(strict)) {
    throw new TypeError('effect.strict must be false or an object with a rules array');
  }
  if (strict.enabled === false) {
    return undefined;
  }

  return strict;
};

const strictEffectRuleNameSet = new Set<string>(effectStrictRuleNames);

const strictRulePathRequirements: Partial<
  Record<EffectStrictRuleName, readonly StrictPathOptionKey[]>
> = {
  'effect-no-direct-clock-random-outside-adapters': ['adapterLayers'],
  'effect-no-direct-http-fs-outside-platform-services': ['adapterLayers'],
  'effect-no-direct-process-env-outside-config-layer': ['configLayers'],
  'effect-no-global-fetch': ['adapterLayers'],
  'effect-no-leaked-service-dependencies': ['domain'],
  'effect-no-live-services-in-unit-tests': ['unitTests', 'integrationTests'],
  'effect-no-node-builtins-when-effect-platform-exists': ['adapterLayers'],
  'effect-no-provide-in-domain-modules': ['domain'],
  'effect-no-run-outside-entrypoints': ['entrypoints', 'unitTests', 'integrationTests'],
  'effect-no-service-construction-outside-layer': ['adapterLayers', 'configLayers'],
  'effect-no-test-runtime-leakage': ['unitTests', 'integrationTests'],
  'effect-prefer-in-memory-implementations': ['unitTests', 'integrationTests'],
  'effect-require-centralized-provision': ['compositionRoots'],
  'effect-require-platform-runmain-at-entrypoints': ['entrypoints'],
  'effect-require-provided-services-in-tests': ['unitTests', 'integrationTests'],
  'effect-require-testclock-for-time-code': ['unitTests', 'integrationTests'],
  'effect-schema-require-config-schema': ['configLayers'],
};

const selectedStrictRuleNames = (
  strictOptions: TheThracianEffectStrictOptions,
): readonly EffectStrictRuleName[] => {
  for (const ruleName of strictOptions.rules) {
    if (typeof ruleName !== 'string' || !strictEffectRuleNameSet.has(ruleName)) {
      throw new TypeError(`Unknown strict Effect rule: ${ruleName}`);
    }
  }

  return strictOptions.rules;
};

const validateStrictRulePaths = (
  strictOptions: TheThracianEffectStrictOptions,
  ruleNames: readonly EffectStrictRuleName[],
): void => {
  for (const ruleName of ruleNames) {
    const requiredPathOptions: readonly StrictPathOptionKey[] =
      strictRulePathRequirements[ruleName] ?? [];
    for (const pathOption of requiredPathOptions) {
      if (!Object.hasOwn(strictOptions, pathOption)) {
        throw new TypeError(
          `Strict Effect rule ${ruleName} requires explicit path option: ${pathOption}`,
        );
      }
    }
  }
};

const validateStrictPathOptions = (strictOptions: TheThracianEffectStrictOptions): void => {
  for (const pathOption of strictPathOptionKeys) {
    if (!Object.hasOwn(strictOptions, pathOption)) {
      continue;
    }
    const value: unknown = Reflect.get(strictOptions, pathOption);
    if (!Array.isArray(value) || !value.every((entry): boolean => typeof entry === 'string')) {
      throw new TypeError(`Strict Effect path option ${pathOption} must be an array of strings`);
    }
  }
};

const buildEffectRules = (
  effect: TheThracianOxlintOptions['effect'],
): Record<string, OxlintRuleSetting> => {
  if (!isEffectEnabled(effect)) {
    return {};
  }

  const strictOptions = getStrictEffectOptions(effect);
  if (strictOptions) {
    validateStrictPathOptions(strictOptions);
  }
  const ruleEntries: [string, OxlintRuleSetting][] = effectSafetyRuleNames.map((ruleName) => [
    `thethracian/${ruleName}`,
    'error',
  ]);

  if (strictOptions) {
    const strictRuleNames = selectedStrictRuleNames(strictOptions);
    validateStrictRulePaths(strictOptions, strictRuleNames);
    ruleEntries.push(
      ...strictRuleNames.map((ruleName): [string, OxlintRuleSetting] => [
        `thethracian/${ruleName}`,
        strictEffectRuleSetting(ruleName, strictOptions),
      ]),
    );
  }

  return Object.fromEntries(ruleEntries);
};

const strictEffectRuleSetting = (
  ruleName: EffectStrictRuleName,
  strictOptions: TheThracianEffectStrictOptions,
): OxlintRuleSetting => {
  const requiredPathOptions = strictRulePathRequirements[ruleName];
  if (!requiredPathOptions || requiredPathOptions.length === 0) {
    return 'error';
  }

  const pathOptions = Object.fromEntries(
    requiredPathOptions.map((pathOption) => [pathOption, strictOptions[pathOption]]),
  ) as StrictPathOptions;
  return ['error', pathOptions];
};

const typeAwareRuleSetting = (isTypeAware: boolean | undefined): ToggleRuleSetting | undefined => {
  if (isTypeAware) {
    return 'error';
  }
  return undefined;
};

const typeAwareConfigOptions = (
  isTypeAware: boolean | undefined,
): { typeAware: true; typeCheck: true } | undefined => {
  if (isTypeAware) {
    return {
      typeAware: true,
      typeCheck: true,
    };
  }
  return undefined;
};

const configOptions = (
  typeAwareOptions: { typeAware: true; typeCheck: true } | undefined,
): { options?: { typeAware: true; typeCheck: true } } => {
  if (typeAwareOptions) {
    return { options: typeAwareOptions };
  }
  return {};
};

const configuredNativeRules = {
  complexity: ['error', { max: 20 }],
  eqeqeq: 'error',
  'import/no-duplicates': [
    'error',
    {
      considerQueryString: true,
      preferInline: false,
    },
  ],
  'max-depth': ['error', { max: 5 }],
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
  'prefer-const': ['error', { destructuring: 'any' }],
  'preserve-caught-error': 'error',
} satisfies RuleMap;

const baseRules = (typeAwareRule: ToggleRuleSetting | undefined): RuleMap =>
  Object.fromEntries(
    nativeRuleAllowlist
      .filter(
        (ruleName) =>
          !typeAwareNativeRuleNames.includes(
            ruleName as (typeof typeAwareNativeRuleNames)[number],
          ) || typeAwareRule,
      )
      .map((ruleName) => [ruleName, Reflect.get(configuredNativeRules, ruleName) ?? 'error']),
  ) as RuleMap;

/**
 * Builds The Thracian Oxlint config for TypeScript consumers.
 *
 * @param options - Feature flags for type-aware checks and Effect rule buckets.
 * @returns Oxlint configuration with native rules and package-local custom rules.
 * @public
 */
export default function theThracianOxlint(
  options: TheThracianOxlintOptions = {},
): ReturnType<typeof defineConfig> {
  const pluginPath = join(dirname(fileURLToPath(import.meta.url)), 'rules', 'plugin.js');
  const typeAwareOptions = typeAwareConfigOptions(options.typeAware);
  const typeAwareRule = typeAwareRuleSetting(options.typeAware);

  return defineConfig({
    ...configOptions(typeAwareOptions),
    categories,
    jsPlugins: [pluginPath],
    plugins: [...plugins],
    rules: {
      ...baseRules(typeAwareRule),
      ...buildEffectRules(options.effect),
    },
  });
}
