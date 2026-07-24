/* -------------------------------------------------------------------------- */
/*        Statement flow for the Effect runtime abstract interpreter.         */
/* -------------------------------------------------------------------------- */

import {
  RUNTIME_BREAK,
  RUNTIME_CONTINUE,
  RUNTIME_NORMAL,
  RUNTIME_RETURN,
  RUNTIME_THROW,
  unknownRuntimeValue,
} from './effect-promise-runtime-model';
import type {
  RuntimeExecutionContext,
  RuntimeResult,
  RuntimeScope,
  RuntimeStatementHost,
  RuntimeValue,
} from './effect-promise-runtime-model';
import { asNode, childNode, childNodes, identifierName } from './effect-ast';
import {
  bindCurrentRuntimePattern,
  predeclareRuntimePattern,
} from './effect-promise-runtime-control-patterns';
import type { ASTNode } from './effect-ast';
import type { HelperScopes } from './effect-promise-callable-types';
import { applyRuntimeScalarUpdate } from './effect-promise-runtime-control-scalars';
import { containerHelperScopes } from './effect-promise-callables';
import { continueRuntimeResult } from './effect-promise-runtime-control-completions';
import { executeRuntimeControlStatement } from './effect-promise-runtime-control-flow';
import { unwrappedExpression } from './effect-boundary-ast-shared';

const NORMAL_RESULT: RuntimeResult = { completion: RUNTIME_NORMAL, value: undefined };

const nodeOffset = (node: ASTNode): number => {
  const start: unknown = Reflect.get(node, 'start');
  if (typeof start === 'number') {
    return start;
  }
  return -1;
};

const captureCallableChild = (
  host: RuntimeStatementHost,
  value: unknown,
  scopes: readonly RuntimeScope[],
): void => {
  if (Array.isArray(value)) {
    captureCallableArray(host, value, scopes);
    return;
  }
  const child = asNode(value);
  if (!child) {
    return;
  }
  if (isRuntimeFunction(child)) {
    host.captures.set(child, scopes);
    return;
  }
  captureCallableChildren(host, child, scopes);
};

const captureCallableArray = (
  host: RuntimeStatementHost,
  values: readonly unknown[],
  scopes: readonly RuntimeScope[],
): void => {
  for (const value of values) {
    captureCallableChild(host, value, scopes);
  }
};

const isRuntimeFunction = (node: ASTNode): boolean =>
  node.type === 'ArrowFunctionExpression' || node.type === 'FunctionExpression';

const captureCallableChildren = (
  host: RuntimeStatementHost,
  node: ASTNode,
  scopes: readonly RuntimeScope[],
): void => {
  for (const key of host.input.visitorKeys?.[node.type] ?? Object.keys(node)) {
    captureCallableChild(host, Reflect.get(node, key), scopes);
  }
};

const captureInitializer = (
  host: RuntimeStatementHost,
  initializer: ASTNode | undefined,
  scopes: readonly RuntimeScope[],
): void => {
  const expression = unwrappedExpression(initializer);
  if (!expression) {
    return;
  }
  if (isRuntimeFunction(expression)) {
    host.captures.set(expression, scopes);
    return;
  }
  if (expression.type === 'ObjectExpression' || expression.type === 'ClassExpression') {
    captureCallableChildren(host, expression, scopes);
  }
};

const declarationValue = (
  host: RuntimeStatementHost,
  initializer: ASTNode | undefined,
  context: RuntimeExecutionContext,
): RuntimeResult => {
  const expression = unwrappedExpression(initializer);
  if (expression?.type === 'ArrayExpression' || expression?.type === 'ObjectExpression') {
    return host.visit(expression, context);
  }
  if (initializer) {
    return host.visit(initializer, context);
  }
  return NORMAL_RESULT;
};

const recordTaskSite = (
  host: RuntimeStatementHost,
  value: RuntimeValue,
  helperScopes: HelperScopes,
): void => {
  if (value && typeof value !== 'symbol' && 'kind' in value && value.kind === 'task') {
    host.sites.push({ helperScopes, syncCall: value.syncCall });
  }
};

const finishDeclarator = (
  host: RuntimeStatementHost,
  declarator: ASTNode,
  initializer: ASTNode | undefined,
  result: RuntimeResult,
  context: RuntimeExecutionContext,
): RuntimeResult => {
  const value = declaredRuntimeValue(initializer, result.value);
  const binding = bindCurrentRuntimePattern(host, childNode(declarator, 'id'), value, context);
  if (binding.completion !== RUNTIME_NORMAL) {
    return binding;
  }
  captureInitializer(host, initializer, context.taskScopes);
  recordTaskSite(host, result.value, context.helperScopes);
  return NORMAL_RESULT;
};

const executeDeclarator = (
  host: RuntimeStatementHost,
  declarator: ASTNode,
  context: RuntimeExecutionContext,
): RuntimeResult => {
  const initializer = childNode(declarator, 'init');
  const result = declarationValue(host, initializer, context);
  if (result.completion !== RUNTIME_NORMAL) {
    return result;
  }
  return finishDeclarator(host, declarator, initializer, result, context);
};

const declaredRuntimeValue = (
  initializer: ASTNode | undefined,
  value: RuntimeValue,
): RuntimeValue => {
  if (initializer) {
    return value;
  }
  return unknownRuntimeValue;
};

const variableDeclaration = (
  host: RuntimeStatementHost,
  node: ASTNode,
  context: RuntimeExecutionContext,
): RuntimeResult => {
  for (const declarator of childNodes(node, 'declarations')) {
    const result = executeDeclarator(host, declarator, context);
    if (result.completion !== RUNTIME_NORMAL) {
      return result;
    }
  }
  return NORMAL_RESULT;
};

const abruptStatement = (
  host: RuntimeStatementHost,
  node: ASTNode,
  context: RuntimeExecutionContext,
): RuntimeResult | undefined => {
  if (node.type === 'ReturnStatement') {
    return returnStatement(host, node, context);
  }
  if (node.type === 'ThrowStatement') {
    return throwStatement(host, node, context);
  }
  if (node.type === 'BreakStatement') {
    return targetedCompletion(RUNTIME_BREAK, node);
  }
  if (node.type === 'ContinueStatement') {
    return targetedCompletion(RUNTIME_CONTINUE, node);
  }
  return undefined;
};

const targetedCompletion = (
  completion: typeof RUNTIME_BREAK | typeof RUNTIME_CONTINUE,
  node: ASTNode,
): RuntimeResult => ({
  completion,
  target: identifierName(childNode(node, 'label')),
  value: undefined,
});

const returnStatement = (
  host: RuntimeStatementHost,
  node: ASTNode,
  context: RuntimeExecutionContext,
): RuntimeResult => {
  const result = host.optionalChild(node, 'argument', context);
  if (result.completion === RUNTIME_NORMAL) {
    return { completion: RUNTIME_RETURN, value: result.value };
  }
  return result;
};

const throwStatement = (
  host: RuntimeStatementHost,
  node: ASTNode,
  context: RuntimeExecutionContext,
): RuntimeResult => {
  const result = host.optionalChild(node, 'argument', context);
  if (result.completion === RUNTIME_NORMAL) {
    return { completion: RUNTIME_THROW, value: result.value };
  }
  return result;
};

const declarationStatement = (
  host: RuntimeStatementHost,
  node: ASTNode,
  context: RuntimeExecutionContext,
): RuntimeResult | undefined => {
  if (node.type === 'FunctionDeclaration') {
    return NORMAL_RESULT;
  }
  if (node.type === 'VariableDeclaration') {
    return variableDeclaration(host, node, context);
  }
  if (node.type === 'ClassDeclaration') {
    captureCallableChildren(host, node, context.taskScopes);
    return NORMAL_RESULT;
  }
  return undefined;
};

/**
 * Execute one runtime statement with exact abrupt completion.
 *
 * @internal
 */
export const executeRuntimeStatement = (
  host: RuntimeStatementHost,
  node: ASTNode,
  context: RuntimeExecutionContext,
): RuntimeResult => {
  const control = executeRuntimeControlStatement(host, node, context);
  if (control) {
    return control;
  }
  const declaration = declarationStatement(host, node, context);
  if (declaration) {
    return declaration;
  }
  if (node.type === 'BlockStatement') {
    return executeRuntimeContainer(host, node, context);
  }
  return abruptStatement(host, node, context) ?? host.visit(node, context);
};

const predeclareVariables = (statements: readonly ASTNode[], scope: RuntimeScope): void => {
  for (const statement of statements) {
    predeclareStatement(statement, scope);
  }
};

const predeclareStatement = (statement: ASTNode, scope: RuntimeScope): void => {
  if (statement.type !== 'VariableDeclaration') {
    return;
  }
  let initial: RuntimeValue = unknownRuntimeValue;
  if (Reflect.get(statement, 'kind') === 'var') {
    initial = undefined;
  }
  for (const declarator of childNodes(statement, 'declarations')) {
    predeclareRuntimePattern(childNode(declarator, 'id'), initial, scope);
  }
};

const captureFunctionDeclarations = (
  host: RuntimeStatementHost,
  statements: readonly ASTNode[],
  scopes: readonly RuntimeScope[],
): void => {
  for (const statement of statements) {
    if (statement.type === 'FunctionDeclaration') {
      host.captures.set(statement, scopes);
    }
  }
};

const updateRuntimeOffsets = (statement: ASTNode, context: RuntimeExecutionContext): void => {
  const offset = nodeOffset(statement);
  for (const runtimeScope of context.runtimeScopes) {
    context.offsets.set(runtimeScope, offset);
  }
};

const executeStatementsFrom = (
  host: RuntimeStatementHost,
  statements: readonly ASTNode[],
  context: RuntimeExecutionContext,
  index: number,
): RuntimeResult => {
  const statement = statements[index];
  if (!statement) {
    return NORMAL_RESULT;
  }
  updateRuntimeOffsets(statement, context);
  const result = executeRuntimeStatement(host, statement, context);
  if (result.completion === RUNTIME_NORMAL && !result.outcomes) {
    applyRuntimeScalarUpdate(host, statement, context);
    return executeStatementsFrom(host, statements, context, index + 1);
  }
  return continueRuntimeResult(
    host,
    result,
    context,
    (): RuntimeResult => executeStatementsFrom(host, statements, context, index + 1),
  );
};

const executeStatements = (
  host: RuntimeStatementHost,
  statements: readonly ASTNode[],
  context: RuntimeExecutionContext,
): RuntimeResult => executeStatementsFrom(host, statements, context, 0);

const hasRuntimeDeclarations = (statements: readonly ASTNode[]): boolean =>
  statements.some((statement): boolean => statement.type === 'VariableDeclaration');

const containerTaskScopes = (
  host: RuntimeStatementHost,
  statements: readonly ASTNode[],
  inherited: RuntimeExecutionContext,
  helperScopes: HelperScopes,
): readonly RuntimeScope[] => {
  if (
    helperScopes.length === inherited.helperScopes.length &&
    !hasRuntimeDeclarations(statements)
  ) {
    return inherited.taskScopes;
  }
  const helperScope = helperScopes[helperScopes.length - 1] ?? new Map();
  const scope: RuntimeScope = { helperScope, values: new Map() };
  host.state.scopes.add(scope);
  predeclareVariables(statements, scope);
  return [...inherited.taskScopes, scope];
};

/**
 * Execute a statement container with declaration-scope callable capture.
 *
 * @internal
 */
export const executeRuntimeContainer = (
  host: RuntimeStatementHost,
  node: ASTNode,
  inherited: RuntimeExecutionContext,
): RuntimeResult => {
  const statements = childNodes(node, 'body');
  const helperScopes = containerHelperScopes(node, [], inherited.helperScopes);
  const taskScopes = containerTaskScopes(host, statements, inherited, helperScopes);
  captureFunctionDeclarations(host, statements, taskScopes);
  const context: RuntimeExecutionContext = {
    helperScopes,
    offsets: new Map(inherited.offsets),
    runtimeScopes: [
      ...inherited.runtimeScopes,
      ...helperScopes.slice(inherited.helperScopes.length),
    ],
    taskScopes,
    thisValue: inherited.thisValue,
  };
  return executeStatements(host, statements, context);
};
