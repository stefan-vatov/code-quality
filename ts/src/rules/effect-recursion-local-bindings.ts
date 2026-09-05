import { childNode, childNodes, identifierName } from './effect-ast';
import { isFunctionNode, unwrappedExpression } from './effect-boundary-ast-shared';
import type { ASTNode } from './effect-ast';

interface AliasBinding {
  kind: 'alias';
  name: string;
}

interface FunctionBinding {
  kind: 'function';
  node: ASTNode;
}

export type LocalBinding = AliasBinding | FunctionBinding;

export type LocalFunctionScopes = readonly ReadonlyMap<string, LocalBinding>[];

export interface LocalInvocationTarget {
  functionNode?: ASTNode;
  isSelfCall: boolean;
}

const addVariableBinding = (bindings: Map<string, LocalBinding>, declarator: ASTNode): void => {
  const name = identifierName(childNode(declarator, 'id'));
  const initializer = unwrappedExpression(childNode(declarator, 'init'));
  if (!name || !initializer) {
    return;
  }
  if (isFunctionNode(initializer)) {
    bindings.set(name, { kind: 'function', node: initializer });
    return;
  }
  const aliasName = identifierName(initializer);
  if (aliasName) {
    bindings.set(name, { kind: 'alias', name: aliasName });
  }
};

const addStatementBinding = (bindings: Map<string, LocalBinding>, statement: ASTNode): void => {
  if (statement.type === 'FunctionDeclaration') {
    const name = identifierName(childNode(statement, 'id'));
    if (name) {
      bindings.set(name, { kind: 'function', node: statement });
    }
    return;
  }
  if (statement.type === 'VariableDeclaration') {
    for (const declarator of childNodes(statement, 'declarations')) {
      addVariableBinding(bindings, declarator);
    }
  }
};

const localScopeFor = (
  node: ASTNode,
  cache: WeakMap<object, ReadonlyMap<string, LocalBinding>>,
): ReadonlyMap<string, LocalBinding> => {
  const cached = cache.get(node);
  if (cached) {
    return cached;
  }
  const bindings = new Map<string, LocalBinding>();
  if (node.type === 'BlockStatement' || node.type === 'Program') {
    for (const statement of childNodes(node, 'body')) {
      addStatementBinding(bindings, statement);
    }
  }
  cache.set(node, bindings);
  return bindings;
};

export const localScopesForNode = (
  node: ASTNode,
  current: LocalFunctionScopes,
  cache: WeakMap<object, ReadonlyMap<string, LocalBinding>>,
): LocalFunctionScopes => {
  if (node.type !== 'BlockStatement' && node.type !== 'Program') {
    return current;
  }
  const scope = localScopeFor(node, cache);
  if (scope.size === 0) {
    return current;
  }
  return [...current, scope];
};

const localBindingFor = (name: string, scopes: LocalFunctionScopes): LocalBinding | undefined => {
  for (let index = scopes.length - 1; index >= 0; index -= 1) {
    const binding = scopes[index]?.get(name);
    if (binding) {
      return binding;
    }
  }
  return undefined;
};

const targetWithoutBinding = (
  name: string,
  functionName: string,
): LocalInvocationTarget | undefined => {
  if (name === functionName) {
    return { isSelfCall: true };
  }
  return undefined;
};

const nextAliasName = (
  binding: LocalBinding,
  seenAliases: Set<LocalBinding>,
): string | undefined => {
  if (binding.kind !== 'alias' || seenAliases.has(binding)) {
    return undefined;
  }
  seenAliases.add(binding);
  return binding.name;
};

const resolveLocalTargetAt = (
  name: string,
  functionName: string,
  scopes: LocalFunctionScopes,
): LocalInvocationTarget | undefined => {
  let currentName: string | undefined = name;
  const seenAliases = new Set<LocalBinding>();

  while (currentName !== undefined) {
    const binding = localBindingFor(currentName, scopes);
    if (!binding) {
      return targetWithoutBinding(currentName, functionName);
    }
    if (binding.kind === 'function') {
      return { functionNode: binding.node, isSelfCall: false };
    }
    currentName = nextAliasName(binding, seenAliases);
  }
  return undefined;
};

export const resolveLocalTarget = (
  name: string,
  functionName: string,
  scopes: LocalFunctionScopes,
): LocalInvocationTarget | undefined => resolveLocalTargetAt(name, functionName, scopes);
