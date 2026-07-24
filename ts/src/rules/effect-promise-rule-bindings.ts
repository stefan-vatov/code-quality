/* -------------------------------------------------------------------------- */
/*            Effect API binding cache for Promise boundary rules.            */
/* -------------------------------------------------------------------------- */

import type { EffectAPIBindings } from './effect-boundary-ast-shared';
import { effectAPIBindingsFor } from './effect-boundary-ast-shared';

/**
 * Mutable binding cache shared by one Promise rule visitor.
 *
 * @internal
 */
export interface PromiseBindingState {
  bindings: EffectAPIBindings | undefined;
  source: string;
}

const emptyEffectAPIBindings = (): EffectAPIBindings => ({
  directFunctionNames: new Map(),
  directFunctions: new Set(),
  namespaces: new Set(),
  rootNamespaces: new Set(),
  succeedFunctions: new Set(),
  suspendFunctions: new Set(),
  syncFunctions: new Set(),
});

/**
 * Read or build source-backed Effect API bindings.
 *
 * @internal
 */
export const sourceBindingsFor = (state: PromiseBindingState): EffectAPIBindings => {
  const { bindings, source } = state;
  if (bindings) {
    return bindings;
  }
  const sourceBindings = effectAPIBindingsFor(source);
  const mutableState = state;
  mutableState.bindings = sourceBindings;
  return sourceBindings;
};

/**
 * Read or initialize bindings populated by native Program indexing.
 *
 * @internal
 */
export const programBindingsFor = (state: PromiseBindingState): EffectAPIBindings => {
  const { bindings: existingBindings } = state;
  const bindings = existingBindings ?? emptyEffectAPIBindings();
  const mutableState = state;
  mutableState.bindings = bindings;
  return bindings;
};
