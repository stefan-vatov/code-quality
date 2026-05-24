/**
 * Opt-in strict custom Effect lint rule definitions.
 *
 * @internal
 */
import { effectStrictASTSpecs } from './effect-strict-ast-specs';
import { effectStrictCoreSpecs } from './effect-strict-core-specs';
import { makeRules } from './effect-rule-core';
import { strictPathOptionsSchema } from './effect-path-options';

const effectStrictRules = makeRules([...effectStrictCoreSpecs, ...effectStrictASTSpecs], {
  schema: strictPathOptionsSchema,
});

export default effectStrictRules;
