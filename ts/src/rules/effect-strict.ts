/* -------------------------------------------------------------------------- */
/*             Opt-in strict custom Effect lint rule definitions.             */
/* -------------------------------------------------------------------------- */
import { Array, pipe } from 'effect';
import { effectStrictASTSpecs } from './effect-strict-ast-specs';
import { effectStrictCoreSpecs } from './effect-strict-core-specs';
import { makeRules } from './effect-rule-core';
import { strictPathOptionsSchema } from './effect-path-options';

const effectStrictRules = pipe(
  effectStrictCoreSpecs,
  Array.appendAll(effectStrictASTSpecs),
  (strictSpecs) =>
    makeRules(strictSpecs, {
      schema: strictPathOptionsSchema,
    }),
);

export default effectStrictRules;
