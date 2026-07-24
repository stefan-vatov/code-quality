/* -------------------------------------------------------------------------- */
/*      Lexical binding analysis shared by AST-backed Effect lint rules.      */
/* -------------------------------------------------------------------------- */

import { asNode, childNode, childNodes, identifierName } from './effect-ast';
import type { ASTNode } from './effect-ast';

export type { ASTNode } from './effect-ast';
export type ScopeStack = readonly ReadonlySet<string>[];

const addWrappedPatternBindings = (bindings: Set<string>, pattern: ASTNode): boolean => {
  if (pattern.type === 'AssignmentPattern') {
    addPatternBindings(bindings, childNode(pattern, 'left'));
    return true;
  }
  if (pattern.type === 'RestElement') {
    addPatternBindings(bindings, childNode(pattern, 'argument'));
    return true;
  }
  if (pattern.type === 'TSParameterProperty') {
    addPatternBindings(bindings, childNode(pattern, 'parameter'));
    return true;
  }
  return false;
};

const addDestructuredPatternBindings = (bindings: Set<string>, pattern: ASTNode): void => {
  let key = 'elements';
  if (pattern.type === 'ObjectPattern') {
    key = 'properties';
  }
  for (const property of childNodes(pattern, key)) {
    if (property.type === 'Property') {
      addPatternBindings(bindings, childNode(property, 'value'));
    } else {
      addPatternBindings(bindings, property);
    }
  }
};

const addPatternBindings = (bindings: Set<string>, pattern: ASTNode | undefined): void => {
  if (!pattern) {
    return;
  }
  const name = identifierName(pattern);
  if (name) {
    bindings.add(name);
    return;
  }
  if (addWrappedPatternBindings(bindings, pattern)) {
    return;
  }
  addDestructuredPatternBindings(bindings, pattern);
};

const declarationNode = (statement: ASTNode): ASTNode => {
  if (
    statement.type === 'ExportNamedDeclaration' ||
    statement.type === 'ExportDefaultDeclaration'
  ) {
    return childNode(statement, 'declaration') ?? statement;
  }
  return statement;
};

const addVariableBindings = (bindings: Set<string>, declaration: ASTNode): void => {
  for (const declarator of childNodes(declaration, 'declarations')) {
    addPatternBindings(bindings, childNode(declarator, 'id'));
  }
};

const namespaceRoot = (name: ASTNode | undefined): ASTNode | undefined => {
  if (name?.type === 'TSQualifiedName') {
    return namespaceRoot(childNode(name, 'left'));
  }
  return name;
};

const addNamespacePathBindings = (bindings: Set<string>, name: ASTNode | undefined): void => {
  if (name?.type === 'TSQualifiedName') {
    addNamespacePathBindings(bindings, childNode(name, 'left'));
    addNamespacePathBindings(bindings, childNode(name, 'right'));
    return;
  }
  addPatternBindings(bindings, name);
};

const addLexicalVariableBindings = (bindings: Set<string>, declaration: ASTNode): boolean => {
  if (declaration.type !== 'VariableDeclaration') {
    return false;
  }
  if (Reflect.get(declaration, 'kind') !== 'var') {
    addVariableBindings(bindings, declaration);
  }
  return true;
};

const addTypeScriptLexicalBindings = (bindings: Set<string>, declaration: ASTNode): boolean => {
  if (declaration.type === 'TSImportEqualsDeclaration') {
    if (Reflect.get(declaration, 'importKind') !== 'type') {
      addPatternBindings(bindings, childNode(declaration, 'id'));
    }
    return true;
  }
  if (declaration.type === 'TSModuleDeclaration') {
    addPatternBindings(bindings, namespaceRoot(childNode(declaration, 'id')));
    return true;
  }
  return false;
};

const addLexicalDeclarationBindings = (bindings: Set<string>, statement: ASTNode): void => {
  const declaration = declarationNode(statement);
  if (addLexicalVariableBindings(bindings, declaration)) {
    return;
  }
  if (addTypeScriptLexicalBindings(bindings, declaration)) {
    return;
  }
  if (
    declaration.type === 'ClassDeclaration' ||
    declaration.type === 'FunctionDeclaration' ||
    declaration.type === 'TSEnumDeclaration'
  ) {
    addPatternBindings(bindings, childNode(declaration, 'id'));
  }
};

const addDirectLexicalBindings = (bindings: Set<string>, statements: readonly ASTNode[]): void => {
  for (const statement of statements) {
    addLexicalDeclarationBindings(bindings, statement);
  }
};

const functionNodeTypes: ReadonlySet<unknown> = new Set([
  'ArrowFunctionExpression',
  'FunctionDeclaration',
  'FunctionExpression',
]);

const isFunctionNode = (node: ASTNode): boolean => functionNodeTypes.has(node.type);

const bindingNodeTypes: ReadonlySet<unknown> = new Set([
  ...functionNodeTypes,
  'BlockStatement',
  'CatchClause',
  'ClassExpression',
  'ForInStatement',
  'ForOfStatement',
  'ForStatement',
  'Program',
  'StaticBlock',
  'TSModuleBlock',
  'TSModuleDeclaration',
]);

const canIntroduceBindings = (node: ASTNode): boolean => bindingNodeTypes.has(node.type);

const isClassNode = (node: ASTNode): boolean =>
  node.type === 'ClassDeclaration' || node.type === 'ClassExpression';

const isVarTraversalBoundary = (node: ASTNode): boolean =>
  isFunctionNode(node) ||
  isClassNode(node) ||
  node.type === 'StaticBlock' ||
  node.type === 'TSModuleBlock' ||
  node.type === 'TSModuleDeclaration';

const addVarDeclarationBindings = (bindings: Set<string>, node: ASTNode): void => {
  if (node.type === 'VariableDeclaration' && Reflect.get(node, 'kind') === 'var') {
    addVariableBindings(bindings, node);
  }
};

const addHoistedVarValues = (
  bindings: Set<string>,
  values: readonly unknown[],
  seen: WeakSet<object>,
): void => {
  for (const value of values) {
    addHoistedVarBindings(bindings, value, seen);
  }
};

const addHoistedVarNode = (bindings: Set<string>, node: ASTNode, seen: WeakSet<object>): void => {
  seen.add(node);
  if (isVarTraversalBoundary(node)) {
    return;
  }
  addVarDeclarationBindings(bindings, node);
  for (const [key, value] of Object.entries(node)) {
    if (key !== 'parent') {
      addHoistedVarBindings(bindings, value, seen);
    }
  }
};

const addHoistedVarBindings = (
  bindings: Set<string>,
  value: unknown,
  seen: WeakSet<object>,
): void => {
  if (Array.isArray(value)) {
    addHoistedVarValues(bindings, value, seen);
    return;
  }
  const node = asNode(value);
  if (!node || seen.has(node)) {
    return;
  }
  addHoistedVarNode(bindings, node, seen);
};

const addHoistedVarsFromChildren = (bindings: Set<string>, node: ASTNode): void => {
  const seen = new WeakSet();
  for (const [key, value] of Object.entries(node)) {
    if (key !== 'parent') {
      addHoistedVarBindings(bindings, value, seen);
    }
  }
};

const addLoopBindings = (bindings: Set<string>, declaration: ASTNode | undefined): void => {
  if (declaration?.type === 'VariableDeclaration' && Reflect.get(declaration, 'kind') !== 'var') {
    addVariableBindings(bindings, declaration);
  }
};

const addSwitchBindings = (bindings: Set<string>, node: ASTNode): void => {
  for (const switchCase of childNodes(node, 'cases')) {
    addDirectLexicalBindings(bindings, childNodes(switchCase, 'consequent'));
  }
};

const addFunctionHeaderBindings = (bindings: Set<string>, node: ASTNode): void => {
  addPatternBindings(bindings, childNode(node, 'id'));
  for (const parameter of childNodes(node, 'params')) {
    addPatternBindings(bindings, parameter);
  }
};

const addFunctionBodyVarBindings = (bindings: Set<string>, node: ASTNode): void => {
  const body = childNode(node, 'body');
  if (body) {
    addHoistedVarsFromChildren(bindings, body);
  }
};

const addContainerBindings = (bindings: Set<string>, node: ASTNode): void => {
  if (node.type === 'Program' || node.type === 'StaticBlock' || node.type === 'TSModuleBlock') {
    addDirectLexicalBindings(bindings, childNodes(node, 'body'));
    addHoistedVarsFromChildren(bindings, node);
  } else if (isFunctionNode(node)) {
    addFunctionHeaderBindings(bindings, node);
  } else if (node.type === 'BlockStatement') {
    addDirectLexicalBindings(bindings, childNodes(node, 'body'));
  }
};

const addControlFlowBindings = (bindings: Set<string>, node: ASTNode): void => {
  if (node.type === 'ForStatement') {
    addLoopBindings(bindings, childNode(node, 'init'));
  } else if (node.type === 'ForInStatement' || node.type === 'ForOfStatement') {
    addLoopBindings(bindings, childNode(node, 'left'));
  }
};

const addNamedBindings = (bindings: Set<string>, node: ASTNode): void => {
  if (node.type === 'CatchClause') {
    addPatternBindings(bindings, childNode(node, 'param'));
  } else if (node.type === 'ClassExpression') {
    addPatternBindings(bindings, childNode(node, 'id'));
  } else if (node.type === 'TSModuleDeclaration') {
    addNamespacePathBindings(bindings, childNode(node, 'id'));
  }
};

const nodeBindings = (node: ASTNode): Set<string> => {
  const bindings = new Set<string>();
  addContainerBindings(bindings, node);
  addControlFlowBindings(bindings, node);
  addNamedBindings(bindings, node);
  return bindings;
};

const extendScopes = (scopes: ScopeStack, bindings: ReadonlySet<string>): ScopeStack => {
  if (bindings.size === 0) {
    return scopes;
  }
  return [...scopes, bindings];
};

/**
 * Extend an AST traversal scope stack with bindings introduced by a node.
 *
 * @param scopes - Lexical scopes inherited from the node's ancestors.
 * @param node - The node whose lexical and hoisted bindings should be collected.
 * @returns The inherited stack or a stack extended with the node's bindings.
 * @throws Does not throw.
 * @internal
 */
export const withNodeScope = (scopes: ScopeStack, node: ASTNode): ScopeStack => {
  if (!canIntroduceBindings(node)) {
    return scopes;
  }
  return extendScopes(scopes, nodeBindings(node));
};

/**
 * Select the lexical scopes visible while traversing one child edge.
 *
 * @param nodeScopes - Scopes visible in the parent node's ordinary children.
 * @param parent - The parent AST node.
 * @param childKey - The parent property containing the child.
 * @returns The scope stack that is semantically visible along the child edge.
 * @throws Does not throw.
 * @internal
 */
export const scopesForChild = (
  nodeScopes: ScopeStack,
  parent: ASTNode,
  childKey: string,
): ScopeStack => {
  if (isFunctionNode(parent) && childKey === 'body') {
    const bindings = new Set<string>();
    addFunctionBodyVarBindings(bindings, parent);
    return extendScopes(nodeScopes, bindings);
  }
  if (parent.type === 'SwitchStatement' && childKey === 'cases') {
    const bindings = new Set<string>();
    addSwitchBindings(bindings, parent);
    return extendScopes(nodeScopes, bindings);
  }
  return nodeScopes;
};
