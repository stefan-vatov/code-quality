/* -------------------------------------------------------------------------- */
/*      Exact native intrinsics for the Effect runtime task interpreter.      */
/* -------------------------------------------------------------------------- */

import { RUNTIME_NORMAL, unknownRuntimeValue } from './effect-promise-runtime-model';
import type {
  RuntimeExecutionContext,
  RuntimeResult,
  RuntimeStatementHost,
  RuntimeValue,
} from './effect-promise-runtime-model';
import { childNode, identifierName } from './effect-ast';
import {
  resolvedRuntimeName,
  runtimeMemberName,
  runtimeNode,
  runtimeScalar,
} from './effect-promise-runtime-values';
import { runtimeCallable, runtimeCallableForNode } from './effect-promise-runtime-callables';
import type { ASTNode } from './effect-ast';
import { readRuntimeChoiceMember } from './effect-promise-runtime-choice-operations';
import { writeRuntimeCallableProperty } from './effect-promise-runtime-callable-properties';

const globalObjectMember = (
  node: ASTNode,
  context: RuntimeExecutionContext,
): ASTNode | undefined => {
  const callee = childNode(node, 'callee');
  if (callee?.type !== 'MemberExpression') {
    return undefined;
  }
  const object = childNode(callee, 'object');
  if (
    identifierName(object) === 'Object' &&
    resolvedRuntimeName(object, context.taskScopes) === object
  ) {
    return callee;
  }
  return undefined;
};

/**
 * Match the unshadowed global Object.defineProperty intrinsic.
 *
 * @internal
 */
export const isRuntimeObjectDefinePropertyCall = (
  node: ASTNode,
  context: RuntimeExecutionContext,
): boolean => {
  const member = globalObjectMember(node, context);
  return Boolean(member && runtimeMemberName(member) === 'defineProperty');
};

const propertyName = (
  host: RuntimeStatementHost,
  value: RuntimeValue,
  context: RuntimeExecutionContext,
): string | undefined => {
  const scalar = runtimeScalar(value, host.valueContext(context));
  if (scalar === unknownRuntimeValue) {
    return undefined;
  }
  return String(scalar);
};

/**
 * Apply one exact Object.defineProperty call to a callable own property.
 *
 * @internal
 */
export const executeRuntimeObjectDefineProperty = (
  host: RuntimeStatementHost,
  argumentsList: readonly RuntimeValue[],
  context: RuntimeExecutionContext,
): RuntimeResult => {
  const [target, key, descriptor] = argumentsList;
  const callable =
    runtimeCallable(target) ?? runtimeCallableForNode(host, runtimeNode(target), context);
  const name = propertyName(host, key, context);
  if (!callable || name === undefined) {
    return { completion: RUNTIME_NORMAL, value: unknownRuntimeValue };
  }
  const value = readRuntimeChoiceMember(host.state, descriptor, 'value');
  writeRuntimeCallableProperty(callable, name, value);
  return { completion: RUNTIME_NORMAL, value: callable };
};
