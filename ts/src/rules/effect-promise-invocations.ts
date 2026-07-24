/* -------------------------------------------------------------------------- */
/*             Invocation shapes for Promise execution traversal.             */
/* -------------------------------------------------------------------------- */

import type {
  FunctionBinding,
  HelperScopes,
  Invocation,
  InvocationArguments,
} from './effect-promise-callable-types';
import { callableBinding, memberPropertyName } from './effect-promise-callable-lookup';
import type { ASTNode } from './effect-ast';
import type { ScopeStack } from './effect-ast-scope';
import { childNode } from './effect-ast';
import { rawPromiseNodes } from './effect-promise-ast-values';
import { unwrappedExpression } from './effect-boundary-ast-shared';

const appendArrayElement = (
  values: (ASTNode | undefined)[],
  element: ASTNode | undefined,
): boolean => {
  if (element?.type !== 'SpreadElement') {
    values.push(element);
    return true;
  }
  const spread = unwrappedExpression(childNode(element, 'argument'));
  if (spread?.type !== 'ArrayExpression') {
    return false;
  }
  const nested = flattenArray(spread);
  values.push(...nested.values);
  return nested.isExact;
};

const flattenArray = (array: ASTNode): InvocationArguments => {
  const values: (ASTNode | undefined)[] = [];
  for (const element of rawPromiseNodes(array, 'elements')) {
    if (!appendArrayElement(values, element)) {
      return { isExact: false, values };
    }
  }
  return { isExact: true, values };
};

/**
 * Flatten statically known call arguments until cardinality becomes unknown.
 *
 * @internal
 */
export const invocationArguments = (call: ASTNode, start = 0): InvocationArguments => {
  const values: (ASTNode | undefined)[] = [];
  const callArguments = rawPromiseNodes(call, 'arguments');
  for (let index = start; index < callArguments.length; index += 1) {
    if (!appendArrayElement(values, callArguments[index])) {
      return { isExact: false, values };
    }
  }
  return { isExact: true, values };
};

const applyArguments = (call: ASTNode): InvocationArguments => {
  const [, argumentArray] = rawPromiseNodes(call, 'arguments');
  if (argumentArray?.type === 'ArrayExpression') {
    return flattenArray(argumentArray);
  }
  return { isExact: false, values: [] };
};

const boundInvocation = (
  call: ASTNode,
  scopes: ScopeStack,
  helperScopes: HelperScopes,
): Invocation | undefined => {
  const callee = unwrappedExpression(childNode(call, 'callee'));
  if (!callee || memberPropertyName(callee) !== 'bind') {
    return undefined;
  }
  const binding = callableBinding(childNode(callee, 'object'), scopes, helperScopes);
  if (binding) {
    return { arguments: invocationArguments(call, 1), binding };
  }
  return undefined;
};

const combineBoundInvocation = (bound: Invocation, outer: InvocationArguments): Invocation => {
  if (!bound.arguments.isExact) {
    return bound;
  }
  return {
    arguments: {
      isExact: outer.isExact,
      values: [...bound.arguments.values, ...outer.values],
    },
    binding: bound.binding,
  };
};

const immediatelyBoundInvocation = (
  callee: ASTNode,
  call: ASTNode,
  scopes: ScopeStack,
  helperScopes: HelperScopes,
): Invocation | undefined => {
  if (callee.type !== 'CallExpression') {
    return undefined;
  }
  const bound = boundInvocation(callee, scopes, helperScopes);
  if (bound) {
    return combineBoundInvocation(bound, invocationArguments(call));
  }
  return undefined;
};

const methodArguments = (methodName: string, call: ASTNode): InvocationArguments => {
  if (methodName === 'apply') {
    return applyArguments(call);
  }
  return invocationArguments(call, 1);
};

const methodInvocation = (
  callee: ASTNode,
  call: ASTNode,
  scopes: ScopeStack,
  helperScopes: HelperScopes,
): Invocation | undefined => {
  const methodName = memberPropertyName(callee);
  if (methodName !== 'call' && methodName !== 'apply') {
    return undefined;
  }
  const binding = callableBinding(childNode(callee, 'object'), scopes, helperScopes);
  if (binding) {
    return { arguments: methodArguments(methodName, call), binding };
  }
  return undefined;
};

const directInvocation = (
  callee: ASTNode | undefined,
  call: ASTNode,
  scopes: ScopeStack,
  helperScopes: HelperScopes,
): Invocation | undefined => {
  const binding: FunctionBinding | undefined = callableBinding(callee, scopes, helperScopes);
  if (binding) {
    return { arguments: invocationArguments(call), binding };
  }
  return undefined;
};

/**
 * Resolve direct, call/apply, and immediately invoked bound functions.
 *
 * @internal
 */
export const invocationFor = (
  call: ASTNode,
  scopes: ScopeStack,
  helperScopes: HelperScopes,
): Invocation | undefined => {
  const callee = unwrappedExpression(childNode(call, 'callee'));
  const direct = directInvocation(callee, call, scopes, helperScopes);
  if (direct || !callee) {
    return direct;
  }
  const bound = immediatelyBoundInvocation(callee, call, scopes, helperScopes);
  if (bound) {
    return bound;
  }
  return methodInvocation(callee, call, scopes, helperScopes);
};
