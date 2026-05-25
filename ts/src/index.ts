/* -------------------------------------------------------------------------- */
/*   Public Oxlint config factory for The Thracian TypeScript lint package.   */
/* -------------------------------------------------------------------------- */
import { dirname, join } from 'node:path';
import { effectDefaultRuleNames, effectStrictRuleNames } from './rules/effect-rule-names';
import { defineConfig } from 'oxlint';
import { fileURLToPath } from 'node:url';
import { sanitizeStrictPathOptions } from './rules/effect-path-options';

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
  strict?: boolean | TheThracianEffectStrictOptions;
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
  unitTests?: readonly string[];
}

type OxlintRuleSetting = 'error' | ['error', TheThracianEffectStrictOptions];
type ToggleRuleSetting = 'error' | 'off';
type DefineConfigInput = Parameters<typeof defineConfig>[0];
type RuleMap = NonNullable<DefineConfigInput['rules']>;

const categories = {
  correctness: 'error',
  perf: 'error',
  style: 'error',
  suspicious: 'error',
} as const;

const plugins = ['typescript', 'oxc', 'import', 'promise', 'unicorn'] as const;

const isEffectEnabled = (effect: TheThracianOxlintOptions['effect']): boolean => {
  if (effect === false) {
    return false;
  }
  if (effect && typeof effect === 'object' && effect.enabled === false) {
    return false;
  }
  return true;
};

const isStrictEffectEnabled = (effect: TheThracianOxlintOptions['effect']): boolean => {
  if (!isEffectEnabled(effect) || !effect || typeof effect !== 'object') {
    return false;
  }
  if (effect.strict === true) {
    return true;
  }
  if (effect.strict && typeof effect.strict === 'object') {
    return effect.strict.enabled !== false;
  }
  return false;
};

const getStrictEffectOptions = (
  effect: TheThracianOxlintOptions['effect'],
): TheThracianEffectStrictOptions | undefined => {
  if (!isStrictEffectEnabled(effect) || !effect || typeof effect !== 'object') {
    return undefined;
  }
  if (effect.strict === true) {
    return undefined;
  }
  if (!effect.strict || typeof effect.strict !== 'object') {
    return undefined;
  }
  return effect.strict;
};

const buildEffectRules = (
  effect: TheThracianOxlintOptions['effect'],
): Record<string, OxlintRuleSetting> => {
  if (!isEffectEnabled(effect)) {
    return {};
  }

  const strictOptions = getStrictEffectOptions(effect);
  const strictPathOptions = sanitizeStrictPathOptions(strictOptions);
  const defaultRuleSetting = effectRuleSetting(strictPathOptions);
  const ruleEntries: [string, OxlintRuleSetting][] = effectDefaultRuleNames.map((ruleName) => [
    `thethracian/${ruleName}`,
    defaultRuleSetting,
  ]);

  if (strictOptions) {
    ruleEntries.push(
      ...effectStrictRuleNames.map((ruleName): [string, OxlintRuleSetting] => [
        `thethracian/${ruleName}`,
        effectRuleSetting(strictPathOptions),
      ]),
    );
  } else if (isStrictEffectEnabled(effect)) {
    ruleEntries.push(
      ...effectStrictRuleNames.map((ruleName): [string, OxlintRuleSetting] => [
        `thethracian/${ruleName}`,
        'error',
      ]),
    );
  }

  return Object.fromEntries(ruleEntries);
};

const effectRuleSetting = (
  strictPathOptions: TheThracianEffectStrictOptions | undefined,
): OxlintRuleSetting => {
  if (strictPathOptions) {
    return ['error', strictPathOptions];
  }
  return 'error';
};

const typeAwareRuleSetting = (isTypeAware: boolean | undefined): ToggleRuleSetting => {
  if (isTypeAware) {
    return 'error';
  }
  return 'off';
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

const staticRules = {
  complexity: ['error', { max: 10 }],
  eqeqeq: 'error',
  'import/exports-last': 'off',
  'import/extensions': ['error', 'never', { checkTypeImports: true }],
  'import/group-exports': 'off',
  'import/max-dependencies': ['error', { max: 20 }],
  'import/no-named-export': 'off',
  'import/no-nodejs-modules': 'off',
  'import/prefer-default-export': 'off',
  'max-depth': ['error', { max: 3 }],
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
  'max-nested-callbacks': ['error', { max: 4 }],
  'max-params': ['error', { max: 5 }],
  'no-console': 'error',
  'no-debugger': 'error',
  'no-duplicate-imports': 'off',
  'no-empty': ['error', { allowEmptyCatch: false }],
  'no-eval': 'error',
  'no-inline-comments': 'error',
  'no-magic-numbers': [
    'error',
    {
      ignore: [-1, 0, 1, 2],
      ignoreArrayIndexes: true,
      ignoreDefaultValues: true,
      ignoreTypeIndexes: true,
    },
  ],
  'no-new-func': 'error',
  'no-param-reassign': ['error', { props: true }],
  'no-script-url': 'error',
  'no-warning-comments': 'error',
  'prefer-const': ['error', { destructuring: 'any' }],
  'preserve-caught-error': 'error',
  'sort-imports': [
    'error',
    {
      allowSeparatedGroups: true,
      ignoreDeclarationSort: false,
      ignoreMemberSort: false,
      memberSyntaxSortOrder: ['none', 'all', 'multiple', 'single'],
    },
  ],
  'thethracian/acronym-case': 'error',
  'thethracian/boolean-prefix': 'error',
  'thethracian/camel-case-identifiers': 'error',
  'thethracian/max-import-depth': 'error',
  'thethracian/max-line-length': 'error',
  'thethracian/no-commented-out-code': 'error',
  'thethracian/no-dynamic-js-extension-imports': 'error',
  'thethracian/no-local-export-list': 'error',
  'thethracian/pascal-case-types': 'error',
  'thethracian/private-underscore': 'error',
  'thethracian/require-file-doc': 'error',
  'thethracian/require-function-doc': 'error',
  'typescript/explicit-function-return-type': 'error',
  'typescript/no-explicit-any': 'error',
  'typescript/no-non-null-assertion': 'error',
  'typescript/no-unsafe-call': 'error',
  'typescript/no-unsafe-member-access': 'error',
  'typescript/only-throw-error': 'error',
  'unicorn/no-array-sort': 'off',
  'unicorn/prefer-ternary': 'off',
} satisfies RuleMap;

const typeAwareRules = (typeAwareRule: ToggleRuleSetting): RuleMap => ({
  'typescript/no-floating-promises': typeAwareRule,
  'typescript/no-implied-eval': typeAwareRule,
  'typescript/no-misused-promises': typeAwareRule,
  'typescript/no-unsafe-argument': typeAwareRule,
  'typescript/no-unsafe-assignment': typeAwareRule,
  'typescript/no-unsafe-return': typeAwareRule,
  'typescript/prefer-promise-reject-errors': typeAwareRule,
  'typescript/switch-exhaustiveness-check': typeAwareRule,
});

const baseRules = (typeAwareRule: ToggleRuleSetting): RuleMap => ({
  ...staticRules,
  ...typeAwareRules(typeAwareRule),
});

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
