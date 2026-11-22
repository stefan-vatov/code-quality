import { asNode, childNode, childNodes, identifierName, isASTArray } from './effect-ast';
import type { ASTNode, ASTValue } from './effect-ast';
import { scopeHasBinding, scopesForChild, withNodeScope } from './effect-ast-scope';
import type { ScopeStack } from './effect-ast-scope';

interface WorkItem {
  value: ASTValue;
  scopes: ScopeStack;
}

const cache = new WeakMap<ASTNode, WeakMap<ASTNode, ScopeStack>>();

const typeScopes = (node: ASTNode, scopes: ScopeStack): ScopeStack => {
  const parameters = childNode(node, 'typeParameters');
  if (!parameters) return scopes;
  const names = childNodes(parameters, 'params').map((parameter) =>
    identifierName(childNode(parameter, 'name')),
  );
  const bindings = new Set(names.filter((name): name is string => name !== undefined));
  return bindings.size === 0 ? scopes : [...scopes, bindings];
};

const indexNode = (
  node: ASTNode,
  scopes: ScopeStack,
  index: WeakMap<ASTNode, ScopeStack>,
  pending: WorkItem[],
): void => {
  const next = typeScopes(node, withNodeScope(scopes, node));
  index.set(node, next);
  for (const [key, value] of Object.entries(node)) {
    if (key !== 'parent') pending.push({ value, scopes: scopesForChild(next, node, key) });
  }
};

export const canonicalScopes = (root: ASTNode): WeakMap<ASTNode, ScopeStack> => {
  const cached = cache.get(root);
  if (cached) return cached;
  const index = new WeakMap<ASTNode, ScopeStack>();
  const pending: WorkItem[] = [{ value: root, scopes: [] }];
  const seen = new WeakSet();
  while (pending.length > 0) {
    const item = pending.pop();
    if (!item) continue;
    if (isASTArray(item.value)) {
      for (const value of item.value) pending.push({ value, scopes: item.scopes });
      continue;
    }
    const node = asNode(item.value);
    if (node && !seen.has(node)) {
      seen.add(node);
      indexNode(node, item.scopes, index, pending);
    }
  }
  cache.set(root, index);
  return index;
};

export const canonicalIsUnbound = (root: ASTNode, node: ASTNode, name: string): boolean =>
  !scopeHasBinding(name, canonicalScopes(root).get(node) ?? []);
