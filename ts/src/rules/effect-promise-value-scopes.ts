/* -------------------------------------------------------------------------- */
/*             Lexical value provenance for Promise projections.              */
/* -------------------------------------------------------------------------- */

import type { HelperScope, HelperScopes } from './effect-promise-callable-types';
import type { ASTNode } from './effect-ast';
import type { ScopeStack } from './effect-ast-scope';

/**
 * One statically initialized value in a callable lexical scope.
 *
 * @internal
 */
export interface LexicalValueBinding {
  allowEarlyReference: boolean;
  availableAfter: number;
  declarationKind: 'lexical' | 'var';
  helperScopes: HelperScopes;
  node: ASTNode | undefined;
  scopes: ScopeStack;
  writes?: LexicalValueWrite[];
}

/**
 * One source-ordered write to a mutable lexical value.
 *
 * @internal
 */
export interface LexicalValueWrite {
  availableAfter: number;
  helperScopes: HelperScopes;
  node: ASTNode | undefined;
  scopes: ScopeStack;
}

interface LexicalValueResolution {
  binding?: LexicalValueBinding | LexicalValueWrite;
  found: boolean;
}

interface ScopedLexicalBinding {
  binding?: LexicalValueBinding;
  found: boolean;
  scope?: HelperScope;
}

const valuesByScope = new WeakMap<object, Map<string, LexicalValueBinding>>();
const executionOffsetByScope = new WeakMap<object, number>();
const runtimeValuesByScope = new WeakMap<object, ReadonlyMap<string, RuntimeLexicalValue>>();
const previousRuntimeNames = new WeakMap<
  object,
  ReadonlyMap<string, RuntimeLexicalValue> | undefined
>();
let runtimeValuesByName: ReadonlyMap<string, RuntimeLexicalValue> | undefined = undefined;

/**
 * Unknown dynamic lexical value after feasible runtime states join.
 *
 * @internal
 */
export const runtimeLexicalUnknown = Symbol('runtimeLexicalUnknown');
/**
 * Dynamic lexical value selected by the runtime task interpreter.
 *
 * @internal
 */
export type RuntimeLexicalValue = ASTNode | typeof runtimeLexicalUnknown | undefined;

const nodeOffset = (node: ASTNode, key: string): number => {
  const offset: unknown = Reflect.get(node, key);
  if (typeof offset === 'number') {
    return offset;
  }
  return -1;
};

/**
 * Attach an exact initializer to its existing lexical scope identity.
 *
 * @internal
 */
export const registerLexicalValue = (
  scope: HelperScope,
  name: string,
  binding: LexicalValueBinding,
): void => {
  let bindings = valuesByScope.get(scope);
  if (!bindings) {
    bindings = new Map();
    valuesByScope.set(scope, bindings);
  }
  bindings.set(name, binding);
};

/**
 * Append one exact source-ordered write to an indexed lexical value.
 *
 * @internal
 */
export const registerLexicalValueWrite = (
  helperScopes: HelperScopes,
  name: string,
  write: LexicalValueWrite,
): void => {
  const { binding } = scopedLexicalBinding(name, helperScopes);
  if (!binding) {
    return;
  }
  const { writes } = binding;
  if (writes) {
    writes.push(write);
  } else {
    binding.writes = [write];
  }
};

const scopedLexicalBinding = (name: string, helperScopes: HelperScopes): ScopedLexicalBinding => {
  for (let index = helperScopes.length - 1; index >= 0; index -= 1) {
    const scope = helperScopes[index];
    if (scope?.has(name)) {
      return { binding: valuesByScope.get(scope)?.get(name), found: true, scope };
    }
  }
  return { found: false };
};

/**
 * Select the per-scope runtime offsets used to read mutable lexical values.
 *
 * @internal
 */
export const setLexicalExecutionOffsets = (
  offsets: ReadonlyMap<HelperScope, number>,
): ReadonlyMap<HelperScope, number | undefined> => {
  const previousOffsets = new Map<HelperScope, number | undefined>();
  for (const [scope, offset] of offsets) {
    previousOffsets.set(scope, executionOffsetByScope.get(scope));
    executionOffsetByScope.set(scope, offset);
  }
  return previousOffsets;
};

/**
 * Restore lexical execution offsets after one isolated task analysis.
 *
 * @internal
 */
export const restoreLexicalExecutionOffsets = (
  previousOffsets: ReadonlyMap<HelperScope, number | undefined>,
): void => {
  for (const [scope, previousOffset] of previousOffsets) {
    if (previousOffset === undefined) {
      executionOffsetByScope.delete(scope);
    } else {
      executionOffsetByScope.set(scope, previousOffset);
    }
  }
};

/**
 * Install exact dynamic lexical values for one isolated runtime execution.
 *
 * @internal
 */
export const setRuntimeLexicalValues = (
  values: ReadonlyMap<HelperScope, ReadonlyMap<string, RuntimeLexicalValue>>,
): ReadonlyMap<HelperScope, ReadonlyMap<string, RuntimeLexicalValue> | undefined> => {
  const previous = new Map<HelperScope, ReadonlyMap<string, RuntimeLexicalValue> | undefined>();
  const runtimeNames = new Map<string, RuntimeLexicalValue>();
  for (const [scope, bindings] of values) {
    previous.set(scope, runtimeValuesByScope.get(scope));
    runtimeValuesByScope.set(scope, bindings);
    for (const [name, value] of bindings) {
      runtimeNames.set(name, value);
    }
  }
  previousRuntimeNames.set(previous, runtimeValuesByName);
  runtimeValuesByName = runtimeNames;
  return previous;
};

/**
 * Restore dynamic lexical values after one isolated runtime execution.
 *
 * @internal
 */
export const restoreRuntimeLexicalValues = (
  previous: ReadonlyMap<HelperScope, ReadonlyMap<string, RuntimeLexicalValue> | undefined>,
): void => {
  for (const [scope, bindings] of previous) {
    if (bindings) {
      runtimeValuesByScope.set(scope, bindings);
    } else {
      runtimeValuesByScope.delete(scope);
    }
  }
  runtimeValuesByName = previousRuntimeNames.get(previous);
  previousRuntimeNames.delete(previous);
};

/**
 * Read the source offset after which a lexical initializer is available.
 *
 * @internal
 */
export const lexicalValueAvailableAfter = (declarator: ASTNode): number =>
  nodeOffset(declarator, 'end');

const bindingAtOffset = (
  binding: LexicalValueBinding,
  scope: HelperScope,
): LexicalValueBinding | LexicalValueWrite => {
  const offset = executionOffsetByScope.get(scope);
  const { writes } = binding;
  if (offset === undefined) {
    return binding;
  }
  const selected = writes?.[writeInsertionIndex(writes, offset) - 1];
  if (selected) {
    return selected;
  }
  if (binding.declarationKind === 'var' && offset < binding.availableAfter) {
    return { ...binding, node: undefined };
  }
  return binding;
};

const writeInsertionIndex = (writes: readonly LexicalValueWrite[], offset: number): number => {
  let lower = 0;
  let upper = writes.length;
  while (lower < upper) {
    const middle = (lower + upper) >>> 1;
    const write = writes[middle];
    if (write && write.availableAfter <= offset) {
      lower = middle + 1;
    } else {
      upper = middle;
    }
  }
  return lower;
};

const bindingIsAvailable = (
  binding: LexicalValueBinding,
  scope: HelperScope,
  referenceStart: number,
): boolean => {
  const executionOffset = executionOffsetByScope.get(scope);
  if (executionOffset !== undefined) {
    return binding.declarationKind === 'var' || binding.availableAfter <= executionOffset;
  }
  return (
    binding.allowEarlyReference || referenceStart === -1 || binding.availableAfter <= referenceStart
  );
};

/**
 * Resolve a lexical value without crossing a nearer shadowing scope.
 *
 * @internal
 */
export const resolveLexicalValue = (
  name: string,
  reference: ASTNode,
  helperScopes: HelperScopes,
): LexicalValueResolution => {
  const referenceStart = nodeOffset(reference, 'start');
  const { binding, found, scope } = scopedLexicalBinding(name, helperScopes);
  const runtime = runtimeLexicalResolution(name, binding, scope, helperScopes);
  if (runtime) {
    return runtime;
  }
  if (binding && scope && bindingIsAvailable(binding, scope, referenceStart)) {
    return { binding: bindingAtOffset(binding, scope), found: true };
  }
  return { found };
};

const runtimeLexicalResolution = (
  name: string,
  binding: LexicalValueBinding | undefined,
  scope: HelperScope | undefined,
  helperScopes: HelperScopes,
): LexicalValueResolution | undefined => {
  const runtimeValues = scope && runtimeValuesByScope.get(scope);
  const hasScopedValue = runtimeValues?.has(name) ?? false;
  if (!hasScopedValue && !runtimeValuesByName?.has(name)) {
    return undefined;
  }
  const runtimeValue = selectedRuntimeValue(name, runtimeValues, hasScopedValue);
  if (typeof runtimeValue === 'symbol') {
    return { found: true };
  }
  if (!binding) {
    return syntheticRuntimeResolution(runtimeValue, helperScopes);
  }
  return { binding: { ...binding, node: runtimeValue }, found: true };
};

const selectedRuntimeValue = (
  name: string,
  runtimeValues: ReadonlyMap<string, RuntimeLexicalValue> | undefined,
  hasScopedValue: boolean,
): RuntimeLexicalValue => {
  if (hasScopedValue) {
    return runtimeValues?.get(name);
  }
  return runtimeValuesByName?.get(name);
};

const syntheticRuntimeResolution = (
  runtimeValue: ASTNode | undefined,
  helperScopes: HelperScopes,
): LexicalValueResolution => ({
  binding: {
    allowEarlyReference: true,
    availableAfter: -1,
    declarationKind: 'lexical',
    helperScopes,
    node: runtimeValue,
    scopes: [],
  },
  found: true,
});
