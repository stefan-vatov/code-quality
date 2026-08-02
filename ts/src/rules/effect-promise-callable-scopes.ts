/* -------------------------------------------------------------------------- */
/*             Lexical callable provenance for Promise execution.             */
/* -------------------------------------------------------------------------- */

import type { FunctionBinding, HelperScope, HelperScopes } from './effect-promise-callable-types';
import {
  addObjectBindings,
  addPrimaryBindings,
  addVariableAliases,
} from './effect-promise-callable-declarations';
import { childNode, childNodes, identifierName } from './effect-ast';
import type { ASTNode } from './effect-ast';
import type { ScopeStack } from './effect-ast-scope';
import { addPatternNames } from './effect-promise-pattern-bindings';

interface HelperScopesPath {
  readonly base: HelperScopes;
  readonly bindings: HelperScope;
  readonly index: number;
  readonly previous?: HelperScopesPath;
  values?: HelperScopes;
}

const helperScopesPaths = new WeakMap<object, HelperScopesPath>();

const buildHelperScopeValues = (path: HelperScopesPath): HelperScopes => {
  const values: HelperScope[] = [];
  values.length = path.index + 1;
  let current: HelperScopesPath | undefined = path;
  while (current) {
    values[current.index] = current.bindings;
    current = current.previous;
  }
  for (let index = 0; index < path.base.length; index += 1) {
    values[index] = path.base[index];
  }
  return values;
};

const helperScopeValues = (path: HelperScopesPath): HelperScopes => {
  const cached = path.values;
  if (cached) {
    return cached;
  }
  const values = buildHelperScopeValues(path);
  const currentPath = path;
  currentPath.values = values;
  return values;
};

const helperScopeIndex = (property: string | symbol): number | undefined => {
  if (typeof property !== 'string' || property === '') {
    return undefined;
  }
  const index = Number(property);
  if (!Number.isSafeInteger(index) || index < 0 || String(index) !== property) {
    return undefined;
  }
  return index;
};

const invokeHelperHandler = <Value>(
  handler: (scope: HelperScope, index: number, scopes: HelperScopes) => Value,
  scope: HelperScope,
  index: number,
  scopes: HelperScopes,
): Value => handler(scope, index, scopes);

const mapHelperScopes = <Value>(
  values: HelperScopes,
  handler: (scope: HelperScope, index: number, scopes: HelperScopes) => Value,
  scopes: HelperScopes,
): Value[] => {
  const result: Value[] = [];
  for (let index = 0; index < values.length; index += 1) {
    const scope = values[index];
    if (scope) {
      result.push(invokeHelperHandler(handler, scope, index, scopes));
    }
  }
  return result;
};

const everyHelperScope = (
  values: HelperScopes,
  handler: (scope: HelperScope, index: number, scopes: HelperScopes) => boolean,
  scopes: HelperScopes,
): boolean => {
  for (let index = 0; index < values.length; index += 1) {
    const scope = values[index];
    if (scope && !invokeHelperHandler(handler, scope, index, scopes)) {
      return false;
    }
  }
  return true;
};

const forEachHelperScope = (
  values: HelperScopes,
  handler: (scope: HelperScope, index: number, scopes: HelperScopes) => void,
  scopes: HelperScopes,
): void => {
  for (let index = 0; index < values.length; index += 1) {
    const scope = values[index];
    if (scope) {
      invokeHelperHandler(handler, scope, index, scopes);
    }
  }
};

const someHelperScope = (
  values: HelperScopes,
  handler: (scope: HelperScope, index: number, scopes: HelperScopes) => boolean,
  scopes: HelperScopes,
): boolean => {
  for (let index = 0; index < values.length; index += 1) {
    const scope = values[index];
    if (scope && invokeHelperHandler(handler, scope, index, scopes)) {
      return true;
    }
  }
  return false;
};

const helperScopeMethod = (
  path: HelperScopesPath,
  property: string | symbol,
  receiver: HelperScopes,
): unknown => {
  if (property === 'map' || property === 'every' || property === 'forEach' || property === 'some') {
    return helperScopeCollectionMethod(path, property, receiver);
  }
  return helperScopeStructuralMethod(path, property);
};

const helperScopeCollectionMethod = (
  path: HelperScopesPath,
  property: string | symbol,
  receiver: HelperScopes,
): unknown => {
  const values = helperScopeValues(path);
  if (property === 'map') {
    return <Value>(
      handler: (scope: HelperScope, index: number, scopes: HelperScopes) => Value,
    ): Value[] => mapHelperScopes(values, handler, receiver);
  }
  if (property === 'every') {
    return (
      handler: (scope: HelperScope, index: number, scopes: HelperScopes) => boolean,
    ): boolean => everyHelperScope(values, handler, receiver);
  }
  if (property === 'forEach') {
    return (handler: (scope: HelperScope, index: number, scopes: HelperScopes) => void): void =>
      forEachHelperScope(values, handler, receiver);
  }
  if (property === 'some') {
    return (
      handler: (scope: HelperScope, index: number, scopes: HelperScopes) => boolean,
    ): boolean => someHelperScope(values, handler, receiver);
  }
  return undefined;
};

const helperScopeStructuralMethod = (
  path: HelperScopesPath,
  property: string | symbol,
): unknown => {
  if (property === 'indexOf') {
    return helperScopeIndexOfMethod(path);
  }
  if (property === 'slice') {
    return helperScopeSliceMethod(path);
  }
  if (property === Symbol.iterator) {
    return helperScopeIteratorMethod(path);
  }
  if (property === 'length') {
    return path.index + 1;
  }
  return undefined;
};

const helperScopeIndexOfMethod = (path: HelperScopesPath): unknown => {
  const values = helperScopeValues(path);
  return (value: HelperScope, fromIndex?: number): number => values.indexOf(value, fromIndex);
};

const helperScopeSliceMethod = (path: HelperScopesPath): unknown => {
  const values = helperScopeValues(path);
  return (start?: number, end?: number): HelperScopes => {
    if (start === path.index && (end === undefined || end > path.index)) {
      return [path.bindings];
    }
    if (start === path.index + 1) {
      return [];
    }
    return values.slice(start, end);
  };
};

const helperScopeIteratorMethod = (path: HelperScopesPath): unknown => {
  const values = helperScopeValues(path);
  return (): IterableIterator<HelperScope> => values[Symbol.iterator]();
};

const helperScopeIndexedValue = (
  path: HelperScopesPath,
  property: string | symbol,
): HelperScope | undefined => {
  const index = helperScopeIndex(property);
  if (index === undefined || index > path.index) {
    return undefined;
  }
  if (index === path.index) {
    return path.bindings;
  }
  return helperScopeValues(path)[index];
};

const isHelperScopes = (value: unknown): value is HelperScopes => Array.isArray(value);

const persistentHelperScopes = (inherited: HelperScopes, bindings: HelperScope): HelperScopes => {
  const previous = helperScopesPaths.get(inherited);
  const path: HelperScopesPath = {
    base: previous?.base ?? inherited,
    bindings,
    index: inherited.length,
    previous,
  };
  const target: HelperScope[] = [];
  const helperScopes = new Proxy(target, {
    get: (current, property, receiver): unknown => {
      let helperReceiver: HelperScopes = target;
      if (isHelperScopes(receiver)) {
        helperReceiver = receiver;
      }
      const method = helperScopeMethod(path, property, helperReceiver);
      if (method !== undefined) {
        return method;
      }
      const indexedValue = helperScopeIndexedValue(path, property);
      if (indexedValue !== undefined) {
        return indexedValue;
      }
      return Reflect.get(current, property, receiver);
    },
    has: (current, property): boolean => {
      const index = helperScopeIndex(property);
      if (index !== undefined) {
        return index <= path.index;
      }
      return Reflect.has(current, property);
    },
  });
  helperScopesPaths.set(helperScopes, path);
  return helperScopes;
};

/**
 * Append one callable helper scope without copying the inherited scope list.
 *
 * @param inherited - The helper scopes already visible at the call site.
 * @param bindings - Bindings introduced by the new scope.
 * @returns A scope list that resolves inherited entries lazily.
 * @throws Does not throw.
 */
export const appendHelperScope = persistentHelperScopes;

/**
 * Extend callable scopes with declarations owned by one statement container.
 *
 * @internal
 */
export const containerHelperScopes = (
  node: ASTNode,
  scopes: ScopeStack,
  inherited: HelperScopes,
): HelperScopes => {
  const bindings = new Map<string, FunctionBinding | undefined>();
  const helperScopes = persistentHelperScopes(inherited, bindings);
  const statements = childNodes(node, 'body');
  addPrimaryBindings(bindings, statements, scopes, helperScopes, node.type === 'Program');
  addObjectBindings(bindings, statements, scopes, helperScopes);
  addVariableAliases(bindings, statements, helperScopes);
  if (bindings.size === 0) {
    return inherited;
  }
  return helperScopes;
};

/**
 * Add parameter and named-function bindings for one invoked function.
 *
 * @internal
 */
export const functionHeaderScopes = (
  functionNode: ASTNode,
  binding: FunctionBinding,
): HelperScopes => {
  const bindings = new Map<string, FunctionBinding | undefined>();
  for (const parameter of childNodes(functionNode, 'params')) {
    addPatternNames(bindings, parameter);
  }
  const name = identifierName(childNode(functionNode, 'id'));
  if (name) {
    bindings.set(name, binding);
  }
  if (bindings.size === 0) {
    return binding.helperScopes;
  }
  return persistentHelperScopes(binding.helperScopes, bindings);
};
