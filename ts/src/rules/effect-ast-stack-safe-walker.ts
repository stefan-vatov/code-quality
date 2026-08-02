/* -------------------------------------------------------------------------- */
/*      Cycle-safe explicit-stack traversal for source-backed AST rules.      */
/* -------------------------------------------------------------------------- */

import { scopesForChild, withNodeScope } from './effect-ast-scope';
import type { ASTNode } from './effect-ast';
import type { ScopeStack } from './effect-ast-scope';
import { asNode } from './effect-ast';

interface ASTStackFrame<Context> {
  context: Context;
  scopes: ScopeStack;
  value: unknown;
}

interface ASTStackNodeResult<Context> {
  context: Context;
  visitChildren: boolean;
}

interface ASTStackWalkerInput<Context> {
  context: Context;
  onNode: (
    node: ASTNode,
    nodeScopes: ScopeStack,
    inheritedScopes: ScopeStack,
    context: Context,
  ) => ASTStackNodeResult<Context>;
  root: ASTNode;
  scopes: ScopeStack;
  seenNodes?: WeakSet<object>;
}

const pushArrayValues = <Context>(
  pending: ASTStackFrame<Context>[],
  values: readonly unknown[],
  frame: ASTStackFrame<Context>,
  seenArrays: WeakSet<object>,
): void => {
  if (seenArrays.has(values)) {
    return;
  }
  seenArrays.add(values);
  for (let index = values.length - 1; index >= 0; index -= 1) {
    pending.push({ context: frame.context, scopes: frame.scopes, value: values[index] });
  }
};

const pushNodeChildren = <Context>(
  pending: ASTStackFrame<Context>[],
  node: ASTNode,
  nodeScopes: ScopeStack,
  result: ASTStackNodeResult<Context>,
): void => {
  const entries = Object.entries(node);
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry[0] !== 'parent') {
      pending.push({
        context: result.context,
        scopes: scopesForChild(nodeScopes, node, entry[0]),
        value: entry[1],
      });
    }
  }
};

const visitNodeFrame = <Context>(
  pending: ASTStackFrame<Context>[],
  frame: ASTStackFrame<Context>,
  seenNodes: WeakSet<object>,
  input: ASTStackWalkerInput<Context>,
): void => {
  const node = asNode(frame.value);
  if (!node || seenNodes.has(node)) {
    return;
  }
  seenNodes.add(node);
  const nodeScopes = withNodeScope(frame.scopes, node);
  const result = input.onNode(node, nodeScopes, frame.scopes, frame.context);
  if (result.visitChildren) {
    pushNodeChildren(pending, node, nodeScopes, result);
  }
};

const visitFrame = <Context>(
  pending: ASTStackFrame<Context>[],
  frame: ASTStackFrame<Context>,
  seenNodes: WeakSet<object>,
  seenArrays: WeakSet<object>,
  input: ASTStackWalkerInput<Context>,
): void => {
  if (Array.isArray(frame.value)) {
    pushArrayValues(pending, frame.value, frame, seenArrays);
    return;
  }
  visitNodeFrame(pending, frame, seenNodes, input);
};

/**
 * Traverse an AST value in source order without growing the JavaScript call stack.
 *
 * @param input - Root node, lexical scopes, context, and node callback.
 * @returns Nothing; node callbacks observe the traversal order.
 * @throws Does not throw.
 * @internal
 */
export const visitASTWithStack = <Context>(input: ASTStackWalkerInput<Context>): void => {
  const seenNodes = input.seenNodes ?? new WeakSet();
  const seenArrays = new WeakSet();
  const pending: ASTStackFrame<Context>[] = [
    { context: input.context, scopes: input.scopes, value: input.root },
  ];

  while (pending.length > 0) {
    const frame = pending.pop();
    if (frame) {
      visitFrame(pending, frame, seenNodes, seenArrays, input);
    }
  }
};
