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

const visitChild = (
  value: unknown,
  frame: NativeHelperFrame | undefined,
  input: NativeProgramTraversalInput,
): void => {
  if (Array.isArray(value)) {
    const valueCount = value.length;
    for (let valueIndex = 0; valueIndex < valueCount; valueIndex += 1) {
      visitChild(value[valueIndex], frame, input);
    }
    return;
  }
  const child = asNode(value);
  if (child) {
    visitNode(child, frame, input);
  }
};

const visitNode = (
  node: ASTNode,
  inherited: NativeHelperFrame | undefined,
  input: NativeProgramTraversalInput,
): void => {
  const currentFrame = nodeFrame(node, inherited);
  if (node.type === 'CallExpression' && currentFrame) {
    input.seenCalls.add(node);
    input.onCall(node, currentFrame);
  }
  const descendantsFrame = childFrame(node, currentFrame);
  visitChildren(node, descendantsFrame, input);
};

const visitChildren = (
  node: ASTNode,
  frame: NativeHelperFrame | undefined,
  input: NativeProgramTraversalInput,
): void => {
  const keys = input.visitorKeys[node.type] ?? [];
  const keyCount = keys.length;
  for (let keyIndex = 0; keyIndex < keyCount; keyIndex += 1) {
    const key = keys[keyIndex];
    if (key) {
      visitChild(Reflect.get(node, key), frame, input);
    }
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
  const keys = input.visitorKeys[input.program.type] ?? [];
  const keyCount = keys.length;
  for (let keyIndex = 0; keyIndex < keyCount; keyIndex += 1) {
    const key = keys[keyIndex];
    if (key) {
      visitChild(Reflect.get(input.program, key), rootFrame, input);
    }
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
