/* -------------------------------------------------------------------------- */
/*     Stack-safe traversal shared by the yieldable-error matcher state.      */
/* -------------------------------------------------------------------------- */

import { asNode, childNode } from './effect-ast';
import { scopesForChild, withNodeScope } from './effect-ast-scope';
import type { ASTNode } from './effect-ast';

/**
 * Lexical scopes visible at an AST node.
 */
export type ScopeStack = readonly ReadonlySet<string>[];

/**
 * Native visitor-key metadata used to avoid reflected AST traversal.
 */
export type VisitorKeys = Readonly<Record<string, readonly string[]>>;

/**
 * A delegated failure candidate retained until global class mutations are known.
 */
export type PendingYield = readonly [yieldExpression: ASTNode, callee: ASTNode, className: string];

/**
 * Mutable traversal state shared with the rule's matcher state.
 */
export interface YieldableErrorScanState {
  eligibleClasses: ReadonlySet<string>;
  indexedYields: WeakMap<object, ASTNode>;
  pendingYields: PendingYield[];
  scannedHostCallbacks: WeakSet<object>;
  unsafeClasses: Set<string>;
  visitorKeys?: VisitorKeys;
}

interface ScanCallbacks<State extends YieldableErrorScanState> {
  hostGenerator: (node: ASTNode, state: State) => ASTNode | undefined;
  mutationName: (node: ASTNode) => string | undefined;
  pendingYield: (node: ASTNode, scopes: ScopeStack, state: State) => PendingYield | undefined;
}

type ScanFrame = readonly [node: ASTNode, scopes: ScopeStack, canIndexYields: boolean];

const isUnknownArray = (value: unknown): value is readonly unknown[] => Array.isArray(value);

const isFunction = (node: ASTNode): boolean =>
  node.type === 'ArrowFunctionExpression' ||
  node.type === 'FunctionDeclaration' ||
  node.type === 'FunctionExpression';

const childScopesFor = (scopes: ScopeStack, node: ASTNode, key: string): ScopeStack => {
  if (
    (key === 'body' && isFunction(node)) ||
    (key === 'cases' && node.type === 'SwitchStatement')
  ) {
    return scopesForChild(scopes, node, key);
  }
  return scopes;
};

const pushScanValue = (
  value: unknown,
  scopes: ScopeStack,
  canIndexYields: boolean,
  pending: ScanFrame[],
): void => {
  if (isUnknownArray(value)) {
    for (let index = value.length - 1; index >= 0; index -= 1) {
      const child = asNode(value[index]);
      if (child) {
        pending.push([child, scopes, canIndexYields]);
      }
    }
    return;
  }
  const child = asNode(value);
  if (child) {
    pending.push([child, scopes, canIndexYields]);
  }
};

const pushKeyChildren = (
  node: ASTNode,
  scopes: ScopeStack,
  keys: readonly string[],
  canIndexYields: boolean,
  pending: ScanFrame[],
): void => {
  for (let index = keys.length - 1; index >= 0; index -= 1) {
    const key = keys[index];
    if (key) {
      pushScanValue(
        Reflect.get(node, key),
        childScopesFor(scopes, node, key),
        canIndexYields,
        pending,
      );
    }
  }
};

const pushReflectedChildren = (
  node: ASTNode,
  scopes: ScopeStack,
  canIndexYields: boolean,
  pending: ScanFrame[],
): void => {
  const entries = Object.entries(node);
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry && entry[0] !== 'parent') {
      pushScanValue(entry[1], childScopesFor(scopes, node, entry[0]), canIndexYields, pending);
    }
  }
};

const pushScanChildren = (
  node: ASTNode,
  scopes: ScopeStack,
  state: YieldableErrorScanState,
  canIndexYields: boolean,
  pending: ScanFrame[],
): void => {
  const keys = state.visitorKeys?.[node.type];
  if (keys) {
    pushKeyChildren(node, scopes, keys, canIndexYields, pending);
    return;
  }
  pushReflectedChildren(node, scopes, canIndexYields, pending);
};

const hostGeneratorFrame = (
  generator: ASTNode,
  scopes: ScopeStack,
  state: YieldableErrorScanState,
): ScanFrame | undefined => {
  if (state.scannedHostCallbacks.has(generator)) {
    return undefined;
  }
  state.scannedHostCallbacks.add(generator);
  const body = childNode(generator, 'body');
  if (!body) {
    return undefined;
  }
  const generatorScopes = withNodeScope(scopes, generator);
  const bodyScopes = scopesForChild(generatorScopes, generator, 'body');
  return [body, bodyScopes, true];
};

const hostBodyFrame = <State extends YieldableErrorScanState>(
  node: ASTNode,
  scopes: ScopeStack,
  state: State,
  callbacks: ScanCallbacks<State>,
): ScanFrame | undefined => {
  if (node.type !== 'CallExpression') {
    return undefined;
  }
  const generator = callbacks.hostGenerator(node, state);
  if (!generator) {
    return undefined;
  }
  return hostGeneratorFrame(generator, scopes, state);
};

const recordMutation = (
  node: ASTNode,
  state: YieldableErrorScanState,
  mutationName: (node: ASTNode) => string | undefined,
): void => {
  const name = mutationName(node);
  if (name && state.eligibleClasses.has(name)) {
    state.unsafeClasses.add(name);
  }
};

const recordYield = <State extends YieldableErrorScanState>(
  node: ASTNode,
  scopes: ScopeStack,
  state: State,
  canIndexYields: boolean,
  pendingYield: (node: ASTNode, scopes: ScopeStack, state: State) => PendingYield | undefined,
): void => {
  if (!canIndexYields || node.type !== 'YieldExpression') {
    return;
  }
  const candidate = pendingYield(node, scopes, state);
  if (candidate) {
    state.pendingYields.push(candidate);
  }
};

const scanNodeScopes = (scopes: ScopeStack, node: ASTNode): ScopeStack => {
  if (node.type === 'Program') {
    return scopes;
  }
  return withNodeScope(scopes, node);
};

const scanFrame = <State extends YieldableErrorScanState>(
  frame: ScanFrame,
  state: State,
  pending: ScanFrame[],
  callbacks: ScanCallbacks<State>,
): void => {
  const [node, scopes, canIndexYields] = frame;
  recordMutation(node, state, callbacks.mutationName);
  recordYield(node, scopes, state, canIndexYields, callbacks.pendingYield);
  const hostFrame = hostBodyFrame(node, scopes, state, callbacks);
  pushScanChildren(
    node,
    scanNodeScopes(scopes, node),
    state,
    canIndexYields && !isFunction(node),
    pending,
  );
  if (hostFrame) {
    pending.push(hostFrame);
  }
};

/**
 * Traverse the program without recursion and retain valid delegated failures.
 */
export const scanYieldableErrorAST = <State extends YieldableErrorScanState>(
  node: ASTNode,
  state: State,
  callbacks: ScanCallbacks<State>,
): void => {
  const pending: ScanFrame[] = [[node, [], false]];
  while (pending.length > 0) {
    const frame = pending.pop();
    if (frame) {
      scanFrame(frame, state, pending, callbacks);
    }
  }
};

/**
 * Finalize retained failures after all top-level class mutations are known.
 */
export const indexPendingYields = (state: YieldableErrorScanState): void => {
  const { pendingYields } = state;
  for (const [yieldExpression, callee, className] of pendingYields) {
    if (!state.unsafeClasses.has(className)) {
      state.indexedYields.set(yieldExpression, callee);
    }
  }
  pendingYields.length = 0;
};
