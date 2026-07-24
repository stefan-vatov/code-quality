/* -------------------------------------------------------------------------- */
/*     Recursive declaration patterns for the Effect runtime interpreter.     */
/* -------------------------------------------------------------------------- */

import { RUNTIME_NORMAL, unknownRuntimeValue } from './effect-promise-runtime-model';
import type {
  RuntimeObjectRef,
  RuntimeResult,
  RuntimeScope,
  RuntimeState,
  RuntimeValue,
} from './effect-promise-runtime-model';
import {
  allocateRuntimeObject,
  readRuntimeMember,
  runtimeArrayValues,
  writeRuntimeMember,
} from './effect-promise-runtime-heap';
import { asNode, childNode, childNodes, identifierName } from './effect-ast';
import {
  assignRuntimeName,
  runtimeNode,
  runtimeObjectReference,
  runtimeStaticKey,
} from './effect-promise-runtime-values';
import type { ASTNode } from './effect-ast';

/**
 * Capabilities required while binding one parameter or declaration pattern.
 *
 * @internal
 */
export interface RuntimePatternContext {
  evaluate: (node: ASTNode) => RuntimeResult;
  isAssignment?: boolean;
  scope: RuntimeScope;
  scopes?: readonly RuntimeScope[];
  state: RuntimeState;
}

const NORMAL_RESULT: RuntimeResult = { completion: RUNTIME_NORMAL, value: undefined };

const bindIdentifier = (
  pattern: ASTNode,
  value: RuntimeValue,
  context: RuntimePatternContext,
): RuntimeResult => {
  const name = identifierName(pattern);
  if (name) {
    if (context.isAssignment && context.scopes) {
      assignRuntimeName(name, value, context.scopes);
    } else {
      context.scope.values.set(name, value);
    }
  }
  return NORMAL_RESULT;
};

const bindAssignment = (
  pattern: ASTNode,
  value: RuntimeValue,
  context: RuntimePatternContext,
): RuntimeResult => {
  if (value !== undefined) {
    return bindRuntimePattern(childNode(pattern, 'left'), value, context);
  }
  const fallback = childNode(pattern, 'right');
  if (!fallback) {
    return bindRuntimePattern(childNode(pattern, 'left'), undefined, context);
  }
  const result = context.evaluate(fallback);
  if (result.completion !== RUNTIME_NORMAL) {
    return result;
  }
  return bindRuntimePattern(childNode(pattern, 'left'), result.value, context);
};

const bindArrayREST = (
  pattern: ASTNode,
  values: readonly RuntimeValue[] | undefined,
  start: number,
  context: RuntimePatternContext,
): RuntimeResult => {
  const remaining = values?.slice(start);
  if (!remaining) {
    return bindRuntimePattern(childNode(pattern, 'argument'), unknownRuntimeValue, context);
  }
  const rest = allocateRuntimeObject(context.state, true);
  rest.arrayLength = remaining.length;
  for (let index = 0; index < remaining.length; index += 1) {
    writeRuntimeMember(context.state, rest, String(index), remaining[index]);
  }
  return bindRuntimePattern(childNode(pattern, 'argument'), rest, context);
};

const nodeArrayValues = (node: ASTNode, key: string): readonly unknown[] => {
  const values: unknown = Reflect.get(node, key);
  if (Array.isArray(values)) {
    return values;
  }
  return [];
};

const bindArrayElement = (
  element: ASTNode | undefined,
  values: readonly RuntimeValue[] | undefined,
  index: number,
  context: RuntimePatternContext,
): RuntimeResult => {
  if (!element) {
    return NORMAL_RESULT;
  }
  if (element.type === 'RestElement') {
    return bindArrayREST(element, values, index, context);
  }
  return bindRuntimePattern(element, values?.[index] ?? unknownRuntimeValue, context);
};

const bindArray = (
  pattern: ASTNode,
  value: RuntimeValue,
  context: RuntimePatternContext,
): RuntimeResult => {
  const reference = runtimeObjectReference(value);
  const values = reference && runtimeArrayValues(context.state, reference);
  const elements = nodeArrayValues(pattern, 'elements');
  for (let index = 0; index < elements.length; index += 1) {
    const element = asNode(elements[index]);
    const result = bindArrayElement(element, values, index, context);
    if (result.completion !== RUNTIME_NORMAL) {
      return result;
    }
  }
  return NORMAL_RESULT;
};

const propertyValue = (
  reference: RuntimeObjectRef | undefined,
  name: string | undefined,
  context: RuntimePatternContext,
): RuntimeValue => {
  if (!reference || !name) {
    return unknownRuntimeValue;
  }
  if (!context.state.heap.get(reference)?.has(name)) {
    return undefined;
  }
  return readRuntimeMember(context.state, reference, name);
};

const objectREST = (
  reference: RuntimeObjectRef | undefined,
  excluded: ReadonlySet<string>,
  context: RuntimePatternContext,
): RuntimeValue => {
  if (!reference) {
    return unknownRuntimeValue;
  }
  const rest = allocateRuntimeObject(context.state);
  for (const [name, value] of context.state.heap.get(reference) ?? []) {
    if (!excluded.has(name)) {
      writeRuntimeMember(context.state, rest, name, value);
    }
  }
  return rest;
};

const bindObjectProperty = (
  property: ASTNode,
  reference: RuntimeObjectRef | undefined,
  excluded: Set<string>,
  context: RuntimePatternContext,
): RuntimeResult => {
  if (property.type === 'RestElement') {
    const rest = objectREST(reference, excluded, context);
    return bindRuntimePattern(childNode(property, 'argument'), rest, context);
  }
  const key = patternPropertyKey(property, context);
  if (key.completion !== RUNTIME_NORMAL) {
    return { completion: key.completion, value: undefined };
  }
  const { name } = key;
  if (name) {
    excluded.add(name);
  }
  return bindRuntimePattern(
    childNode(property, 'value'),
    propertyValue(reference, name, context),
    context,
  );
};

interface RuntimePatternKey {
  completion: RuntimeResult['completion'];
  name?: string;
}

const patternPropertyKey = (
  property: ASTNode,
  context: RuntimePatternContext,
): RuntimePatternKey => {
  const key = childNode(property, 'key');
  if (Reflect.get(property, 'computed') !== true) {
    return { completion: RUNTIME_NORMAL, name: runtimeStaticKey(key) };
  }
  if (!key) {
    return { completion: RUNTIME_NORMAL };
  }
  const result = context.evaluate(key);
  if (result.completion !== RUNTIME_NORMAL) {
    return { completion: result.completion };
  }
  return {
    completion: RUNTIME_NORMAL,
    name: runtimeStaticKey(runtimeNode(result.value)),
  };
};

const bindObject = (
  pattern: ASTNode,
  value: RuntimeValue,
  context: RuntimePatternContext,
): RuntimeResult => {
  const reference = runtimeObjectReference(value);
  const excluded = new Set<string>();
  for (const property of childNodes(pattern, 'properties')) {
    const result = bindObjectProperty(property, reference, excluded, context);
    if (result.completion !== RUNTIME_NORMAL) {
      return result;
    }
  }
  return NORMAL_RESULT;
};

const bindWrapped = (
  pattern: ASTNode,
  value: RuntimeValue,
  context: RuntimePatternContext,
): RuntimeResult | undefined => {
  if (pattern.type === 'AssignmentPattern') {
    return bindAssignment(pattern, value, context);
  }
  if (pattern.type === 'RestElement') {
    return bindRuntimePattern(childNode(pattern, 'argument'), value, context);
  }
  if (pattern.type === 'TSParameterProperty') {
    return bindRuntimePattern(childNode(pattern, 'parameter'), value, context);
  }
  return undefined;
};

const bindStructured = (
  pattern: ASTNode,
  value: RuntimeValue,
  context: RuntimePatternContext,
): RuntimeResult => {
  if (pattern.type === 'ArrayPattern') {
    return bindArray(pattern, value, context);
  }
  if (pattern.type === 'ObjectPattern') {
    return bindObject(pattern, value, context);
  }
  return NORMAL_RESULT;
};

/**
 * Bind identifiers, defaults, object/array projections, and rest patterns recursively.
 *
 * @internal
 */
export const bindRuntimePattern = (
  pattern: ASTNode | undefined,
  value: RuntimeValue,
  context: RuntimePatternContext,
): RuntimeResult => {
  if (!pattern) {
    return NORMAL_RESULT;
  }
  if (identifierName(pattern)) {
    return bindIdentifier(pattern, value, context);
  }
  const wrapped = bindWrapped(pattern, value, context);
  if (wrapped) {
    return wrapped;
  }
  return bindStructured(pattern, value, context);
};
