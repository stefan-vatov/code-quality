/* -------------------------------------------------------------------------- */
/*   Static collection cardinality for eagerly executed Promise callbacks.    */
/* -------------------------------------------------------------------------- */

import { asNode, childNode, identifierName } from './effect-ast';
import type { ASTNode } from './effect-ast';
import type { ScopeStack } from './effect-ast-scope';
import { memberPropertyName } from './effect-promise-callables';
import { unwrappedExpression } from './effect-boundary-ast-shared';

/**
 * Native-global identity check supplied by the owning boundary rule.
 *
 * @internal
 */
export type NativeGlobalCheck = (
  name: string,
  node: ASTNode | undefined,
  scopes: ScopeStack,
) => boolean;

const eagerArrayMethods: ReadonlySet<string> = new Set([
  'every',
  'filter',
  'find',
  'findIndex',
  'findLast',
  'findLastIndex',
  'flatMap',
  'forEach',
  'map',
  'some',
]);

const holeVisitingArrayMethods: ReadonlySet<string> = new Set([
  'find',
  'findIndex',
  'findLast',
  'findLastIndex',
]);

const UNKNOWN_CARDINALITY = -1;

const rawNodeArray = (node: ASTNode, key: string): (ASTNode | undefined)[] => {
  const value: unknown = Reflect.get(node, key);
  if (!Array.isArray(value)) {
    return [];
  }
  const items: readonly unknown[] = value;
  const nodes: (ASTNode | undefined)[] = [];
  for (const item of items) {
    nodes.push(asNode(item));
  }
  return nodes;
};

const minimumCardinality = (cardinality: number): number => {
  if (cardinality < 0) {
    return -cardinality - 1;
  }
  return cardinality;
};

const encodedCardinality = (minimum: number, isExact: boolean): number => {
  if (isExact) {
    return minimum;
  }
  return -minimum - 1;
};

const combineCardinality = (left: number, right: number): number =>
  encodedCardinality(minimumCardinality(left) + minimumCardinality(right), left >= 0 && right >= 0);

const staticSpreadLength = (element: ASTNode): number => {
  const spread = unwrappedExpression(childNode(element, 'argument'));
  if (spread?.type === 'ArrayExpression') {
    return staticArrayLength(spread);
  }
  return UNKNOWN_CARDINALITY;
};

const staticLengthContribution = (element: ASTNode | undefined): number => {
  if (element?.type === 'SpreadElement') {
    return staticSpreadLength(element);
  }
  return 1;
};

const staticArrayCardinality = (array: ASTNode, countHoles: boolean): number => {
  const elements: unknown = Reflect.get(array, 'elements');
  if (!Array.isArray(elements)) {
    return 0;
  }
  let cardinality = 0;
  const elementValues: readonly unknown[] = elements;
  for (const elementValue of elementValues) {
    const element = asNode(elementValue);
    if (element || countHoles) {
      cardinality = combineCardinality(cardinality, staticLengthContribution(element));
    }
  }
  return cardinality;
};

const staticArrayLength = (array: ASTNode): number => staticArrayCardinality(array, true);

const staticArrayIterationCount = (array: ASTNode): number => staticArrayCardinality(array, false);

const staticArgumentContribution = (argument: ASTNode | undefined): number => {
  if (argument?.type === 'SpreadElement') {
    return staticSpreadLength(argument);
  }
  return 1;
};

const staticArgumentsCardinality = (call: ASTNode): number => {
  const argumentsValue: unknown = Reflect.get(call, 'arguments');
  if (!Array.isArray(argumentsValue)) {
    return 0;
  }
  let cardinality = 0;
  const argumentValues: readonly unknown[] = argumentsValue;
  const argumentCount = argumentValues.length;
  for (let argumentIndex = 0; argumentIndex < argumentCount; argumentIndex += 1) {
    cardinality = combineCardinality(
      cardinality,
      staticArgumentContribution(asNode(argumentValues[argumentIndex])),
    );
  }
  return cardinality;
};

const isNativeArrayMember = (
  callee: ASTNode | undefined,
  methodName: string,
  scopes: ScopeStack,
  isNativeGlobal: NativeGlobalCheck,
): boolean => {
  if (callee?.type !== 'MemberExpression' || memberPropertyName(callee) !== methodName) {
    return false;
  }
  const object = childNode(callee, 'object');
  return identifierName(object) === 'Array' && isNativeGlobal('Array', object, scopes);
};

const staticArrayOfCount = (
  call: ASTNode,
  scopes: ScopeStack,
  isNativeGlobal: NativeGlobalCheck,
): number => {
  if (!isNativeArrayMember(childNode(call, 'callee'), 'of', scopes, isNativeGlobal)) {
    return UNKNOWN_CARDINALITY;
  }
  return staticArgumentsCardinality(call);
};

const memberCollectionCount = (
  receiver: ASTNode | undefined,
  methodName: string,
  scopes: ScopeStack,
  isNativeGlobal: NativeGlobalCheck,
): number => {
  const collection = unwrappedExpression(receiver);
  if (collection?.type === 'ArrayExpression') {
    if (holeVisitingArrayMethods.has(methodName)) {
      return staticArrayLength(collection);
    }
    return staticArrayIterationCount(collection);
  }
  if (collection?.type === 'CallExpression') {
    return staticArrayOfCount(collection, scopes, isNativeGlobal);
  }
  return UNKNOWN_CARDINALITY;
};

const reductionCallback = (
  callArguments: readonly (ASTNode | undefined)[],
  minimum: number,
): ASTNode | undefined => {
  if (callArguments.length > 1 && minimum > 0) {
    return callArguments[0];
  }
  if (callArguments.length <= 1 && minimum > 1) {
    return callArguments[0];
  }
  return undefined;
};

const ordinaryCollectionCallback = (
  callArguments: readonly (ASTNode | undefined)[],
  methodName: string,
  minimum: number,
): ASTNode | undefined => {
  if (eagerArrayMethods.has(methodName) && minimum > 0) {
    return callArguments[0];
  }
  return undefined;
};

const collectionCallback = (
  callArguments: readonly (ASTNode | undefined)[],
  methodName: string,
  minimum: number,
): ASTNode | undefined => {
  if (methodName === 'reduce' || methodName === 'reduceRight') {
    return reductionCallback(callArguments, minimum);
  }
  return ordinaryCollectionCallback(callArguments, methodName, minimum);
};

const memberArrayCallback = (
  call: ASTNode,
  callee: ASTNode,
  scopes: ScopeStack,
  isNativeGlobal: NativeGlobalCheck,
): ASTNode | undefined => {
  const methodName = memberPropertyName(callee);
  if (!methodName) {
    return undefined;
  }
  const isReduction = methodName === 'reduce' || methodName === 'reduceRight';
  if (!isReduction && !eagerArrayMethods.has(methodName)) {
    return undefined;
  }
  const count = memberCollectionCount(
    childNode(callee, 'object'),
    methodName,
    scopes,
    isNativeGlobal,
  );
  const minimum = minimumCardinality(count);
  const callArguments = rawNodeArray(call, 'arguments');
  return collectionCallback(callArguments, methodName, minimum);
};

const staticIterableCount = (
  source: ASTNode | undefined,
  scopes: ScopeStack,
  isNativeGlobal: NativeGlobalCheck,
): number => {
  const iterable = unwrappedExpression(source);
  if (iterable?.type === 'ArrayExpression') {
    return staticArrayLength(iterable);
  }
  if (iterable?.type === 'CallExpression') {
    return staticArrayOfCount(iterable, scopes, isNativeGlobal);
  }
  return UNKNOWN_CARDINALITY;
};

const arrayFromCallback = (
  call: ASTNode,
  callee: ASTNode,
  scopes: ScopeStack,
  isNativeGlobal: NativeGlobalCheck,
): ASTNode | undefined => {
  if (!isNativeArrayMember(callee, 'from', scopes, isNativeGlobal)) {
    return undefined;
  }
  const callArguments = rawNodeArray(call, 'arguments');
  if (minimumCardinality(staticIterableCount(callArguments[0], scopes, isNativeGlobal)) > 0) {
    return callArguments[1];
  }
  return undefined;
};

/**
 * Resolve a callback that a statically non-empty native collection must invoke.
 *
 * @param call - Candidate collection call.
 * @param scopes - Lexical scopes visible at the call.
 * @param isNativeGlobal - Exact native-global identity predicate.
 * @returns The eagerly invoked callback, when execution is statically guaranteed.
 * @throws Does not throw.
 * @internal
 */
export const eagerCollectionCallback = (
  call: ASTNode,
  scopes: ScopeStack,
  isNativeGlobal: NativeGlobalCheck,
): ASTNode | undefined => {
  const callee = unwrappedExpression(childNode(call, 'callee'));
  if (callee?.type !== 'MemberExpression') {
    return undefined;
  }
  return (
    memberArrayCallback(call, callee, scopes, isNativeGlobal) ??
    arrayFromCallback(call, callee, scopes, isNativeGlobal)
  );
};
