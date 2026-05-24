import { defineConfig } from 'oxlint';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sanitizeStrictPathOptions } from './rules/effect-path-options.js';
import { effectDefaultRuleNames, effectStrictRuleNames } from './rules/effect-rule-names.js';

type TheThracianOxlintOptions = {
  typeAware?: boolean;
  effect?: boolean | TheThracianEffectOptions;
};

type TheThracianEffectOptions = {
  enabled?: boolean;
  strict?: boolean | TheThracianEffectStrictOptions;
};

type TheThracianEffectStrictOptions = {
  adapterLayers?: readonly string[];
  compositionRoots?: readonly string[];
  configLayers?: readonly string[];
  domain?: readonly string[];
  enabled?: boolean;
  entrypoints?: readonly string[];
  integrationTests?: readonly string[];
  unitTests?: readonly string[];
};

type OxlintRuleSetting = 'error' | ['error', TheThracianEffectStrictOptions];

function isEffectEnabled(effect: TheThracianOxlintOptions['effect']): boolean {
  if (effect === false) {
    return false;
  }
  if (effect && typeof effect === 'object' && effect.enabled === false) {
    return false;
  }
  return true;
}

function isStrictEffectEnabled(effect: TheThracianOxlintOptions['effect']): boolean {
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
}

function getStrictEffectOptions(
  effect: TheThracianOxlintOptions['effect'],
): TheThracianEffectStrictOptions | undefined {
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
}

function buildEffectRules(
  effect: TheThracianOxlintOptions['effect'],
): Record<string, OxlintRuleSetting> {
  if (!isEffectEnabled(effect)) {
    return {};
  }

  const strictOptions = getStrictEffectOptions(effect);
  const strictPathOptions = sanitizeStrictPathOptions(strictOptions);
  const defaultRuleSetting: OxlintRuleSetting = strictPathOptions
    ? ['error', strictPathOptions]
    : 'error';
  const ruleEntries: [string, OxlintRuleSetting][] = effectDefaultRuleNames.map((ruleName) => [
    `thethracian/${ruleName}`,
    defaultRuleSetting,
  ]);

  if (strictOptions) {
    ruleEntries.push(
      ...effectStrictRuleNames.map((ruleName): [string, OxlintRuleSetting] => [
        `thethracian/${ruleName}`,
        strictPathOptions ? ['error', strictPathOptions] : 'error',
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
}

export default function theThracianOxlint(options: TheThracianOxlintOptions = {}) {
  const pluginPath = join(dirname(fileURLToPath(import.meta.url)), 'rules', 'plugin.js');
  const typeAwareOptions = options.typeAware
    ? {
        typeAware: true,
        typeCheck: true,
      }
    : undefined;

  return defineConfig({
    ...(typeAwareOptions ? { options: typeAwareOptions } : {}),
    categories: {
      correctness: 'error',
      suspicious: 'error',
      perf: 'error',
      style: 'error',
    },
    plugins: ['typescript', 'oxc', 'import', 'promise', 'unicorn'],
    jsPlugins: ['oxlint-plugin-complexity', pluginPath],
    rules: {
      'complexity/complexity': ['error', { cyclomatic: 10 }],
      'thethracian/no-commented-out-code': 'error',
      'thethracian/pascal-case-types': 'error',
      'thethracian/camel-case-identifiers': 'error',
      'thethracian/boolean-prefix': 'error',
      'thethracian/private-underscore': 'error',
      'thethracian/acronym-case': 'error',
      'thethracian/max-import-depth': 'error',
      'thethracian/max-line-length': 'error',
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
      'no-empty': ['error', { allowEmptyCatch: false }],
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
      ...buildEffectRules(options.effect),
    },
  });
}

export type { TheThracianEffectOptions, TheThracianEffectStrictOptions, TheThracianOxlintOptions };
