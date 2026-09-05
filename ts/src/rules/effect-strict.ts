import { effectStrictCoreSpecs } from './effect-strict-core-specs';
import { makeRules } from './effect-rule-core';

const effectStrictRules = makeRules(effectStrictCoreSpecs);

export default effectStrictRules;
