import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import theThracianOxlint from '../src/index';

const removedRules = [
  'arrow-body-style',
  'capitalized-comments',
  'func-name-matching',
  'func-names',
  'func-style',
  'id-denylist',
  'id-length',
  'id-match',
  'import/max-dependencies',
  'import/extensions',
  'init-declarations',
  'max-statements',
  'new-cap',
  'no-inline-comments',
  'no-magic-numbers',
  'no-multi-assign',
  'no-multi-str',
  'no-nested-ternary',
  'no-ternary',
  'no-warning-comments',
  'no-underscore-dangle',
  'prefer-arrow-callback',
  'prefer-destructuring',
  'sort-imports',
  'sort-keys',
  'thethracian/acronym-case',
  'thethracian/boolean-prefix',
  'thethracian/camel-case-identifiers',
  'thethracian/max-import-depth',
  'thethracian/max-line-length',
  'thethracian/no-commented-out-code',
  'thethracian/no-dynamic-js-extension-imports',
  'thethracian/no-local-export-list',
  'thethracian/pascal-case-types',
  'thethracian/private-underscore',
  'thethracian/require-file-doc',
  'thethracian/require-function-doc',
  'typescript/explicit-function-return-type',
  'unicorn/max-nested-calls',
  'unicorn/no-nested-ternary',
  'unicorn/no-null',
  'unicorn/number-literal-case',
  'unicorn/numeric-separators-style',
  'yoda',
] as const;

const removedInheritedRules = [
  'import/no-unassigned-import',
  'no-console',
  'no-new',
  'no-underscore-dangle',
  'oxc/no-async-endpoint-handlers',
  'oxc/no-this-in-exported-function',
  'promise/always-return',
  'promise/no-callback-in-promise',
  'promise/no-promise-in-callback',
  'typescript/no-extraneous-class',
  'typescript/no-explicit-any',
  'typescript/no-non-null-assertion',
  'typescript/no-unsafe-type-assertion',
  'typescript/no-unnecessary-type-parameters',
  'typescript/prefer-namespace-keyword',
  'unicorn/consistent-function-scoping',
  'unicorn/no-array-reverse',
  'unicorn/no-array-sort',
  'unicorn/no-await-in-promise-methods',
  'unicorn/no-new-array',
  'unicorn/no-single-promise-in-promise-methods',
  'unicorn/no-unnecessary-await',
  'unicorn/prefer-add-event-listener',
  'unicorn/prefer-set-size',
  'unicorn/prefer-string-starts-ends-with',
  'unicorn/require-module-specifiers',
] as const;

const packageJSON = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
) as {
  scripts: {
    'lint:fix': string;
    'lint:local:fix': string;
    'lint:type-aware:fix': string;
    'lint:local:type-aware:fix': string;
  };
  'lint-staged': Record<string, string[]>;
};

describe('high-signal strict config', (): void => {
  it('resets inherited correctness defaults before applying the explicit allowlist', (): void => {
    const config = theThracianOxlint();

    expect(config.categories).toStrictEqual({ correctness: 'allow' });
    expect(config.rules).toHaveProperty('import/no-duplicates', [
      'error',
      { considerQueryString: true, preferInline: false },
    ]);
    expect(config.rules).toHaveProperty('oxc/only-used-in-recursion', 'error');
    expect(Object.keys(config.rules ?? {})).toHaveLength(143);
  });

  it('adds every semantic native rule only when type-aware linting is requested', (): void => {
    const defaultRules = theThracianOxlint().rules ?? {};
    const typeAwareRules = theThracianOxlint({ typeAware: true }).rules ?? {};
    const addedRules = Object.keys(typeAwareRules).filter(
      (ruleName) => !Object.hasOwn(defaultRules, ruleName),
    );

    expect(addedRules.sort()).toStrictEqual([
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
    ]);
    expect(Object.keys(typeAwareRules)).toHaveLength(174);
    expect(typeAwareRules).not.toHaveProperty('typescript/no-unnecessary-type-parameters');
  });

  it('uses strict but non-fragmenting numeric limits', (): void => {
    const config = theThracianOxlint();

    expect(config.rules).toHaveProperty('complexity', ['error', { max: 10 }]);
    expect(config.rules).toHaveProperty('max-depth', ['error', { max: 5 }]);
    expect(config.rules).toHaveProperty('max-lines', [
      'error',
      { max: 5000, skipBlankLines: true, skipComments: true },
    ]);
    expect(config.rules).toHaveProperty('max-lines-per-function', [
      'error',
      { max: 150, skipBlankLines: true, skipComments: true },
    ]);
    expect(config.rules).toHaveProperty('max-nested-callbacks', ['error', { max: 6 }]);
    expect(config.rules).toHaveProperty('max-params', ['error', { max: 7 }]);
    expect(config.rules).toHaveProperty('no-param-reassign', ['error', { props: false }]);
  });

  it.each(removedRules)('removes noisy rule %s from the preset', (ruleName): void => {
    expect(theThracianOxlint().rules).not.toHaveProperty(ruleName);
  });

  it.each(removedInheritedRules)(
    'omits inherited noisy rule %s from the effective preset',
    (ruleName): void => {
      expect(theThracianOxlint().rules).not.toHaveProperty(ruleName);
    },
  );
});

describe('high-signal strict config severity and automatic fixes', (): void => {
  it('exports only error rules, never warnings or rule-level removals', (): void => {
    const config = theThracianOxlint({ effect: true });

    for (const setting of Object.values(config.rules ?? {})) {
      const severity = Array.isArray(setting) ? setting[0] : setting;
      expect(severity).toBe('error');
    }
  });

  it('keeps semantic codemods out of automatic fix commands', (): void => {
    const automaticScripts = [
      packageJSON.scripts['lint:fix'],
      packageJSON.scripts['lint:local:fix'],
      packageJSON.scripts['lint:type-aware:fix'],
      packageJSON.scripts['lint:local:type-aware:fix'],
      ...Object.values(packageJSON['lint-staged']).flat(),
    ];

    for (const command of automaticScripts) {
      expect(command).not.toContain('codemod');
      expect(command).not.toContain('thx-codemod-fix');
    }
  });
});
