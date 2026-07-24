/* -------------------------------------------------------------------------- */
/*      Pattern helpers shared by runtime declarations and control flow.      */
/* -------------------------------------------------------------------------- */

import type {
  RuntimeExecutionContext,
  RuntimeResult,
  RuntimeScope,
  RuntimeStatementHost,
  RuntimeValue,
} from './effect-promise-runtime-model';
import { childNode, childNodes, identifierName } from './effect-ast';
import type { ASTNode } from './effect-ast';
import { RUNTIME_NORMAL } from './effect-promise-runtime-model';
import { bindRuntimePattern } from './effect-promise-runtime-patterns';

const nestedPattern = (pattern: ASTNode): ASTNode | undefined => {
  if (pattern.type === 'AssignmentPattern') {
    return childNode(pattern, 'left');
  }
  if (pattern.type === 'RestElement') {
    return childNode(pattern, 'argument');
  }
  if (pattern.type === 'TSParameterProperty') {
    return childNode(pattern, 'parameter');
  }
  return undefined;
};

const predeclareObject = (pattern: ASTNode, value: RuntimeValue, scope: RuntimeScope): void => {
  for (const property of childNodes(pattern, 'properties')) {
    let nested = childNode(property, 'value');
    if (property.type === 'RestElement') {
      nested = childNode(property, 'argument');
    }
    predeclareRuntimePattern(nested, value, scope);
  }
};

const predeclareArray = (pattern: ASTNode, value: RuntimeValue, scope: RuntimeScope): void => {
  for (const element of childNodes(pattern, 'elements')) {
    predeclareRuntimePattern(element, value, scope);
  }
};

const predeclareStructured = (pattern: ASTNode, value: RuntimeValue, scope: RuntimeScope): void => {
  if (pattern.type === 'ArrayPattern') {
    predeclareArray(pattern, value, scope);
  } else if (pattern.type === 'ObjectPattern') {
    predeclareObject(pattern, value, scope);
  }
};

const predeclareNamed = (pattern: ASTNode, value: RuntimeValue, scope: RuntimeScope): boolean => {
  const name = identifierName(pattern);
  if (!name) {
    return false;
  }
  scope.values.set(name, value);
  return true;
};

/**
 * Predeclare every identifier owned by one recursive binding pattern.
 *
 * @internal
 */
export const predeclareRuntimePattern = (
  pattern: ASTNode | undefined,
  value: RuntimeValue,
  scope: RuntimeScope,
): void => {
  if (!pattern) {
    return;
  }
  if (predeclareNamed(pattern, value, scope)) {
    return;
  }
  const nested = nestedPattern(pattern);
  if (nested) {
    predeclareRuntimePattern(nested, value, scope);
    return;
  }
  predeclareStructured(pattern, value, scope);
};

/**
 * Bind one recursive pattern into the current runtime lexical scope.
 *
 * @internal
 */
export const bindCurrentRuntimePattern = (
  host: RuntimeStatementHost,
  pattern: ASTNode | undefined,
  value: RuntimeValue,
  context: RuntimeExecutionContext,
): RuntimeResult => {
  const scope = context.taskScopes[context.taskScopes.length - 1];
  if (!scope) {
    return { completion: RUNTIME_NORMAL, value: undefined };
  }
  return bindRuntimePattern(pattern, value, {
    evaluate: (node): RuntimeResult => host.visit(node, context),
    scope,
    state: host.state,
  });
};
