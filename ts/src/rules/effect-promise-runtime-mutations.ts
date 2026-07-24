/* -------------------------------------------------------------------------- */
/*    Exact assignments and deletions for the Effect runtime interpreter.     */
/* -------------------------------------------------------------------------- */

import { RUNTIME_NORMAL, unknownRuntimeValue } from './effect-promise-runtime-model';
import type {
  RuntimeExecutionContext,
  RuntimeResult,
  RuntimeStatementHost,
  RuntimeValue,
} from './effect-promise-runtime-model';
import {
  assignRuntimeName,
  resolvedRuntimeName,
  runtimeMemberName,
  runtimeScalar,
  runtimeTruthiness,
} from './effect-promise-runtime-values';
import {
  deleteRuntimeChoiceMember,
  readRuntimeChoiceMember,
  writeRuntimeChoiceMember,
} from './effect-promise-runtime-choice-operations';
import type { ASTNode } from './effect-ast';
import { bindRuntimePattern } from './effect-promise-runtime-patterns';
import { childNode } from './effect-ast';

interface RuntimeAssignmentTarget {
  completion: RuntimeResult['completion'];
  current?: RuntimeValue;
  name?: string;
  target?: RuntimeValue;
}

interface RuntimeMemberNameResult {
  completion: RuntimeResult['completion'];
  name?: string;
}

type RuntimeEvaluator = (node: ASTNode, context: RuntimeExecutionContext) => RuntimeResult;

const NORMAL_RESULT: RuntimeResult = { completion: RUNTIME_NORMAL, value: undefined };

const optionalValue = (
  node: ASTNode | undefined,
  context: RuntimeExecutionContext,
  evaluate: RuntimeEvaluator,
): RuntimeResult => {
  if (node) {
    return evaluate(node, context);
  }
  return NORMAL_RESULT;
};

const computedMemberName = (scalar: ReturnType<typeof runtimeScalar>): string | undefined => {
  if (scalar === unknownRuntimeValue) {
    return undefined;
  }
  return String(scalar);
};

const computedName = (
  host: RuntimeStatementHost,
  node: ASTNode,
  context: RuntimeExecutionContext,
  evaluate: RuntimeEvaluator,
): RuntimeMemberNameResult => {
  const property = optionalValue(childNode(node, 'property'), context, evaluate);
  if (property.completion !== RUNTIME_NORMAL) {
    return { completion: property.completion };
  }
  const scalar = runtimeScalar(property.value, host.valueContext(context));
  return { completion: RUNTIME_NORMAL, name: computedMemberName(scalar) };
};

const targetMemberName = (
  host: RuntimeStatementHost,
  node: ASTNode,
  context: RuntimeExecutionContext,
  evaluate: RuntimeEvaluator,
): RuntimeMemberNameResult => {
  if (Reflect.get(node, 'computed') === true) {
    return computedName(host, node, context, evaluate);
  }
  return { completion: RUNTIME_NORMAL, name: runtimeMemberName(node) };
};

const currentMemberValue = (
  host: RuntimeStatementHost,
  object: RuntimeValue,
  name: string | undefined,
): RuntimeValue => {
  if (name !== undefined) {
    return readRuntimeChoiceMember(host.state, object, name);
  }
  return unknownRuntimeValue;
};

const memberTarget = (
  host: RuntimeStatementHost,
  node: ASTNode,
  context: RuntimeExecutionContext,
  evaluate: RuntimeEvaluator,
): RuntimeAssignmentTarget => {
  const object = optionalValue(childNode(node, 'object'), context, evaluate);
  if (object.completion !== RUNTIME_NORMAL) {
    return { completion: object.completion };
  }
  const resolvedName = targetMemberName(host, node, context, evaluate);
  if (resolvedName.completion !== RUNTIME_NORMAL) {
    return { completion: resolvedName.completion };
  }
  const { name } = resolvedName;
  const current = currentMemberValue(host, object.value, name);
  return { completion: RUNTIME_NORMAL, current, name, target: object.value };
};

const assignmentTarget = (
  host: RuntimeStatementHost,
  node: ASTNode,
  context: RuntimeExecutionContext,
  evaluate: RuntimeEvaluator,
): RuntimeAssignmentTarget => {
  const left = childNode(node, 'left');
  if (left?.type === 'MemberExpression') {
    return memberTarget(host, left, context, evaluate);
  }
  let name: string | undefined = undefined;
  if (left?.type === 'Identifier') {
    name = String(Reflect.get(left, 'name'));
  }
  return {
    completion: RUNTIME_NORMAL,
    current: resolvedRuntimeName(left, context.taskScopes),
    name,
  };
};

const shouldAssignLogical = (
  operator: unknown,
  target: RuntimeAssignmentTarget,
  host: RuntimeStatementHost,
  context: RuntimeExecutionContext,
): boolean => {
  if (operator === '=') {
    return true;
  }
  if (operator === '??=') {
    return target.current === undefined;
  }
  const truthiness = runtimeTruthiness(target.current, host.valueContext(context));
  if (operator === '&&=') {
    return truthiness === true;
  }
  if (operator === '||=') {
    return truthiness === false;
  }
  return false;
};

const assignmentPattern = (
  host: RuntimeStatementHost,
  pattern: ASTNode,
  value: RuntimeValue,
  context: RuntimeExecutionContext,
  evaluate: RuntimeEvaluator,
): RuntimeResult => {
  const scope = context.taskScopes[context.taskScopes.length - 1];
  if (!scope) {
    return { completion: RUNTIME_NORMAL, value: unknownRuntimeValue };
  }
  return bindRuntimePattern(pattern, value, {
    evaluate: (node): RuntimeResult => evaluate(node, context),
    isAssignment: true,
    scope,
    scopes: context.taskScopes,
    state: host.state,
  });
};

const structuredAssignment = (
  host: RuntimeStatementHost,
  left: ASTNode,
  right: ASTNode | undefined,
  context: RuntimeExecutionContext,
  evaluate: RuntimeEvaluator,
): RuntimeResult => {
  const result = optionalValue(right, context, evaluate);
  if (result.completion !== RUNTIME_NORMAL) {
    return result;
  }
  const binding = assignmentPattern(host, left, result.value, context, evaluate);
  if (binding.completion !== RUNTIME_NORMAL) {
    return binding;
  }
  return result;
};

const writeAssignment = (
  host: RuntimeStatementHost,
  target: RuntimeAssignmentTarget,
  value: RuntimeValue,
  context: RuntimeExecutionContext,
): void => {
  if (target.name === undefined) {
    return;
  }
  if (target.target !== undefined) {
    writeRuntimeChoiceMember(host.state, target.target, target.name, value);
    return;
  }
  assignRuntimeName(target.name, value, context.taskScopes);
};

const simpleAssignment = (
  host: RuntimeStatementHost,
  node: ASTNode,
  context: RuntimeExecutionContext,
  evaluate: RuntimeEvaluator,
): RuntimeResult => {
  const target = assignmentTarget(host, node, context, evaluate);
  if (target.completion !== RUNTIME_NORMAL) {
    return { completion: target.completion, value: undefined };
  }
  if (!shouldAssignLogical(Reflect.get(node, 'operator'), target, host, context)) {
    return { completion: RUNTIME_NORMAL, value: target.current };
  }
  const result = optionalValue(childNode(node, 'right'), context, evaluate);
  if (result.completion === RUNTIME_NORMAL) {
    writeAssignment(host, target, result.value, context);
  }
  return result;
};

/**
 * Evaluate and apply one exact simple assignment.
 *
 * @internal
 */
export const executeRuntimeAssignment = (
  host: RuntimeStatementHost,
  node: ASTNode,
  context: RuntimeExecutionContext,
  evaluate: RuntimeEvaluator,
): RuntimeResult => {
  const left = childNode(node, 'left');
  if (left?.type === 'ArrayPattern' || left?.type === 'ObjectPattern') {
    return structuredAssignment(host, left, childNode(node, 'right'), context, evaluate);
  }
  return simpleAssignment(host, node, context, evaluate);
};

/**
 * Evaluate and apply one exact member deletion.
 *
 * @internal
 */
export const executeRuntimeDeletion = (
  host: RuntimeStatementHost,
  node: ASTNode,
  context: RuntimeExecutionContext,
  evaluate: RuntimeEvaluator,
): RuntimeResult => {
  const argument = childNode(node, 'argument');
  if (argument?.type !== 'MemberExpression') {
    return optionalValue(argument, context, evaluate);
  }
  const target = memberTarget(host, argument, context, evaluate);
  if (target.completion !== RUNTIME_NORMAL) {
    return { completion: target.completion, value: undefined };
  }
  if (target.name !== undefined && target.target !== undefined) {
    deleteRuntimeChoiceMember(host.state, target.target, target.name);
  }
  return NORMAL_RESULT;
};
