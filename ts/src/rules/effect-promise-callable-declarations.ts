/* -------------------------------------------------------------------------- */
/*            Callable declarations and aliases in lexical scopes.            */
/* -------------------------------------------------------------------------- */

import type { FunctionBinding, HelperScopes } from './effect-promise-callable-types';
import {
  bindingForFunction,
  copyObjectMembers,
  memberBindingKey,
  resolvedHelper,
} from './effect-promise-callable-lookup';
import { childNode, childNodes, identifierName } from './effect-ast';
import {
  lexicalValueAvailableAfter,
  registerLexicalValue,
  registerLexicalValueWrite,
} from './effect-promise-value-scopes';
import type { ASTNode } from './effect-ast';
import type { ScopeStack } from './effect-ast-scope';
import { addPatternNames } from './effect-promise-pattern-bindings';
import { declaredPromisePropertyName } from './effect-promise-ast-values';
import { unwrappedExpression } from './effect-boundary-ast-shared';

const isCallableFunction = (node: ASTNode | undefined): boolean =>
  node?.type === 'ArrowFunctionExpression' ||
  node?.type === 'FunctionDeclaration' ||
  node?.type === 'FunctionExpression';

interface PrimaryInitializerContext {
  allowEarlyReference: boolean;
  bindings: Map<string, FunctionBinding | undefined>;
  declarationKind: 'lexical' | 'var';
  declarator: ASTNode;
  helperScopes: HelperScopes;
  scopes: ScopeStack;
}

interface PrimaryBindingContext {
  allowEarlyReference: boolean;
  bindings: Map<string, FunctionBinding | undefined>;
  helperScopes: HelperScopes;
  scopes: ScopeStack;
}

const objectPropertyBinding = (
  property: ASTNode,
  scopes: ScopeStack,
  helperScopes: HelperScopes,
): FunctionBinding | undefined => {
  const value = unwrappedExpression(childNode(property, 'value'));
  if (value && isCallableFunction(value)) {
    return bindingForFunction(value, scopes, helperScopes);
  }
  return resolvedHelper(value, helperScopes);
};

const addObjectProperty = (
  bindings: Map<string, FunctionBinding | undefined>,
  objectName: string,
  property: ASTNode,
  scopes: ScopeStack,
  helperScopes: HelperScopes,
): void => {
  if (property.type !== 'Property') {
    return;
  }
  const propertyName = declaredPromisePropertyName(property);
  if (propertyName) {
    bindings.set(
      memberBindingKey(objectName, propertyName),
      objectPropertyBinding(property, scopes, helperScopes),
    );
  }
};

const addObjectMethods = (
  bindings: Map<string, FunctionBinding | undefined>,
  objectName: string,
  object: ASTNode,
  scopes: ScopeStack,
  helperScopes: HelperScopes,
): void => {
  for (const property of childNodes(object, 'properties')) {
    addObjectProperty(bindings, objectName, property, scopes, helperScopes);
  }
};

const addStaticClassMethod = (
  bindings: Map<string, FunctionBinding | undefined>,
  className: string,
  method: ASTNode,
  scopes: ScopeStack,
  helperScopes: HelperScopes,
): void => {
  if (Reflect.get(method, 'static') !== true) {
    return;
  }
  const methodName = declaredPromisePropertyName(method);
  const value = unwrappedExpression(childNode(method, 'value'));
  if (methodName && value && isCallableFunction(value)) {
    bindings.set(
      memberBindingKey(className, methodName),
      bindingForFunction(value, scopes, helperScopes),
    );
  }
};

const addClassMethods = (
  bindings: Map<string, FunctionBinding | undefined>,
  declaration: ASTNode,
  scopes: ScopeStack,
  helperScopes: HelperScopes,
): void => {
  const className = identifierName(childNode(declaration, 'id'));
  if (!className) {
    return;
  }
  bindings.set(className, undefined);
  const body = childNode(declaration, 'body');
  if (!body) {
    return;
  }
  for (const method of childNodes(body, 'body')) {
    addStaticClassMethod(bindings, className, method, scopes, helperScopes);
  }
};

const primaryVariableBinding = (
  declarator: ASTNode,
  declarationKind: 'lexical' | 'var',
  context: PrimaryBindingContext,
): void => {
  const pattern = childNode(declarator, 'id');
  const name = identifierName(pattern);
  if (!name) {
    addPatternNames(context.bindings, pattern);
    return;
  }
  const initializer = unwrappedExpression(childNode(declarator, 'init'));
  context.bindings.set(
    name,
    primaryInitializerBinding(name, initializer, {
      allowEarlyReference: context.allowEarlyReference,
      bindings: context.bindings,
      declarationKind,
      declarator,
      helperScopes: context.helperScopes,
      scopes: context.scopes,
    }),
  );
};

const isPromiseIdentityCall = (initializer: ASTNode | undefined): boolean => {
  if (initializer?.type !== 'CallExpression') {
    return false;
  }
  const callee = unwrappedExpression(childNode(initializer, 'callee'));
  return (
    callee?.type === 'MemberExpression' && identifierName(childNode(callee, 'object')) === 'Promise'
  );
};

const shouldRegisterLexicalValue = (initializer: ASTNode | undefined): boolean =>
  !initializer ||
  initializer.type === 'Identifier' ||
  initializer.type === 'ObjectExpression' ||
  (initializer.type === 'UnaryExpression' && Reflect.get(initializer, 'operator') === 'void') ||
  isPromiseIdentityCall(initializer);

const primaryInitializerBinding = (
  name: string,
  initializer: ASTNode | undefined,
  context: PrimaryInitializerContext,
): FunctionBinding | undefined => {
  if (initializer && isCallableFunction(initializer)) {
    return bindingForFunction(initializer, context.scopes, context.helperScopes);
  }
  if (shouldRegisterLexicalValue(initializer)) {
    registerLexicalValue(context.bindings, name, {
      allowEarlyReference: context.allowEarlyReference,
      availableAfter: lexicalValueAvailableAfter(context.declarator),
      declarationKind: context.declarationKind,
      helperScopes: context.helperScopes,
      node: initializer,
      scopes: context.scopes,
    });
  }
  return undefined;
};

const addPrimaryVariableBindings = (declaration: ASTNode, context: PrimaryBindingContext): void => {
  let declarationKind: 'lexical' | 'var' = 'lexical';
  if (Reflect.get(declaration, 'kind') === 'var') {
    declarationKind = 'var';
  }
  for (const declarator of childNodes(declaration, 'declarations')) {
    primaryVariableBinding(declarator, declarationKind, context);
  }
};

const addFunctionDeclaration = (
  bindings: Map<string, FunctionBinding | undefined>,
  statement: ASTNode,
  scopes: ScopeStack,
  helperScopes: HelperScopes,
): void => {
  const name = identifierName(childNode(statement, 'id'));
  if (name) {
    bindings.set(name, bindingForFunction(statement, scopes, helperScopes));
  }
};

const addPrimaryStatementBindings = (statement: ASTNode, context: PrimaryBindingContext): void => {
  if (statement.type === 'FunctionDeclaration') {
    addFunctionDeclaration(context.bindings, statement, context.scopes, context.helperScopes);
    return;
  }
  if (statement.type === 'VariableDeclaration') {
    addPrimaryVariableBindings(statement, context);
    return;
  }
  if (statement.type === 'ClassDeclaration') {
    addClassMethods(context.bindings, statement, context.scopes, context.helperScopes);
  }
};

const addLexicalWrite = (statement: ASTNode, context: PrimaryBindingContext): void => {
  const expression = unwrappedExpression(childNode(statement, 'expression'));
  if (expression?.type !== 'AssignmentExpression' || Reflect.get(expression, 'operator') !== '=') {
    return;
  }
  const name = identifierName(childNode(expression, 'left'));
  if (!name) {
    return;
  }
  registerLexicalValueWrite(context.helperScopes, name, {
    availableAfter: lexicalValueAvailableAfter(expression),
    helperScopes: context.helperScopes,
    node: unwrappedExpression(childNode(expression, 'right')),
    scopes: context.scopes,
  });
};

/**
 * Add primary callable declarations before linking aliases.
 *
 * @internal
 */
export const addPrimaryBindings = (
  bindings: Map<string, FunctionBinding | undefined>,
  statements: readonly ASTNode[],
  scopes: ScopeStack,
  helperScopes: HelperScopes,
  allowEarlyReference = false,
): void => {
  const context = {
    allowEarlyReference,
    bindings,
    helperScopes,
    scopes,
  };
  for (const statement of statements) {
    addPrimaryStatementBindings(statement, context);
  }
  for (const statement of statements) {
    addLexicalWrite(statement, context);
  }
};

const addVariableObjectMember = (
  bindings: Map<string, FunctionBinding | undefined>,
  declarator: ASTNode,
  scopes: ScopeStack,
  helperScopes: HelperScopes,
): void => {
  const objectName = identifierName(childNode(declarator, 'id'));
  const initializer = unwrappedExpression(childNode(declarator, 'init'));
  if (objectName && initializer?.type === 'ObjectExpression') {
    addObjectMethods(bindings, objectName, initializer, scopes, helperScopes);
  }
};

const addVariableObjectMembers = (
  bindings: Map<string, FunctionBinding | undefined>,
  declaration: ASTNode,
  scopes: ScopeStack,
  helperScopes: HelperScopes,
): void => {
  for (const declarator of childNodes(declaration, 'declarations')) {
    addVariableObjectMember(bindings, declarator, scopes, helperScopes);
  }
};

/**
 * Link object-member declarations after primary declarations are known.
 *
 * @internal
 */
export const addObjectBindings = (
  bindings: Map<string, FunctionBinding | undefined>,
  statements: readonly ASTNode[],
  scopes: ScopeStack,
  helperScopes: HelperScopes,
): void => {
  for (const statement of statements) {
    if (statement.type === 'VariableDeclaration') {
      addVariableObjectMembers(bindings, statement, scopes, helperScopes);
    }
  }
};

const aliasedMemberBinding = (
  sourceName: string,
  propertyName: string,
  helperScopes: HelperScopes,
): FunctionBinding | undefined =>
  resolvedHelper(
    {
      computed: false,
      object: { name: sourceName, type: 'Identifier' },
      property: { name: propertyName, type: 'Identifier' },
      type: 'MemberExpression',
    } as ASTNode,
    helperScopes,
  );

const addDestructuredAlias = (
  bindings: Map<string, FunctionBinding | undefined>,
  property: ASTNode,
  sourceName: string,
  helperScopes: HelperScopes,
): void => {
  if (property.type !== 'Property') {
    return;
  }
  const propertyName = declaredPromisePropertyName(property);
  const localName = identifierName(childNode(property, 'value'));
  if (propertyName && localName) {
    bindings.set(localName, aliasedMemberBinding(sourceName, propertyName, helperScopes));
  }
};

const addDestructuredAliases = (
  bindings: Map<string, FunctionBinding | undefined>,
  pattern: ASTNode,
  initializer: ASTNode,
  helperScopes: HelperScopes,
): void => {
  const sourceName = identifierName(initializer);
  if (pattern.type !== 'ObjectPattern' || !sourceName) {
    return;
  }
  for (const property of childNodes(pattern, 'properties')) {
    addDestructuredAlias(bindings, property, sourceName, helperScopes);
  }
};

const addNamedVariableAlias = (
  bindings: Map<string, FunctionBinding | undefined>,
  name: string,
  initializer: ASTNode,
  helperScopes: HelperScopes,
): void => {
  const binding = resolvedHelper(initializer, helperScopes);
  if (binding) {
    bindings.set(name, binding);
  }
  const sourceName = identifierName(initializer);
  if (sourceName) {
    copyObjectMembers(bindings, name, sourceName);
  }
};

const addVariableAlias = (
  bindings: Map<string, FunctionBinding | undefined>,
  declarator: ASTNode,
  helperScopes: HelperScopes,
): void => {
  const pattern = childNode(declarator, 'id');
  const initializer = unwrappedExpression(childNode(declarator, 'init'));
  if (!pattern || !initializer || isCallableFunction(initializer)) {
    return;
  }
  const name = identifierName(pattern);
  if (name) {
    addNamedVariableAlias(bindings, name, initializer, helperScopes);
    return;
  }
  addDestructuredAliases(bindings, pattern, initializer, helperScopes);
};

const addDeclarationAliases = (
  bindings: Map<string, FunctionBinding | undefined>,
  declaration: ASTNode,
  helperScopes: HelperScopes,
): void => {
  for (const declarator of childNodes(declaration, 'declarations')) {
    addVariableAlias(bindings, declarator, helperScopes);
  }
};

/**
 * Link variable and destructured aliases after member declarations are known.
 *
 * @internal
 */
export const addVariableAliases = (
  bindings: Map<string, FunctionBinding | undefined>,
  statements: readonly ASTNode[],
  helperScopes: HelperScopes,
): void => {
  for (const statement of statements) {
    if (statement.type === 'VariableDeclaration') {
      addDeclarationAliases(bindings, statement, helperScopes);
    }
  }
};
