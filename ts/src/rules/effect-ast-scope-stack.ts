/* -------------------------------------------------------------------------- */
/*           Persistent lexical scope stacks for AST-backed rules.            */
/* -------------------------------------------------------------------------- */

import type { ScopeStack } from './effect-ast-scope';
import { Predicate } from 'effect';

interface ScopeStackPath {
  readonly base: ScopeStack;
  readonly bindings: ReadonlySet<string>;
  readonly index: number;
  readonly previous?: ScopeStackPath;
  values?: ScopeStack;
}

const scopeStackPaths = new WeakMap<object, ScopeStackPath>();
const persistentScopeStackThreshold = 0;

type ScopeHandler<Value> = (scope: ReadonlySet<string>, index: number, scopes: ScopeStack) => Value;
type ScopeCollectionMethod =
  | (<Value>(handler: ScopeHandler<Value>) => Value[])
  | ((handler: ScopeHandler<boolean>) => boolean)
  | ((handler: ScopeHandler<void>) => void);
type ScopeStackProperty =
  | ReadonlySet<string>
  | ScopeCollectionMethod
  | ((index: number) => ReadonlySet<string> | undefined)
  | (() => IterableIterator<ReadonlySet<string>>)
  | number
  | undefined;

const buildScopeValues = (path: ScopeStackPath): ScopeStack => {
  const values: ReadonlySet<string>[] = [];
  values.length = path.index + 1;
  let current: ScopeStackPath | undefined = path;
  while (current) {
    values[current.index] = current.bindings;
    current = current.previous;
  }
  for (let index = 0; index < path.base.length; index += 1) {
    values[index] = path.base[index];
  }
  return values;
};

const scopeValues = (path: ScopeStackPath): ScopeStack => {
  const cached = path.values;
  if (cached) {
    return cached;
  }
  const values = buildScopeValues(path);
  const currentPath = path;
  currentPath.values = values;
  return values;
};

const arrayIndexFor = (property: string | symbol): number | undefined => {
  if (!Predicate.isString(property) || property === '') {
    return undefined;
  }
  const index = Number(property);
  if (!Number.isSafeInteger(index) || index < 0 || String(index) !== property) {
    return undefined;
  }
  return index;
};

const invokeScopeHandler = <Value>(
  handler: (scope: ReadonlySet<string>, index: number, scopes: ScopeStack) => Value,
  scope: ReadonlySet<string>,
  index: number,
  scopes: ScopeStack,
): Value => handler(scope, index, scopes);

const mapScopes = <Value>(
  values: ScopeStack,
  handler: (scope: ReadonlySet<string>, index: number, scopes: ScopeStack) => Value,
  scopes: ScopeStack,
): Value[] => {
  const result: Value[] = [];
  for (let index = 0; index < values.length; index += 1) {
    const scope = values[index];
    if (scope) {
      result.push(invokeScopeHandler(handler, scope, index, scopes));
    }
  }
  return result;
};

const everyScope = (
  values: ScopeStack,
  handler: (scope: ReadonlySet<string>, index: number, scopes: ScopeStack) => boolean,
  scopes: ScopeStack,
): boolean => {
  for (let index = 0; index < values.length; index += 1) {
    const scope = values[index];
    if (scope && !invokeScopeHandler(handler, scope, index, scopes)) {
      return false;
    }
  }
  return true;
};

const forEachScope = (
  values: ScopeStack,
  handler: (scope: ReadonlySet<string>, index: number, scopes: ScopeStack) => void,
  scopes: ScopeStack,
): void => {
  for (let index = 0; index < values.length; index += 1) {
    const scope = values[index];
    if (scope) {
      invokeScopeHandler(handler, scope, index, scopes);
    }
  }
};

const someScope = (
  values: ScopeStack,
  handler: (scope: ReadonlySet<string>, index: number, scopes: ScopeStack) => boolean,
  scopes: ScopeStack,
): boolean => {
  for (let index = 0; index < values.length; index += 1) {
    const scope = values[index];
    if (scope && invokeScopeHandler(handler, scope, index, scopes)) {
      return true;
    }
  }
  return false;
};

const scopeStackMethod = (
  path: ScopeStackPath,
  property: string | symbol,
  receiver: ScopeStack,
): ScopeStackProperty => {
  if (property === 'map' || property === 'every' || property === 'forEach' || property === 'some') {
    return scopeCollectionMethod(path, property, receiver);
  }
  return scopeStructuralMethod(path, property);
};

const scopeCollectionMethod = (
  path: ScopeStackPath,
  property: string | symbol,
  receiver: ScopeStack,
): ScopeStackProperty => {
  const values = scopeValues(path);
  if (property === 'map') {
    return <Value>(
      handler: (scope: ReadonlySet<string>, index: number, scopes: ScopeStack) => Value,
    ): Value[] => mapScopes(values, handler, receiver);
  }
  if (property === 'every') {
    return (
      handler: (scope: ReadonlySet<string>, index: number, scopes: ScopeStack) => boolean,
    ): boolean => everyScope(values, handler, receiver);
  }
  if (property === 'forEach') {
    return (
      handler: (scope: ReadonlySet<string>, index: number, scopes: ScopeStack) => void,
    ): void => forEachScope(values, handler, receiver);
  }
  if (property === 'some') {
    return (
      handler: (scope: ReadonlySet<string>, index: number, scopes: ScopeStack) => boolean,
    ): boolean => someScope(values, handler, receiver);
  }
  return undefined;
};

const scopeStructuralMethod = (
  path: ScopeStackPath,
  property: string | symbol,
): ScopeStackProperty => {
  if (property === 'at') {
    const values = scopeValues(path);
    return (index: number): ReadonlySet<string> | undefined => values.at(index);
  }
  if (property === Symbol.iterator) {
    const values = scopeValues(path);
    return (): IterableIterator<ReadonlySet<string>> => values[Symbol.iterator]();
  }
  if (property === 'length') {
    return path.index + 1;
  }
  return undefined;
};

const scopeStackIndexedValue = (
  path: ScopeStackPath,
  property: string | symbol,
): ReadonlySet<string> | undefined => {
  const index = arrayIndexFor(property);
  if (index === undefined || index > path.index) {
    return undefined;
  }
  if (index === path.index) {
    return path.bindings;
  }
  return scopeValues(path)[index];
};

const isScopeStack = (value: unknown): value is ScopeStack => Array.isArray(value);

const persistentScopeStack = (scopes: ScopeStack, bindings: ReadonlySet<string>): ScopeStack => {
  const previous = scopeStackPaths.get(scopes);
  const path: ScopeStackPath = {
    base: previous?.base ?? scopes,
    bindings,
    index: scopes.length,
    previous,
  };
  const target: ReadonlySet<string>[] = [];
  const stack = new Proxy(target, {
    get: (current, property, receiver): ScopeStackProperty => {
      const stackReceiver = isScopeStack(receiver) ? receiver : target;
      const method = scopeStackMethod(path, property, stackReceiver);
      if (method !== undefined) {
        return method;
      }
      const indexedValue = scopeStackIndexedValue(path, property);
      if (indexedValue !== undefined) {
        return indexedValue;
      }
      return undefined;
    },
    has: (current, property): boolean => {
      const index = arrayIndexFor(property);
      if (index !== undefined) {
        return index <= path.index;
      }
      return Reflect.has(current, property);
    },
  });
  scopeStackPaths.set(stack, path);
  return stack;
};

const appendScopeStack = (scopes: ScopeStack, bindings: ReadonlySet<string>): ScopeStack => {
  if (bindings.size === 0) {
    return scopes;
  }
  if (scopes.length < persistentScopeStackThreshold) {
    return [...scopes, bindings];
  }
  return persistentScopeStack(scopes, bindings);
};

const pathScope = (scopes: ScopeStack): ScopeStackPath | undefined => scopeStackPaths.get(scopes);

const forEachPlainScopeFromInner = (
  scopes: ScopeStack,
  handler: (scope: ReadonlySet<string>) => boolean,
): boolean => {
  for (let index = scopes.length - 1; index >= 0; index -= 1) {
    const scope = scopes[index];
    if (scope && handler(scope)) {
      return true;
    }
  }
  return false;
};

const forEachPersistentScopeFromInner = (
  path: ScopeStackPath,
  handler: (scope: ReadonlySet<string>) => boolean,
): boolean => {
  let current: ScopeStackPath | undefined = path;
  while (current) {
    if (handler(current.bindings)) {
      return true;
    }
    current = current.previous;
  }
  for (let index = path.base.length - 1; index >= 0; index -= 1) {
    const scope = path.base[index];
    if (scope && handler(scope)) {
      return true;
    }
  }
  return false;
};

const forEachScopeFromInner = (
  scopes: ScopeStack,
  handler: (scope: ReadonlySet<string>) => boolean,
): boolean => {
  const path = pathScope(scopes);
  if (!path) {
    return forEachPlainScopeFromInner(scopes, handler);
  }
  return forEachPersistentScopeFromInner(path, handler);
};

/**
 * Check whether a lexical scope stack contains a binding.
 *
 * @internal
 */
export const scopeHasBinding = (name: string, scopes: ScopeStack): boolean =>
  forEachScopeFromInner(scopes, (scope): boolean => scope.has(name));

/**
 * Find the nearest lexical scope containing a binding.
 *
 * @internal
 */
export const scopeContainingBinding = (
  name: string,
  scopes: ScopeStack,
): ReadonlySet<string> | undefined => {
  let found: ReadonlySet<string> | undefined = undefined;
  forEachScopeFromInner(scopes, (scope): boolean => {
    if (scope.has(name)) {
      found = scope;
      return true;
    }
    return false;
  });
  return found;
};

/**
 * Extend a scope stack without copying its existing entries.
 *
 * @internal
 */
export const extendScopeStack = appendScopeStack;
