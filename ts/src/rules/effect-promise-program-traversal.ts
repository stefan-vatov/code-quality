/* -------------------------------------------------------------------------- */
/*       Program-first traversal for native Promise boundary analysis.        */
/* -------------------------------------------------------------------------- */

import { containerHelperScopes, functionHeaderScopes } from './effect-promise-callables';
import type { ASTNode } from './effect-ast';
import type { HelperScopes } from './effect-promise-callables';
import type { ScopeStack } from './effect-ast-scope';
import { asNode } from './effect-ast';
import { isFunctionNode } from './effect-boundary-ast-shared';

const emptyScopes: ScopeStack = [];
const emptyHelperScopes: HelperScopes = [];

type HelperFrameKind = 'container' | 'function';

/**
 * Lazily materialized callable provenance for one lexical AST boundary.
 *
 * @internal
 */
export interface NativeHelperFrame {
  helperScopes: HelperScopes | undefined;
  kind: HelperFrameKind;
  node: ASTNode;
  parent: NativeHelperFrame | undefined;
}

interface NativeProgramTraversalInput {
  onCall: (node: ASTNode, frame: NativeHelperFrame) => void;
  program: ASTNode;
  seenCalls: WeakSet<object>;
  visitorKeys: Readonly<Record<string, readonly string[]>>;
}

interface NativeTraversalFrame {
  inherited: NativeHelperFrame | undefined;
  value: unknown;
}

const helperFrame = (
  node: ASTNode,
  kind: HelperFrameKind,
  parent: NativeHelperFrame | undefined,
): NativeHelperFrame => ({
  helperScopes: undefined,
  kind,
  node,
  parent,
});

const nodeFrame = (
  node: ASTNode,
  inherited: NativeHelperFrame | undefined,
): NativeHelperFrame | undefined => {
  if (node.type === 'Program' || node.type === 'BlockStatement') {
    return helperFrame(node, 'container', inherited);
  }
  return inherited;
};

const childFrame = (
  node: ASTNode,
  inherited: NativeHelperFrame | undefined,
): NativeHelperFrame | undefined => {
  if (isFunctionNode(node)) {
    return helperFrame(node, 'function', inherited);
  }
  return inherited;
};

const pushNativeChildren = (
  pending: NativeTraversalFrame[],
  node: ASTNode,
  inherited: NativeHelperFrame | undefined,
  keys: readonly string[],
): void => {
  for (let keyIndex = keys.length - 1; keyIndex >= 0; keyIndex -= 1) {
    const key = keys[keyIndex];
    if (key) {
      pending.push({ inherited, value: Reflect.get(node, key) });
    }
  }
};

const pushNativeArrayValues = (
  pending: NativeTraversalFrame[],
  values: readonly unknown[],
  inherited: NativeHelperFrame | undefined,
  seenArrays: WeakSet<object>,
): void => {
  if (seenArrays.has(values)) {
    return;
  }
  seenArrays.add(values);
  for (let valueIndex = values.length - 1; valueIndex >= 0; valueIndex -= 1) {
    pending.push({ inherited, value: values[valueIndex] });
  }
};

const visitNativeNode = (
  pending: NativeTraversalFrame[],
  current: NativeTraversalFrame,
  seenNodes: WeakSet<object>,
  input: NativeProgramTraversalInput,
): void => {
  const node = asNode(current.value);
  if (!node || seenNodes.has(node)) {
    return;
  }
  seenNodes.add(node);
  const currentFrame = nodeFrame(node, current.inherited);
  if (node.type === 'CallExpression' && currentFrame) {
    input.seenCalls.add(node);
    input.onCall(node, currentFrame);
  }
  const descendantsFrame = childFrame(node, currentFrame);
  pushNativeChildren(pending, node, descendantsFrame, input.visitorKeys[node.type] ?? []);
};

const visitNativeFrame = (
  pending: NativeTraversalFrame[],
  current: NativeTraversalFrame,
  seenNodes: WeakSet<object>,
  seenArrays: WeakSet<object>,
  input: NativeProgramTraversalInput,
): void => {
  if (Array.isArray(current.value)) {
    pushNativeArrayValues(pending, current.value, current.inherited, seenArrays);
    return;
  }
  visitNativeNode(pending, current, seenNodes, input);
};

const visitNativePending = (
  pending: NativeTraversalFrame[],
  seenNodes: WeakSet<object>,
  seenArrays: WeakSet<object>,
  input: NativeProgramTraversalInput,
): void => {
  const current = pending.pop();
  if (current) {
    visitNativeFrame(pending, current, seenNodes, seenArrays, input);
  }
};

/**
 * Traverse a native Program once while retaining only callable-scope boundaries.
 *
 * @param input - Program, native visitor keys, call callback, and host-dispatch cache.
 * @returns The lazily materialized root helper frame.
 * @throws Does not throw.
 * @internal
 */
export const visitNativePromiseProgram = (
  input: NativeProgramTraversalInput,
): NativeHelperFrame => {
  const rootFrame = helperFrame(input.program, 'container', undefined);
  const seenNodes = new WeakSet();
  const seenArrays = new WeakSet();
  seenNodes.add(input.program);
  const pending: NativeTraversalFrame[] = [];
  const keys = input.visitorKeys[input.program.type] ?? [];
  pushNativeChildren(pending, input.program, rootFrame, keys);

  while (pending.length > 0) {
    visitNativePending(pending, seenNodes, seenArrays, input);
  }
  return rootFrame;
};

const inheritedHelperScopes = (frame: NativeHelperFrame): HelperScopes => {
  const { parent } = frame;
  if (parent) {
    return helperScopesForNativeFrame(parent);
  }
  return emptyHelperScopes;
};

const materializeHelperScopes = (
  frame: NativeHelperFrame,
  inherited: HelperScopes,
): HelperScopes => {
  if (frame.kind === 'container') {
    return containerHelperScopes(frame.node, emptyScopes, inherited);
  }
  return functionHeaderScopes(frame.node, {
    helperScopes: inherited,
    node: frame.node,
    scopes: emptyScopes,
  });
};

/**
 * Materialize callable scopes for a candidate's lexical boundary chain.
 *
 * @param frame - Innermost boundary frame at the candidate call.
 * @returns Callable bindings visible from the candidate.
 * @throws Does not throw.
 * @internal
 */
export const helperScopesForNativeFrame = (frame: NativeHelperFrame): HelperScopes => {
  const { helperScopes } = frame;
  if (helperScopes) {
    return helperScopes;
  }
  const inherited = inheritedHelperScopes(frame);
  const materialized = materializeHelperScopes(frame, inherited);
  const mutableFrame = frame;
  mutableFrame.helperScopes = materialized;
  return materialized;
};
