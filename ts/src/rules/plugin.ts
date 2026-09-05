import { eslintCompatPlugin } from '@oxlint/plugins';
import effectDefaultRules from './effect-default';
import effectStrictRules from './effect-strict';
import { noChainedTypeAssertionsRule } from './no-chained-type-assertions';
import { noConditionalEmptyObjectSpreadRule } from './no-conditional-empty-object-spread';
import { noKnownValueWideningRule } from './no-known-value-widening';
import { noModuleMockingRule } from './no-module-mocking';
import { noObjectParametersRule } from './no-object-parameters';
import { noReflectApplyRule } from './no-reflect-apply';
import { noReflectGetRule } from './no-reflect-get';
import { noRuntimeTypeofRule } from './no-runtime-typeof';
import { noForbiddenTermInSymbolNamesRule } from './no-shape-in-symbol-names';
import { noUnknownParametersRule } from './no-unknown-parameters';
import { noUnknownReturnsRule } from './no-unknown-returns';
import { noUnknownTypeAliasesRule } from './no-unknown-type-aliases';
import { noUnsafeDictionaryTypeRule } from './no-unsafe-dictionary-type';
import { noWidenThenAssertRule } from './no-widen-then-assert';
import { noServiceConstructorImportsRule } from './no-service-constructor-imports';

type OxlintPlugin = Parameters<typeof eslintCompatPlugin>[0];

const plugin = {
  meta: {
    name: 'thethracian',
  },
  rules: {
    ...effectDefaultRules,
    ...effectStrictRules,
    'no-chained-type-assertions': noChainedTypeAssertionsRule,
    'no-conditional-empty-object-spread': noConditionalEmptyObjectSpreadRule,
    'no-known-value-widening': noKnownValueWideningRule,
    'no-module-mocking': noModuleMockingRule,
    'no-object-parameters': noObjectParametersRule,
    'no-reflect-apply': noReflectApplyRule,
    'no-reflect-get': noReflectGetRule,
    'no-runtime-typeof': noRuntimeTypeofRule,
    'no-shape-in-symbol-names': noForbiddenTermInSymbolNamesRule,
    'no-unknown-parameters': noUnknownParametersRule,
    'no-unknown-returns': noUnknownReturnsRule,
    'no-unknown-type-aliases': noUnknownTypeAliasesRule,
    'no-unsafe-dictionary-type': noUnsafeDictionaryTypeRule,
    'no-widen-then-assert': noWidenThenAssertRule,
    'no-service-constructor-imports': noServiceConstructorImportsRule,
  },
};

type PluginBridgeInput = OxlintPlugin | typeof plugin;

const toOxlintPlugin = (value: PluginBridgeInput): OxlintPlugin => {
  return value as OxlintPlugin;
};

const validPlugin = toOxlintPlugin(plugin);

export default eslintCompatPlugin(validPlugin);
