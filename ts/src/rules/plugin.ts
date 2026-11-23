import { eslintCompatPlugin } from '@oxlint/plugins';
import effectDefaultRules from './internal/effect-default';
import effectStrictRules from './internal/effect-strict';
import { noArrayFilterMapRule } from './internal/no-array-filter-map';
import { noChainedTypeAssertionsRule } from './internal/no-chained-type-assertions';
import { noConditionalEmptyObjectSpreadRule } from './internal/no-conditional-empty-object-spread';
import { noKnownValueWideningRule } from './internal/no-known-value-widening';
import { noModuleMockingRule } from './internal/no-module-mocking';
import { noObjectParametersRule } from './internal/no-object-parameters';
import { noReduceAccumulatorCopyRule } from './internal/no-reduce-accumulator-copy';
import { noReflectApplyRule } from './internal/no-reflect-apply';
import { noReflectGetRule } from './internal/no-reflect-get';
import { noRuntimeTypeofRule } from './internal/no-runtime-typeof';
import { noForbiddenTermInSymbolNamesRule } from './internal/no-shape-in-symbol-names';
import { noTryCatchThrowRule } from './internal/no-try-catch-throw';
import { noUnknownParametersRule } from './internal/no-unknown-parameters';
import { noUnknownReturnsRule } from './internal/no-unknown-returns';
import { noUnknownTypeAliasesRule } from './internal/no-unknown-type-aliases';
import { noUnsafeDictionaryTypeRule } from './internal/no-unsafe-dictionary-type';
import { noWidenThenAssertRule } from './internal/no-widen-then-assert';
import { noServiceConstructorImportsRule } from './internal/no-service-constructor-imports';

type OxlintPlugin = Parameters<typeof eslintCompatPlugin>[0];

const plugin: OxlintPlugin = {
  meta: {
    name: 'thethracian',
  },
  rules: {
    ...effectDefaultRules,
    ...effectStrictRules,
    'no-array-filter-map': noArrayFilterMapRule,
    'no-chained-type-assertions': noChainedTypeAssertionsRule,
    'no-conditional-empty-object-spread': noConditionalEmptyObjectSpreadRule,
    'no-known-value-widening': noKnownValueWideningRule,
    'no-module-mocking': noModuleMockingRule,
    'no-object-parameters': noObjectParametersRule,
    'no-reduce-accumulator-copy': noReduceAccumulatorCopyRule,
    'no-reflect-apply': noReflectApplyRule,
    'no-reflect-get': noReflectGetRule,
    'no-runtime-typeof': noRuntimeTypeofRule,
    'no-shape-in-symbol-names': noForbiddenTermInSymbolNamesRule,
    'no-try-catch-throw': noTryCatchThrowRule,
    'no-unknown-parameters': noUnknownParametersRule,
    'no-unknown-returns': noUnknownReturnsRule,
    'no-unknown-type-aliases': noUnknownTypeAliasesRule,
    'no-unsafe-dictionary-type': noUnsafeDictionaryTypeRule,
    'no-widen-then-assert': noWidenThenAssertRule,
    'no-service-constructor-imports': noServiceConstructorImportsRule,
  },
};

export default eslintCompatPlugin(plugin);
