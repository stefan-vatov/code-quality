/* -------------------------------------------------------------------------- */
/*    Same-phase execution analysis for eager recursive Effect functions.     */
/* -------------------------------------------------------------------------- */

import type {
  LocalBinding,
  LocalFunctionScopes,
  LocalInvocationTarget,
} from './effect-recursion-local-bindings';
import { asNode, childNode, childNodes, identifierName } from './effect-ast';
import {
  effectCallAPIName,
  isFunctionNode,
  isShadowed,
  unwrappedExpression,
} from './effect-boundary-ast-shared';
import {
  localScopesForNode,
  resolveLocalTarget as resolveLocalBindingTarget,
} from './effect-recursion-local-bindings';
import { scopesForChild, withNodeScope } from './effect-ast-scope';
import type { ASTNode, ASTValue } from './effect-ast';
import type { EffectResolutionBindings } from './effect-recursion-viability';
import type { RecursionPhaseBindings } from './effect-recursion-phases';
import type { ScopeStack } from './effect-ast-scope';
import { scanEagerGeneratorPrefix } from './effect-recursion-generator';
import { selectedEagerCallback } from './effect-recursion-viability';

interface RecursionFacts {
  hasEffectCall: boolean;
  hasUnsuspendedSelfCall: boolean;
}

interface InvocationArguments {
  count: number;
  isKnown: boolean;
  values: readonly ASTNode[];
}

type InvocationTarget = LocalInvocationTarget;

interface ScanInput {
  bindings: RecursionPhaseBindings;
  executedBodies: WeakSet<object>;
  executedDefaults: WeakMap<object, Set<number>>;
  facts: RecursionFacts;
  functionName: string;
  localScopeCache: WeakMap<object, ReadonlyMap<string, LocalBinding>>;
  localScopes: LocalFunctionScopes;
  resolutionBindings: EffectResolutionBindings;
  seenArrays: WeakSet<object>;
  seenNodes: WeakSet<object>;
}

const suppliedArgument: InvocationArguments = {
  count: 1,
  isKnown: true,
  values: [],
};

const parameterScopes = (scopes: ScopeStack, node: ASTNode): ScopeStack => {
  // SAFETY: This synthetic node contains only AST children and is consumed by the local scope walker.
  const parameterScopeNode = {
    params: childNodes(node, 'params'),
    type: 'ArrowFunctionExpression',
  } as ASTNode;
  return withNodeScope(scopes, parameterScopeNode);
};

const memberName = (node: ASTNode | undefined): string | undefined => {
  const member = unwrappedExpression(node);
  if (member?.type !== 'MemberExpression' || member.computed === true) {
    return undefined;
  }
  return identifierName(childNode(member, 'property'));
};

const directCalledExpression = (node: ASTNode): ASTNode | undefined => {
  if (node.type !== 'CallExpression') {
    return undefined;
  }
  const callee = unwrappedExpression(childNode(node, 'callee'));
  if (isFunctionNode(callee)) {
    return callee;
  }
  if (callee && (memberName(callee) === 'call' || memberName(callee) === 'apply')) {
    return unwrappedExpression(childNode(callee, 'object'));
  }
  return undefined;
};

const boundCall = (node: ASTNode): ASTNode | undefined => {
  const bindCall = unwrappedExpression(childNode(node, 'callee'));
  if (bindCall?.type !== 'CallExpression') {
    return undefined;
  }
  const bindMember = unwrappedExpression(childNode(bindCall, 'callee'));
  if (memberName(bindMember) !== 'bind') {
    return undefined;
  }
  return bindCall;
};

const calledExpression = (node: ASTNode): ASTNode | undefined => {
  const direct = directCalledExpression(node);
  if (direct) {
    return direct;
  }
  const bindCall = boundCall(node);
  const bindMember = bindCall && unwrappedExpression(childNode(bindCall, 'callee'));
  if (bindMember) {
    return unwrappedExpression(childNode(bindMember, 'object'));
  }
  return undefined;
};

const calledIdentifier = (node: ASTNode): ASTNode | undefined => {
  const callee = unwrappedExpression(childNode(node, 'callee'));
  if (identifierName(callee)) {
    return callee;
  }
  if (callee && (memberName(callee) === 'call' || memberName(callee) === 'apply')) {
    return childNode(callee, 'object');
  }
  const bindCall = boundCall(node);
  const bindMember = bindCall && unwrappedExpression(childNode(bindCall, 'callee'));
  if (bindMember) {
    return childNode(bindMember, 'object');
  }
  return undefined;
};

const inputForLocalScopes = (input: ScanInput, localScopes: LocalFunctionScopes): ScanInput => {
  if (localScopes === input.localScopes) {
    return input;
  }
  return { ...input, localScopes };
};

const resolveLocalTarget = (name: string, input: ScanInput): InvocationTarget | undefined =>
  resolveLocalBindingTarget(name, input.functionName, input.localScopes);

const invocationTarget = (
  node: ASTNode,
  scopes: ScopeStack,
  input: ScanInput,
): InvocationTarget | undefined => {
  const expression = calledExpression(node);
  if (isFunctionNode(expression)) {
    return { functionNode: expression, isSelfCall: false };
  }
  const name = identifierName(calledIdentifier(node));
  if (!name) {
    return undefined;
  }
  const target = resolveLocalTarget(name, input);
  if (target?.isSelfCall && isShadowed(input.functionName, scopes)) {
    return undefined;
  }
  return target;
};

const isUndefinedArgument = (node: ASTNode | undefined): boolean =>
  identifierName(node) === 'undefined' ||
  (node?.type === 'UnaryExpression' && node.operator === 'void');

const ordinaryArguments = (node: ASTNode): InvocationArguments => {
  const values = childNodes(node, 'arguments');
  return { count: values.length, isKnown: true, values };
};

const appliedArguments = (node: ASTNode): InvocationArguments => {
  const values = childNodes(node, 'arguments');
  const [, applied] = values;
  if (applied?.type !== 'ArrayExpression') {
    return { count: 0, isKnown: false, values: [] };
  }
  const elements = childNodes(applied, 'elements');
  return { count: elements.length, isKnown: true, values: elements };
};

const boundArguments = (node: ASTNode, bindCall: ASTNode): InvocationArguments => {
  const bindArguments = childNodes(bindCall, 'arguments').slice(1);
  const callArguments = childNodes(node, 'arguments');
  const values = [...bindArguments, ...callArguments];
  return { count: values.length, isKnown: true, values };
};

const invocationArguments = (node: ASTNode): InvocationArguments => {
  const callee = unwrappedExpression(childNode(node, 'callee'));
  if (memberName(callee) === 'apply') {
    return appliedArguments(node);
  }
  if (memberName(callee) === 'call') {
    const values = childNodes(node, 'arguments').slice(1);
    return { count: values.length, isKnown: true, values };
  }
  const bindCall = boundCall(node);
  if (bindCall) {
    return boundArguments(node, bindCall);
  }
  return ordinaryArguments(node);
};

const shouldExecuteDefault = (
  index: number,
  argumentsValue: InvocationArguments | undefined,
): boolean => {
  if (!argumentsValue) {
    return true;
  }
  return (
    argumentsValue.isKnown &&
    (index >= argumentsValue.count || isUndefinedArgument(argumentsValue.values[index]))
  );
};

const markDefaultExecuted = (node: ASTNode, index: number, input: ScanInput): boolean => {
  const executed = input.executedDefaults.get(node) ?? new Set<number>();
  if (executed.has(index)) {
    return false;
  }
  executed.add(index);
  input.executedDefaults.set(node, executed);
  return true;
};

const scanDefaultAt = (
  node: ASTNode,
  index: number,
  scopes: ScopeStack,
  input: ScanInput,
  argumentsValue: InvocationArguments | undefined,
): void => {
  if (node.type !== 'AssignmentPattern') {
    return;
  }
  if (!shouldExecuteDefault(index, argumentsValue) || !markDefaultExecuted(node, index, input)) {
    return;
  }
  const defaultValue = childNode(node, 'right');
  if (defaultValue) {
    scanRecursiveNode(defaultValue, scopes, input);
  }
};

const scanFunctionDefaults = (
  node: ASTNode,
  scopes: ScopeStack,
  input: ScanInput,
  argumentsValue: InvocationArguments | undefined,
): void => {
  const parameters = childNodes(node, 'params');
  for (let index = 0; index < parameters.length; index += 1) {
    const parameter = parameters[index];
    if (parameter) {
      scanDefaultAt(parameter, index, scopes, input, argumentsValue);
    }
  }
};

const scanEagerGeneratorBody = (body: ASTNode, scopes: ScopeStack, input: ScanInput): void => {
  const localScopes = localScopesForNode(body, input.localScopes, input.localScopeCache);
  const nodeInput = inputForLocalScopes(input, localScopes);
  scanEagerGeneratorPrefix(body, {
    bindings: input.resolutionBindings,
    hasCompletedFacts: (): boolean =>
      nodeInput.facts.hasEffectCall && nodeInput.facts.hasUnsuspendedSelfCall,
    scan: (node): void => scanRecursiveNode(node, scopes, nodeInput),
    scopes,
  });
};

const scanFunctionBody = (node: ASTNode, functionScopes: ScopeStack, input: ScanInput): void => {
  const body = childNode(node, 'body');
  if (!body) {
    return;
  }
  const bodyScopes = scopesForChild(functionScopes, node, 'body');
  if (node.generator === true) {
    scanEagerGeneratorBody(body, bodyScopes, input);
  } else {
    scanRecursiveNode(body, bodyScopes, input);
  }
};

const scanExecutedFunction = (
  node: ASTNode,
  scopes: ScopeStack,
  input: ScanInput,
  argumentsValue: InvocationArguments | undefined,
  allowGenerator = false,
): void => {
  if (node.generator === true && !allowGenerator) {
    return;
  }
  const functionScopes = parameterScopes(scopes, node);
  scanFunctionDefaults(node, functionScopes, input, argumentsValue);
  if (input.executedBodies.has(node)) {
    return;
  }
  input.executedBodies.add(node);
  scanFunctionBody(node, functionScopes, input);
};

const scanNamedEagerFunction = (name: string, scopes: ScopeStack, input: ScanInput): void => {
  const target = resolveLocalTarget(name, input);
  const { facts } = input;
  if (target?.isSelfCall && !isShadowed(name, scopes)) {
    facts.hasUnsuspendedSelfCall = true;
  } else if (target?.functionNode) {
    scanExecutedFunction(target.functionNode, scopes, input, suppliedArgument);
  }
};

const scanEagerFunction = (
  node: ASTNode | undefined,
  scopes: ScopeStack,
  input: ScanInput,
): void => {
  const functionNode = unwrappedExpression(node);
  if (isFunctionNode(functionNode)) {
    scanExecutedFunction(functionNode, scopes, input, suppliedArgument);
    return;
  }
  const name = identifierName(functionNode);
  if (!name) {
    return;
  }
  scanNamedEagerFunction(name, scopes, input);
};

const scanEagerCallbacks = (node: ASTNode, scopes: ScopeStack, input: ScanInput): void => {
  const callback = selectedEagerCallback(node, input.resolutionBindings, scopes);
  if (callback) {
    scanEagerFunction(callback, scopes, input);
  }
};

const recordNodeFacts = (
  node: ASTNode,
  scopes: ScopeStack,
  target: InvocationTarget | undefined,
  input: ScanInput,
): void => {
  const { facts } = input;
  if (target?.isSelfCall) {
    facts.hasUnsuspendedSelfCall = true;
    return;
  }
  if (effectCallAPIName(node, input.bindings.effect, scopes) !== undefined) {
    facts.hasEffectCall = true;
  }
};

const scanInvocationTarget = (
  node: ASTNode,
  scopes: ScopeStack,
  target: InvocationTarget | undefined,
  input: ScanInput,
): void => {
  if (target?.functionNode) {
    scanExecutedFunction(target.functionNode, scopes, input, invocationArguments(node));
  }
};

const recursiveNodeContext = (
  node: ASTNode,
  scopes: ScopeStack,
  input: ScanInput,
): readonly [ScopeStack, ScanInput, InvocationTarget | undefined] => {
  const nodeScopes = withNodeScope(scopes, node);
  const localScopes = localScopesForNode(node, input.localScopes, input.localScopeCache);
  const nodeInput = inputForLocalScopes(input, localScopes);
  return [nodeScopes, nodeInput, invocationTarget(node, nodeScopes, nodeInput)];
};

interface RecursiveScanFrame {
  input?: ScanInput;
  kind: 'callbacks' | 'invoke' | 'node' | 'value';
  node?: ASTNode;
  scopes: ScopeStack;
  target?: InvocationTarget;
  value?: ASTValue;
}

const appendRecursiveValue = (
  pending: RecursiveScanFrame[],
  value: ASTValue,
  scopes: ScopeStack,
  input: ScanInput,
): void => {
  pending.push({ input, kind: 'value', scopes, value });
};

const appendArrayValues = (
  pending: RecursiveScanFrame[],
  values: readonly ASTValue[],
  scopes: ScopeStack,
  input: ScanInput,
): void => {
  for (let index = values.length - 1; index >= 0; index -= 1) {
    appendRecursiveValue(pending, values[index], scopes, input);
  }
};

const processValueFrame = (
  frame: RecursiveScanFrame,
  pending: RecursiveScanFrame[],
  rootInput: ScanInput,
): void => {
  const input = frame.input ?? rootInput;
  const { value } = frame;
  if (Array.isArray(value)) {
    if (!input.seenArrays.has(value)) {
      input.seenArrays.add(value);
      appendArrayValues(pending, value, frame.scopes, input);
    }
    return;
  }
  const child = asNode(value);
  if (child) {
    pending.push({ input, kind: 'node', node: child, scopes: frame.scopes });
  }
};

const appendNodeChildren = (
  pending: RecursiveScanFrame[],
  node: ASTNode,
  scopes: ScopeStack,
  input: ScanInput,
): void => {
  const entries = Object.entries(node);
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry && entry[0] !== 'parent') {
      appendRecursiveValue(pending, entry[1], scopesForChild(scopes, node, entry[0]), input);
    }
  }
};

const appendPostNodeFrames = (
  pending: RecursiveScanFrame[],
  node: ASTNode,
  scopes: ScopeStack,
  target: InvocationTarget | undefined,
  input: ScanInput,
): void => {
  pending.push({ input, kind: 'invoke', node, scopes, target });
  pending.push({ input, kind: 'callbacks', node, scopes });
};

const processNodeFrame = (
  frame: RecursiveScanFrame,
  pending: RecursiveScanFrame[],
  rootInput: ScanInput,
): void => {
  const { node } = frame;
  if (!node) {
    return;
  }
  const input = frame.input ?? rootInput;
  if (input.seenNodes.has(node) || isFunctionNode(node)) {
    return;
  }
  input.seenNodes.add(node);
  const [nodeScopes, nodeInput, target] = recursiveNodeContext(node, frame.scopes, input);
  recordNodeFacts(node, nodeScopes, target, nodeInput);
  if (nodeInput.facts.hasEffectCall && nodeInput.facts.hasUnsuspendedSelfCall) {
    return;
  }
  appendPostNodeFrames(pending, node, nodeScopes, target, nodeInput);
  appendNodeChildren(pending, node, nodeScopes, nodeInput);
};

const processScanFrame = (
  frame: RecursiveScanFrame,
  pending: RecursiveScanFrame[],
  input: ScanInput,
): void => {
  if (frame.kind === 'value') {
    processValueFrame(frame, pending, input);
    return;
  }
  const { node, input: frameInput } = frame;
  if (!node || !frameInput) {
    return;
  }
  if (frame.kind === 'callbacks') {
    scanEagerCallbacks(node, frame.scopes, frameInput);
    return;
  }
  if (frame.kind === 'invoke') {
    scanInvocationTarget(node, frame.scopes, frame.target, frameInput);
    return;
  }
  processNodeFrame(frame, pending, input);
};

const scanRecursiveNode = (node: ASTNode, scopes: ScopeStack, input: ScanInput): void => {
  const pending: RecursiveScanFrame[] = [{ input, kind: 'node', node, scopes }];
  while (pending.length > 0) {
    const frame = pending.pop();
    if (frame) {
      processScanFrame(frame, pending, input);
    }
  }
};

/**
 * Analyze a named function for Effect construction and same-phase self-invocation.
 *
 * @internal
 */
export const recursiveEffectFacts = (
  node: ASTNode,
  functionName: string,
  bindings: RecursionPhaseBindings,
  resolutionBindings: EffectResolutionBindings,
  ...options: readonly [hasEffectCall?: boolean, allowGenerator?: boolean]
): RecursionFacts => {
  const [hasEffectCall = false, allowGenerator = false] = options;
  const facts = {
    hasEffectCall,
    hasUnsuspendedSelfCall: false,
  };
  const input: ScanInput = {
    bindings,
    executedBodies: new WeakSet(),
    executedDefaults: new WeakMap(),
    facts,
    functionName,
    localScopeCache: new WeakMap(),
    localScopes: [],
    resolutionBindings,
    seenArrays: new WeakSet(),
    seenNodes: new WeakSet(),
  };
  scanExecutedFunction(node, [], input, undefined, allowGenerator);
  return facts;
};
