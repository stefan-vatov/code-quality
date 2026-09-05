import { scopesForChild, withNodeScope } from './effect-ast-scope';
import type { ASTNode, ASTValue } from './effect-ast';
import type { ScopeStack } from './effect-ast-scope';
import { asNode } from './effect-ast';

type FallbackWorkItem =
  | { kind: 'visit'; scopes: ScopeStack; value: ASTValue }
  | { kind: 'leave-node'; node: ASTNode }
  | { kind: 'leave-array'; value: readonly ASTValue[] };

interface FallbackTraversal {
  activeArrays: WeakSet<object>;
  activeNodes: WeakSet<object>;
  pending: FallbackWorkItem[];
  visit: (node: ASTNode, scopes: ScopeStack) => boolean;
  visitorKeys?: Readonly<Record<string, readonly string[]>>;
}

const pushFallbackArray = (
  value: readonly ASTValue[],
  scopes: ScopeStack,
  pending: FallbackWorkItem[],
): void => {
  pending.push({ kind: 'leave-array', value });
  for (let index = value.length - 1; index >= 0; index -= 1) {
    pending.push({ kind: 'visit', scopes, value: value[index] });
  }
};

const pushFallbackKeyChildren = (
  node: ASTNode,
  nodeScopes: ScopeStack,
  keys: readonly string[],
  pending: FallbackWorkItem[],
): void => {
  for (let index = keys.length - 1; index >= 0; index -= 1) {
    const key = keys[index];
    if (key !== undefined) {
      pending.push({
        kind: 'visit',
        scopes: scopesForChild(nodeScopes, node, key),
        value: node[key],
      });
    }
  }
};

const pushFallbackReflectedChildren = (
  node: ASTNode,
  nodeScopes: ScopeStack,
  pending: FallbackWorkItem[],
): void => {
  const entries = Object.entries(node);
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry && entry[0] !== 'parent') {
      pending.push({
        kind: 'visit',
        scopes: scopesForChild(nodeScopes, node, entry[0]),
        value: entry[1],
      });
    }
  }
};

const pushFallbackNodeChildren = (
  node: ASTNode,
  nodeScopes: ScopeStack,
  pending: FallbackWorkItem[],
  visitorKeys?: Readonly<Record<string, readonly string[]>>,
): void => {
  pending.push({ kind: 'leave-node', node });
  const keys = visitorKeys?.[node.type];
  if (keys) {
    pushFallbackKeyChildren(node, nodeScopes, keys, pending);
    return;
  }
  pushFallbackReflectedChildren(node, nodeScopes, pending);
};

const visitFallbackArray = (
  value: readonly ASTValue[],
  scopes: ScopeStack,
  traversal: FallbackTraversal,
): void => {
  if (traversal.activeArrays.has(value)) {
    return;
  }
  traversal.activeArrays.add(value);
  pushFallbackArray(value, scopes, traversal.pending);
};

const visitFallbackNode = (
  value: ASTValue,
  scopes: ScopeStack,
  traversal: FallbackTraversal,
): void => {
  const node = asNode(value);
  if (!node || traversal.activeNodes.has(node)) {
    return;
  }
  traversal.activeNodes.add(node);
  const nodeScopes = withNodeScope(scopes, node);
  if (!traversal.visit(node, nodeScopes)) {
    traversal.activeNodes.delete(node);
    return;
  }
  pushFallbackNodeChildren(node, nodeScopes, traversal.pending, traversal.visitorKeys);
};

const visitFallbackWorkItem = (item: FallbackWorkItem, traversal: FallbackTraversal): void => {
  if (item.kind === 'leave-node') {
    traversal.activeNodes.delete(item.node);
  } else if (item.kind === 'leave-array') {
    traversal.activeArrays.delete(item.value);
  } else if (Array.isArray(item.value)) {
    visitFallbackArray(item.value, item.scopes, traversal);
  } else {
    visitFallbackNode(item.value, item.scopes, traversal);
  }
};

export const visitFallbackTree = (
  node: ASTNode,
  scopes: ScopeStack,
  visit: (node: ASTNode, scopes: ScopeStack) => boolean,
  visitorKeys?: Readonly<Record<string, readonly string[]>>,
): void => {
  const traversal: FallbackTraversal = {
    activeArrays: new WeakSet(),
    activeNodes: new WeakSet(),
    pending: [{ kind: 'visit', scopes, value: node }],
    visit,
    visitorKeys,
  };
  while (traversal.pending.length > 0) {
    const item = traversal.pending.pop();
    if (item) {
      visitFallbackWorkItem(item, traversal);
    }
  }
};
