/* -------------------------------------------------------------------------- */
/*      Object and array values for the Effect runtime task interpreter.      */
/* -------------------------------------------------------------------------- */

import { RUNTIME_NORMAL, unknownRuntimeValue } from './effect-promise-runtime-model';
import type {
  RuntimeExecutionContext,
  RuntimeObjectRef,
  RuntimeResult,
  RuntimeStatementHost,
  RuntimeValue,
} from './effect-promise-runtime-model';
import {
  allocateRuntimeObject,
  runtimeArrayValues,
  spreadRuntimeMembers,
  writeRuntimeMember,
} from './effect-promise-runtime-heap';
import { asNode, childNode, childNodes } from './effect-ast';
import {
  runtimeObjectReference,
  runtimeScalar,
  runtimeStaticKey,
} from './effect-promise-runtime-values';
import type { ASTNode } from './effect-ast';

const optionalVisit = (
  host: RuntimeStatementHost,
  node: ASTNode | undefined,
  context: RuntimeExecutionContext,
): RuntimeResult | undefined => {
  if (node) {
    return host.visit(node, context);
  }
  return undefined;
};

const objectKey = (
  host: RuntimeStatementHost,
  property: ASTNode,
  context: RuntimeExecutionContext,
): RuntimeResult => {
  const key = childNode(property, 'key');
  if (Reflect.get(property, 'computed') !== true) {
    return { completion: RUNTIME_NORMAL, value: key };
  }
  if (key) {
    return host.visit(key, context);
  }
  return { completion: RUNTIME_NORMAL, value: undefined };
};

const resultKey = (
  host: RuntimeStatementHost,
  property: ASTNode,
  result: RuntimeResult,
  context: RuntimeExecutionContext,
): string | undefined => {
  if (Reflect.get(property, 'computed') !== true) {
    return runtimeStaticKey(childNode(property, 'key'));
  }
  const scalar = runtimeScalar(result.value, host.valueContext(context));
  if (scalar === unknownRuntimeValue || scalar === null || typeof scalar === 'boolean') {
    return undefined;
  }
  return String(scalar);
};

const spreadObject = (
  host: RuntimeStatementHost,
  property: ASTNode,
  target: RuntimeObjectRef,
  context: RuntimeExecutionContext,
): RuntimeResult => {
  const argument = childNode(property, 'argument');
  const result = optionalVisit(host, argument, context);
  if (!result) {
    return { completion: RUNTIME_NORMAL, value: target };
  }
  if (result.completion !== RUNTIME_NORMAL) {
    return result;
  }
  const source = runtimeObjectReference(result.value);
  if (source) {
    spreadRuntimeMembers(host.state, source, target);
  }
  return { completion: RUNTIME_NORMAL, value: target };
};

const writeObjectProperty = (
  host: RuntimeStatementHost,
  property: ASTNode,
  target: RuntimeObjectRef,
  key: RuntimeResult,
  context: RuntimeExecutionContext,
): RuntimeResult => {
  const valueNode = childNode(property, 'value');
  if (!valueNode) {
    return { completion: RUNTIME_NORMAL, value: target };
  }
  const value = host.visit(valueNode, context);
  if (value.completion !== RUNTIME_NORMAL) {
    return value;
  }
  const name = resultKey(host, property, key, context);
  if (name) {
    writeRuntimeMember(host.state, target, name, value.value);
  }
  return { completion: RUNTIME_NORMAL, value: target };
};

const objectProperty = (
  host: RuntimeStatementHost,
  property: ASTNode,
  target: RuntimeObjectRef,
  context: RuntimeExecutionContext,
): RuntimeResult => {
  if (property.type === 'SpreadElement') {
    return spreadObject(host, property, target, context);
  }
  const key = objectKey(host, property, context);
  if (key.completion !== RUNTIME_NORMAL) {
    return key;
  }
  return writeObjectProperty(host, property, target, key, context);
};

const objectExpression = (
  host: RuntimeStatementHost,
  node: ASTNode,
  context: RuntimeExecutionContext,
): RuntimeResult => {
  const reference = allocateRuntimeObject(host.state, false, node);
  for (const property of childNodes(node, 'properties')) {
    const result = objectProperty(host, property, reference, context);
    if (result.completion !== RUNTIME_NORMAL) {
      return result;
    }
  }
  return { completion: RUNTIME_NORMAL, value: reference };
};

class RuntimeArrayBuilder {
  index = 0;

  isExact = true;

  append(host: RuntimeStatementHost, target: RuntimeObjectRef, value: RuntimeValue): void {
    if (this.isExact) {
      writeRuntimeMember(host.state, target, String(this.index), value);
      this.index += 1;
    }
  }

  invalidate(): void {
    this.isExact = false;
  }

  length(): number | undefined {
    if (this.isExact) {
      return this.index;
    }
    return undefined;
  }
}

const exactArrayValues = (
  host: RuntimeStatementHost,
  value: RuntimeValue,
): readonly RuntimeValue[] | undefined => {
  const source = runtimeObjectReference(value);
  if (source) {
    return runtimeArrayValues(host.state, source);
  }
  return undefined;
};

const spreadArrayValues = (
  host: RuntimeStatementHost,
  result: RuntimeResult,
  target: RuntimeObjectRef,
  builder: RuntimeArrayBuilder,
): RuntimeResult => {
  const values = exactArrayValues(host, result.value);
  if (!values) {
    builder.invalidate();
    return { completion: RUNTIME_NORMAL, value: target };
  }
  for (const value of values) {
    builder.append(host, target, value);
  }
  return { completion: RUNTIME_NORMAL, value: target };
};

const spreadArray = (
  host: RuntimeStatementHost,
  element: ASTNode,
  target: RuntimeObjectRef,
  builder: RuntimeArrayBuilder,
  context: RuntimeExecutionContext,
): RuntimeResult => {
  const argument = childNode(element, 'argument');
  const result = optionalVisit(host, argument, context);
  if (!result) {
    builder.invalidate();
    return { completion: RUNTIME_NORMAL, value: target };
  }
  if (result.completion !== RUNTIME_NORMAL) {
    return result;
  }
  return spreadArrayValues(host, result, target, builder);
};

const arrayElement = (
  host: RuntimeStatementHost,
  value: unknown,
  target: RuntimeObjectRef,
  builder: RuntimeArrayBuilder,
  context: RuntimeExecutionContext,
): RuntimeResult => {
  const element = asNode(value);
  if (!element) {
    builder.append(host, target, undefined);
    return { completion: RUNTIME_NORMAL, value: target };
  }
  if (element.type === 'SpreadElement') {
    return spreadArray(host, element, target, builder, context);
  }
  const result = host.visit(element, context);
  if (result.completion === RUNTIME_NORMAL) {
    builder.append(host, target, result.value);
  }
  return result;
};

interface RuntimeArrayFrame {
  builder: RuntimeArrayBuilder;
  context: RuntimeExecutionContext;
  elements: readonly unknown[];
  index: number;
  pendingElement: ASTNode | undefined;
  reference: RuntimeObjectRef;
}

interface RuntimeArrayCompletion {
  done: boolean;
  result: RuntimeResult | undefined;
}

const arrayElements = (node: ASTNode): readonly unknown[] => {
  const raw: unknown = Reflect.get(node, 'elements');
  if (Array.isArray(raw)) {
    return raw;
  }
  return [];
};

const arrayFrameFor = (
  host: RuntimeStatementHost,
  node: ASTNode,
  context: RuntimeExecutionContext,
): RuntimeArrayFrame => ({
  builder: new RuntimeArrayBuilder(),
  context,
  elements: arrayElements(node),
  index: 0,
  pendingElement: undefined,
  reference: allocateRuntimeObject(host.state, true, node),
});

const nestedArrayNode = (element: ASTNode | undefined): ASTNode | undefined => {
  if (element?.type === 'SpreadElement') {
    return childNode(element, 'argument');
  }
  return element;
};

const appendNestedArrayResult = (
  host: RuntimeStatementHost,
  element: ASTNode,
  result: RuntimeResult,
  frame: RuntimeArrayFrame,
): RuntimeResult => {
  if (result.completion !== RUNTIME_NORMAL) {
    return result;
  }
  if (element.type === 'SpreadElement') {
    return spreadArrayValues(host, result, frame.reference, frame.builder);
  }
  frame.builder.append(host, frame.reference, result.value);
  return { completion: RUNTIME_NORMAL, value: frame.reference };
};

const visitArrayElement = (
  host: RuntimeStatementHost,
  pending: RuntimeArrayFrame[],
): RuntimeResult | undefined => {
  const frame = pending[pending.length - 1];
  const value = frame.elements[frame.index];
  frame.index += 1;
  const element = asNode(value);
  const nested = nestedArrayNode(element);
  if (element && nested?.type === 'ArrayExpression') {
    frame.pendingElement = element;
    pending.push(arrayFrameFor(host, nested, frame.context));
    return undefined;
  }
  return arrayElement(host, value, frame.reference, frame.builder, frame.context);
};

const completeArrayFrame = (frame: RuntimeArrayFrame): RuntimeResult => {
  const { builder, reference } = frame;
  reference.arrayLength = builder.length();
  return { completion: RUNTIME_NORMAL, value: reference };
};

const finishNestedArrayFrame = (
  host: RuntimeStatementHost,
  pending: RuntimeArrayFrame[],
  completed: RuntimeResult,
): RuntimeArrayCompletion => {
  const parent = pending[pending.length - 1];
  const element = parent.pendingElement;
  parent.pendingElement = undefined;
  if (!element) {
    return { done: false, result: undefined };
  }
  const result = appendNestedArrayResult(host, element, completed, parent);
  if (result.completion !== RUNTIME_NORMAL) {
    return { done: true, result };
  }
  return { done: false, result: undefined };
};

const finishArrayFrame = (
  host: RuntimeStatementHost,
  pending: RuntimeArrayFrame[],
): RuntimeArrayCompletion => {
  const frame = pending.pop();
  if (!frame) {
    return {
      done: true,
      result: { completion: RUNTIME_NORMAL, value: undefined },
    };
  }
  const completed = completeArrayFrame(frame);
  const parent = pending[pending.length - 1];
  if (!parent) {
    return { done: true, result: completed };
  }
  return finishNestedArrayFrame(host, pending, completed);
};

const arrayCompletionResult = (completion: RuntimeArrayCompletion): RuntimeResult | undefined => {
  if (!completion.done) {
    return undefined;
  }
  return completion.result ?? { completion: RUNTIME_NORMAL, value: undefined };
};

const advanceArrayFrame = (
  host: RuntimeStatementHost,
  pending: RuntimeArrayFrame[],
): RuntimeResult | undefined => {
  const frame = pending[pending.length - 1];
  if (frame.index >= frame.elements.length) {
    return arrayCompletionResult(finishArrayFrame(host, pending));
  }
  const result = visitArrayElement(host, pending);
  if (result && result.completion !== RUNTIME_NORMAL) {
    return result;
  }
  return undefined;
};

const arrayExpression = (
  host: RuntimeStatementHost,
  node: ASTNode,
  context: RuntimeExecutionContext,
): RuntimeResult => {
  const pending: RuntimeArrayFrame[] = [arrayFrameFor(host, node, context)];
  while (pending.length > 0) {
    const result = advanceArrayFrame(host, pending);
    if (result) {
      return result;
    }
  }
  return { completion: RUNTIME_NORMAL, value: undefined };
};

/**
 * Evaluate an object or array literal, or decline another expression.
 *
 * @internal
 */
export const runtimeStructure = (
  host: RuntimeStatementHost,
  node: ASTNode,
  context: RuntimeExecutionContext,
): RuntimeResult | undefined => {
  if (node.type === 'ObjectExpression') {
    return objectExpression(host, node, context);
  }
  if (node.type === 'ArrayExpression') {
    return arrayExpression(host, node, context);
  }
  return undefined;
};
