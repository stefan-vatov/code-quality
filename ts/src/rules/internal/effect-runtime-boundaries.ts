import { childNode, childNodes, identifierName, isASTArray, isASTNode } from './effect-ast';
import type { ASTNode } from './effect-ast';
import { effectMatching } from './effect-canonical-patterns';
import type { Matches } from './effect-canonical-patterns';
import type { Context, RuleSpec, VisitorMap } from './effect-rule-core';

interface Frame {
  readonly inEffect: boolean;
  readonly node: ASTNode;
  readonly isCallee?: boolean;
  readonly objectInEffect?: boolean;
}

const runMethods = [
  'runCallback',
  'runFork',
  'runPromise',
  'runPromiseExit',
  'runSync',
  'runSyncExit',
] as const;

const curriedGeneratorRunners = ['fn', 'fnUntraced'] as const;

const functionTypes = new Set([
  'ArrowFunctionExpression',
  'FunctionDeclaration',
  'FunctionExpression',
]);

const ignoredKeys = new Set(['parent', 'loc', 'range', 'start', 'end']);

const runInsideEffectMessage =
  'Do not run an Effect inside Effect code: Effect.runSync, runPromise, and runFork start a separate root fiber that loses the surrounding services, interruption, and typed failure. Compose instead: `yield* effect` in generators, `Effect.exit(effect)` for an Exit, or `Effect.forkDaemon`/`Effect.forkScoped` for background work.';

const childrenOf = (node: ASTNode): ASTNode[] => {
  const children: ASTNode[] = [];
  for (const [key, value] of Object.entries(node)) {
    if (ignoredKeys.has(key)) continue;
    if (isASTNode(value)) children.push(value);
    else if (isASTArray(value)) {
      for (const item of value) if (isASTNode(item)) children.push(item);
    }
  }
  return children;
};

const memberName = (node: ASTNode | undefined): string | undefined =>
  node?.type === 'MemberExpression' && node.computed !== true
    ? identifierName(childNode(node, 'property'))
    : undefined;

const isEffectMember = (node: ASTNode | undefined, matches: Matches): boolean => {
  const name = memberName(node);
  return name !== undefined && matches(node, 'Effect', name);
};

const isCurriedGeneratorRunner = (node: ASTNode | undefined, matches: Matches): boolean =>
  node?.type === 'CallExpression' &&
  curriedGeneratorRunners.some((name) => matches(childNode(node, 'callee'), 'Effect', name));

const isEffectApiCall = (call: ASTNode, matches: Matches): boolean => {
  const callee = childNode(call, 'callee');
  return isEffectMember(callee, matches) || isCurriedGeneratorRunner(callee, matches);
};

const isRunCall = (node: ASTNode, matches: Matches): boolean => {
  if (node.type !== 'CallExpression') return false;
  const callee = childNode(node, 'callee');
  const name = memberName(callee);
  return runMethods.some((method) => method === name) && isEffectMember(callee, matches);
};

const isFunction = (node: ASTNode): boolean => functionTypes.has(node.type);

const callChildFrames = (call: ASTNode, inEffect: boolean, matches: Matches): Frame[] => {
  const argumentInEffect = isEffectApiCall(call, matches);
  const argumentsList = new Set(childNodes(call, 'arguments'));
  const callee = childNode(call, 'callee');
  return childrenOf(call).map((child) => {
    if (child === callee) return { inEffect, isCallee: true, node: child };
    if (!argumentsList.has(child)) return { inEffect, node: child };
    if (isFunction(child)) return { inEffect: argumentInEffect, node: child };
    return child.type === 'ObjectExpression'
      ? { inEffect, node: child, objectInEffect: argumentInEffect }
      : { inEffect, node: child };
  });
};

const objectChildFrames = (frame: Frame): Frame[] =>
  childrenOf(frame.node).map((child) => ({
    inEffect: frame.inEffect,
    node: child,
    objectInEffect: frame.objectInEffect ?? false,
  }));

const propertyChildFrames = (frame: Frame): Frame[] => {
  const value = childNode(frame.node, 'value');
  return childrenOf(frame.node).map((child) => {
    if (child !== value) return { inEffect: frame.inEffect, node: child };
    if (isFunction(child)) return { inEffect: frame.objectInEffect ?? false, node: child };
    return { inEffect: frame.inEffect, node: child, objectInEffect: frame.objectInEffect ?? false };
  });
};

const childFrames = (frame: Frame, matches: Matches): Frame[] => {
  const { node, inEffect } = frame;
  if (node.type === 'CallExpression') return callChildFrames(node, inEffect, matches);
  if (node.type === 'ObjectExpression') return objectChildFrames(frame);
  if (node.type === 'Property') return propertyChildFrames(frame);
  if (node.type === 'ParenthesizedExpression' && frame.isCallee === true) {
    return childrenOf(node).map((child) => ({ inEffect, isCallee: true, node: child }));
  }
  if (isFunction(node) && frame.isCallee === true) {
    return childrenOf(node).map((child) => ({ inEffect, node: child }));
  }
  return childrenOf(node).map((child) => ({
    inEffect: isFunction(child) ? false : inEffect,
    node: child,
  }));
};

const runInsideEffectVisitors = (context: Context): VisitorMap => {
  const { begin, matches } = effectMatching(context);
  return {
    Program(program): void {
      begin(program);
      const pending: Frame[] = [{ inEffect: false, node: program }];
      while (pending.length > 0) {
        const frame = pending.pop();
        if (frame === undefined) break;
        if (frame.inEffect && isRunCall(frame.node, matches)) {
          context.report({ node: frame.node, message: runInsideEffectMessage });
        }
        pending.push(...childFrames(frame, matches));
      }
    },
  };
};

export const effectNoRunInsideEffectSpec: RuleSpec = {
  name: 'effect-no-run-inside-effect',
  message: runInsideEffectMessage,
  tokens: [...runMethods],
  ast: runInsideEffectVisitors,
};
